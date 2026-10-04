import { sortSongs } from "@/utils/sortSongs";
import type { LibraryEntry } from "@/utils/types";

interface LibraryExport {
    format: "song-library";
    version: 1;
    exportedAt: string;
    songs: LibraryEntry[];
}

function buildLibraryExport(entries: LibraryEntry[], now = new Date()): LibraryExport {
    return {
        format: "song-library",
        version: 1,
        exportedAt: now.toISOString(),
        songs: sortSongs(entries, "added", "asc"), // oldest first, playlist order within a save
    };
}

/** e.g. song-library-2026-10-03.json (local date). */
function exportFilename(now = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `song-library-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** Saves the library as a JSON file through the browser's normal download flow. */
export function downloadLibraryExport(entries: LibraryEntry[]): string {
    const filename = exportFilename();
    const blob = new Blob([JSON.stringify(buildLibraryExport(entries), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    // The download has its own copy once started; free the blob afterwards.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return filename;
}
