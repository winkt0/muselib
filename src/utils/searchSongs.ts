import type { LibraryEntry } from "@/utils/types";

/** Lowercase and strip accents, so "alter" finds "Älter" and "beyonce" finds "Beyoncé". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Everything a search can match: title, artists, album. Compute once per entry. */
export function songSearchKey(entry: LibraryEntry): string {
    return fold([entry.title, ...entry.artists, entry.album ?? ""].join("\n"));
}

export function parseSearchQuery(query: string): string[] {
    return fold(query).split(/\s+/).filter(Boolean);
}

/** Every term has to appear somewhere, so "lanterns bloom" narrows rather than widens. */
export function matchesSearch(searchKey: string, terms: string[]): boolean {
    return terms.every(term => searchKey.includes(term));
}
