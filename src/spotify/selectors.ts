export interface SpotifySelectors {
    /** The grid holding the playlist's own tracks (not the "Recommended" grid below it). */
    tracklistGrid: string[];
    /** One track row inside the grid. */
    trackRow: string[];
    /** Ancestor of a row that carries its aria-rowindex. */
    rowIndexHolder: string;
    /** The playlist title. */
    playlistTitle: string[];
    /**
     * Number of non-track rows (the column header) counted in the grid's
     * aria-rowcount and before the first track's aria-rowindex.
     */
    headerRows: number;
}

export const SPOTIFY_SELECTORS: SpotifySelectors = {
    tracklistGrid: ['[data-testid="playlist-tracklist"]', 'main [role="grid"][aria-rowcount]'],
    trackRow: ['[data-testid="tracklist-row"]'],
    rowIndexHolder: "[aria-rowindex]",
    playlistTitle: ['[data-testid="entityTitle"] h1', '[data-testid="entityTitle"]', "main h1"],
    headerRows: 1,
};

/**
 * Returns the playlist ID if `url` is an open.spotify.com playlist page,
 * including localized URLs such as https://open.spotify.com/intl-de/playlist/…
 */
export function parseSpotifyPlaylistUrl(url: string | undefined): string | null {
    if (!url) return null;
    const match = url.match(
        /^https:\/\/open\.spotify\.com\/(?:intl-[A-Za-z-]+\/)?playlist\/([A-Za-z0-9]{22})(?:[/?#]|$)/,
    );
    return match ? match[1]! : null;
}

export function parseSpotifyLikedSongs(url: string | undefined): string | null {
    if (!url) return null;
    const match = url.match(/^https:\/\/open\.spotify\.com\/(?:intl-[A-Za-z-]+\/)?collection\/tracks(?:[/?#]|$)/);
    return match ? match[0]! : null;
}
