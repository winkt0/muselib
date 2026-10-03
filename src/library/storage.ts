import { storage } from "#imports";
import type { EntrySource, HarvestedTrack, LibraryEntry } from "../utils/types";

interface LibraryState {
    version: 1;
    entries: Record<string, LibraryEntry>;
}

export interface MergeSummary {
    /** Entries created by this merge. */
    added: LibraryEntry[];
    /** Tracks that were already in the library (their source list was updated). */
    alreadyInLibrary: number;
}

// browser.storage has no transactions. All library writes go through the
// background service worker, and this queue serializes them within it so two
// overlapping read-modify-write cycles can't overwrite each other.
let writeQueue: Promise<unknown> = Promise.resolve();
function withLibraryLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(fn, fn);
    writeQueue = run.catch(() => {});
    return run;
}

async function readState(): Promise<LibraryState> {
    const stored = await storage.getItem<LibraryState>("local:muselib:state", {
        fallback: { version: 1, entries: {} },
    });
    return stored;
}

async function writeState(state: LibraryState): Promise<void> {
    await storage.setItem("local:muselib:state", state);
}
/**
 * Adds harvested tracks to the library. A track already in the library
 * (same Spotify ID, i.e. the same recording on Spotify) isn't duplicated
 */
export function mergeIntoLibrary(
    tracks: HarvestedTrack[],
    source: Omit<EntrySource, "savedAt">,
): Promise<MergeSummary> {
    return withLibraryLock(async () => {
        const state = await readState();
        const now = new Date().toISOString();

        const bySpotifyId = new Map<string, LibraryEntry>();
        for (const entry of Object.values(state.entries)) {
            if (entry.externalIds.spotify) bySpotifyId.set(entry.externalIds.spotify, entry);
        }

        const added: LibraryEntry[] = [];
        let alreadyInLibrary = 0;

        const seenThisMerge = new Set<string>();

        for (const track of tracks) {
            // A playlist can contain the same track twice; handle it once.
            if (seenThisMerge.has(track.spotifyId)) continue;
            seenThisMerge.add(track.spotifyId);

            const existing = bySpotifyId.get(track.spotifyId);
            if (existing) {
                alreadyInLibrary++;
                continue;
            }

            const entry: LibraryEntry = {
                id: crypto.randomUUID(),
                title: track.title,
                artists: track.artists,
                album: track.album,
                durationMs: track.durationMs,
                externalIds: { spotify: track.spotifyId },
                resolveStatus: "pending",
                addedAt: now,
                sources: [{ ...source, savedAt: now }],
            };
            state.entries[entry.id] = entry;
            bySpotifyId.set(track.spotifyId, entry);
            added.push(entry);
        }

        await writeState(state);
        return { added, alreadyInLibrary };
    });
}
