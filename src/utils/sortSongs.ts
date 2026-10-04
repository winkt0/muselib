import type { LibraryEntry } from "@/utils/types";

export type SortKey = "added" | "artist" | "title";
export type SortDirection = "asc" | "desc";

/** What a first click on each sort option does: newest first, A to Z. */
export const DEFAULT_DIRECTION: Record<SortKey, SortDirection> = {
    added: "desc",
    artist: "asc",
    title: "asc",
};

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Ignores a leading "The " so "The Beatles" sorts under B, as music players do. */
const artistSortName = (e: LibraryEntry) => (e.artists[0] ?? "").replace(/^the\s+/i, "");

/** Save order; entries saved before addedOrder existed fall back to their ID (stable, arbitrary). */
const bySaveOrder = (a: LibraryEntry, b: LibraryEntry): number =>
    (a.custom_order_index ?? 0) - (b.custom_order_index ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Returns a sorted copy. Ties fall back to the order songs were saved in,
 * always ascending, so songs saved together from one playlist keep their
 * playlist order even when sorting newest first.
 */
export function sortSongs(entries: LibraryEntry[], key: SortKey, direction: SortDirection): LibraryEntry[] {
    const sign = direction === "asc" ? 1 : -1;
    const compare = (a: LibraryEntry, b: LibraryEntry): number => {
        switch (key) {
            case "added":
                return Date.parse(a.addedAt) - Date.parse(b.addedAt);
            case "artist":
                return collator.compare(artistSortName(a), artistSortName(b)) || collator.compare(a.title, b.title);
            case "title":
                return collator.compare(a.title, b.title) || collator.compare(artistSortName(a), artistSortName(b));
        }
    };
    return [...entries].sort((a, b) => sign * compare(a, b) || bySaveOrder(a, b));
}
