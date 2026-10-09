import { readFromStorage, writeToStorage } from "@/storage/storage";
import type { LibraryEntry } from "@/utils/types";

export interface ImportSummary {
    /** Songs added to the library. */
    imported: number;
    /** Songs skipped because the same recording is already in the library (or twice in the file). */
    duplicates: number;
    /** Entries in the file that weren't valid songs. */
    invalid: number;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function isLibraryEntry(v: unknown): v is LibraryEntry {
    return (
        isObject(v) &&
        isString(v.id) &&
        v.id.length > 0 &&
        isString(v.title) &&
        Array.isArray(v.artists) &&
        v.artists.every(isString) &&
        isString(v.addedAt) &&
        !Number.isNaN(Date.parse(v.addedAt)) &&
        isObject(v.externalIds) &&
        Array.isArray(v.sources) &&
        (v.album === undefined || isString(v.album)) &&
        (v.durationMs === undefined || typeof v.durationMs === "number") &&
        (v.custom_order_index === undefined || typeof v.custom_order_index === "number") &&
        (v.resolveStatus === "pending" || v.resolveStatus === "resolved" || v.resolveStatus === "not_found")
    );
}

/**
 * Parses the text of an export file (see exportLibrary.ts) into valid entries.
 * Throws an Error with a user-facing message if the file can't be imported at all.
 */
export function parseLibraryExport(text: string): { songs: LibraryEntry[]; invalid: number } {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error("That file isn't valid JSON.");
    }
    if (!isObject(data) || data.format !== "song-library" || !Array.isArray(data.songs)) {
        throw new Error("That file isn't a song library export.");
    }
    if (data.version !== 1) {
        throw new Error(
            `This export uses format version ${String(data.version)}, which this version of the extension can't read.`,
        );
    }
    const songs = data.songs.filter(isLibraryEntry);
    return { songs, invalid: data.songs.length - songs.length };
}

/**
 * Adds songs from an export to the library. Existing songs are never changed:
 * a song whose ID or Spotify track is already in the library is skipped.
 */
export async function importLibraryFile(file: File): Promise<ImportSummary> {
    const { songs, invalid } = parseLibraryExport(await file.text());

    const state = await readFromStorage();
    const entries = { ...state.entries };
    const spotifyIds = new Set(
        Object.values(entries)
            .map(e => e.externalIds.spotify)
            .filter((id): id is string => !!id),
    );
    // Imported songs go after everything already saved, keeping their order from the file.
    let nextOrder = Object.values(entries).reduce((max, e) => Math.max(max, e.custom_order_index ?? 0), 0) + 1;
    const inFileOrder = [...songs].sort(
        (a, b) =>
            Date.parse(a.addedAt) - Date.parse(b.addedAt) || (a.custom_order_index ?? 0) - (b.custom_order_index ?? 0),
    );

    let imported = 0;
    let duplicates = 0;
    for (const song of inFileOrder) {
        const spotify = song.externalIds.spotify;
        if (song.id in entries || (isString(spotify) && spotifyIds.has(spotify))) {
            duplicates++;
            continue;
        }
        entries[song.id] = { ...song, custom_order_index: nextOrder++ };
        if (isString(spotify)) spotifyIds.add(spotify);
        imported++;
    }

    if (imported > 0) await writeToStorage({ ...state, entries });
    return { imported, duplicates, invalid };
}
