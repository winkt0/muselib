import { storage } from "#imports";
import type { Unwatch } from "wxt/utils/storage";
import type { LibraryEntry } from "../utils/types";

export interface LibraryState {
    version: 1;
    entries: Record<string, LibraryEntry>;
}

const EMPTY_LIBRARY: LibraryState = { version: 1, entries: {} };

const libraryStorage = storage.defineItem<LibraryState>("local:muselib:state", {
    fallback: EMPTY_LIBRARY,
});

export async function writeToStorage(state: LibraryState): Promise<void> {
    await libraryStorage.setValue(state);
}

export async function readFromStorage(): Promise<LibraryState> {
    return libraryStorage.getValue();
}

type WatchCallback = (newValue: LibraryState, oldValue: LibraryState) => void;
export function watchStorage(cb: WatchCallback): Unwatch {
    return libraryStorage.watch(cb);
}

// browser.storage has no transactions. All library writes go through the
// background service worker, and this queue serializes them within it so two
// overlapping read-modify-write cycles can't overwrite each other.
let writeQueue: Promise<unknown> = Promise.resolve();
export function withLibraryLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(fn, fn);
    writeQueue = run.catch(() => {});
    return run;
}

/** Removes entries by ID. Returns how many were actually removed. */
export function deleteEntries(ids: string[]): Promise<number> {
    return withLibraryLock(async () => {
        const state = await readFromStorage();
        const entries = { ...state.entries };
        let removed = 0;
        for (const id of ids) {
            if (id in entries) {
                delete entries[id];
                removed++;
            }
        }
        if (removed > 0) await writeToStorage({ ...state, entries });
        return removed;
    });
}

/**
 * Puts previously deleted entries back (undo). Skips any whose recording was
 * saved again in the meantime, so undo never creates duplicates.
 */
export function restoreEntries(toRestore: LibraryEntry[]): Promise<number> {
    return withLibraryLock(async () => {
        const state = await readFromStorage();
        const entries = { ...state.entries };
        const spotifyIds = new Set(
            Object.values(entries)
                .map(e => e.externalIds.spotify)
                .filter((id): id is string => !!id),
        );
        let restored = 0;
        for (const entry of toRestore) {
            const spotify = entry.externalIds.spotify;
            if (entry.id in entries || (spotify && spotifyIds.has(spotify))) continue;
            entries[entry.id] = entry;
            if (spotify) spotifyIds.add(spotify);
            restored++;
        }
        if (restored > 0) await writeToStorage({ ...state, entries });
        return restored;
    });
}
