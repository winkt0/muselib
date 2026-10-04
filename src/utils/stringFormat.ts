import type { LibraryEntry } from "@/utils/types";

/** 3:07, or 1:02:09 for long tracks. */
export function formatDuration(ms: number | undefined): string {
    if (ms === undefined) return "–";
    const total = Math.round(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const sameYear = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const otherYear = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/** "12 Sep" this year, "12 Sep 2025" otherwise (in the browser's locale). */
export function formatAddedDate(iso: string, now = new Date()): string {
    const date = new Date(iso);
    return (date.getFullYear() === now.getFullYear() ? sameYear : otherYear).format(date);
}

export function formatArtists(entry: LibraryEntry): string {
    return entry.artists.length ? entry.artists.join(", ") : "Unknown artist";
}

/** YouTube search for "[ARTIST] - [SONG_NAME]". */
export function youtubeSearchUrl(entry: LibraryEntry): string {
    const query = entry.artists.length ? `${entry.artists.join(", ")} - ${entry.title}` : entry.title;
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
