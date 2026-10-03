import type { HarvestedTrack, HarvestProgress, HarvestResult } from "../utils/types";
import type { SpotifySelectors } from "./selectors";

export interface HarvestOptions {
    /** Fraction of the visible height scrolled per step. < 1 so steps overlap. */
    stepRatio: number;
    /** DOM is considered rendered once it has had no mutations for this long. */
    quietMs: number;
    /** Upper bound on waiting for the DOM to go quiet after a scroll. */
    maxWaitMs: number;
    /** Rounds at the bottom with nothing new before a pass ends. */
    maxIdleRoundsAtBottom: number;
    /** Full top-to-bottom passes before giving up on missing rows. */
    maxPasses: number;
    /** Hard cap on scroll steps per pass (Spotify caps playlists at 10,000 items). */
    maxStepsPerPass: number;
}

export const DEFAULT_HARVEST_OPTIONS: HarvestOptions = {
    stepRatio: 0.75,
    quietMs: 150,
    maxWaitMs: 2000,
    maxIdleRoundsAtBottom: 4,
    maxPasses: 2,
    maxStepsPerPass: 5000,
};

/**
 * Runs inside the Spotify tab via browser.scripting.executeScript({ func }).
 *
 * browser serializes this function with toString(), so it must be completely
 * self-contained: no imports, no references to anything outside its body.
 *
 * Spotify virtualizes the track list: only rows near the viewport exist in
 * the DOM. So we scroll step by step and collect rows as they appear, keyed
 * by their aria-rowindex, until every row the grid reports has been seen.
 */
export async function harvestPlaylistInPage(sel: SpotifySelectors, opts: HarvestOptions): Promise<HarvestResult> {
    const TRACK_RE = /\/track\/([A-Za-z0-9]{22})/;
    const EPISODE_RE = /\/episode\/([A-Za-z0-9]{22})/;
    const ARTIST_RE = /\/artist\/([A-Za-z0-9]{22})/;
    const ALBUM_RE = /\/album\/([A-Za-z0-9]{22})/;
    const DURATION_RE = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/;

    const queryFirst = <T extends Element>(root: ParentNode, candidates: string[]): T | null => {
        for (const s of candidates) {
            const el = root.querySelector<T>(s);
            if (el) return el;
        }
        return null;
    };

    const queryAll = (root: ParentNode, candidates: string[]): Element[] => {
        for (const s of candidates) {
            const els = root.querySelectorAll(s);
            if (els.length) return Array.from(els);
        }
        return [];
    };

    const findScroller = (start: Element): HTMLElement => {
        let el: HTMLElement | null = start.parentElement;
        while (el) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
            el = el.parentElement;
        }
        return (document.scrollingElement as HTMLElement) ?? document.documentElement;
    };

    /** Resolves once `target` has had no DOM mutations for quietMs (or maxWaitMs passes). */
    const waitForQuiet = (target: Node) =>
        new Promise<void>(resolve => {
            let quietTimer = setTimeout(done, opts.quietMs);
            const hardTimer = setTimeout(done, opts.maxWaitMs);
            const observer = new MutationObserver(() => {
                clearTimeout(quietTimer);
                quietTimer = setTimeout(done, opts.quietMs);
            });
            observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true });
            function done() {
                observer.disconnect();
                clearTimeout(quietTimer);
                clearTimeout(hardTimer);
                resolve();
            }
        });

    /**
     * browser doesn't render hidden tabs, so Spotify stops adding rows while the
     * user is on another tab. Pause until the tab is visible again.
     */
    const waitUntilVisible = () =>
        new Promise<void>(resolve => {
            if (!document.hidden) return resolve();
            const onChange = () => {
                if (document.hidden) return;
                document.removeEventListener("visibilitychange", onChange);
                resolve();
            };
            document.addEventListener("visibilitychange", onChange);
        });

    const parseDuration = (row: Element): number | undefined => {
        // The duration is a leaf element whose whole text is m:ss or h:mm:ss.
        const leaves = Array.from(row.querySelectorAll("div, span")).filter(e => e.children.length === 0);
        for (let i = leaves.length - 1; i >= 0; i--) {
            const m = (leaves[i]!.textContent ?? "").trim().match(DURATION_RE);
            if (m) return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
        }
        return undefined;
    };

    // Locate the playlist
    const grid = queryFirst<HTMLElement>(document, sel.tracklistGrid);
    if (!grid) {
        return {
            ok: false,
            error: "Couldn't find the track list on this page. Wait for the playlist to load and try again.",
        };
    }

    const rowCount = Number.parseInt(grid.getAttribute("aria-rowcount") ?? "", 10);
    const expectedCount = Number.isFinite(rowCount) ? Math.max(0, rowCount - sel.headerRows) : null;
    const playlistName = queryFirst<HTMLElement>(document, sel.playlistTitle)?.textContent?.trim() || null;
    const scroller = findScroller(grid);
    const originalScrollTop = scroller.scrollTop;

    const tracks = new Map<number, HarvestedTrack>();
    const localOrUnavailable = new Set<number>();
    const episodes = new Set<number>();
    const fallbackIds = new Set<string>();
    const FALLBACK_OFFSET = 1_000_000;
    const accounted = () => tracks.size + localOrUnavailable.size + episodes.size;

    /** Reads all currently rendered rows. Returns how many new rows were accounted for. */
    const collectVisible = (): number => {
        const before = accounted();
        const rows = queryAll(grid, sel.trackRow);
        rows.forEach(row => {
            const links = Array.from(row.querySelectorAll<HTMLAnchorElement>("a[href]"));
            const trackLink = links.find(a => TRACK_RE.test(a.href));

            const indexAttr = row.closest(sel.rowIndexHolder)?.getAttribute("aria-rowindex");
            let position: number;
            if (indexAttr) {
                position = Number(indexAttr) - sel.headerRows;
            } else {
                // Fallback if Spotify ever drops aria-rowindex: dedupe by track ID and
                // number rows in the order first seen. Non-track rows can't be counted.
                if (!trackLink || !(trackLink.textContent ?? "").trim()) return;
                const id = trackLink.href.match(TRACK_RE)![1]!;
                if (fallbackIds.has(id)) return;
                fallbackIds.add(id);
                position = FALLBACK_OFFSET + fallbackIds.size;
            }
            if (tracks.has(position) || localOrUnavailable.has(position) || episodes.has(position)) return;

            if (!trackLink) {
                if (links.some(a => EPISODE_RE.test(a.href))) {
                    episodes.add(position);
                } else if ((row.textContent ?? "").trim().length > 0) {
                    // Has content but no track link: a local file or a removed track.
                    localOrUnavailable.add(position);
                }
                // Otherwise it's a loading placeholder: leave it for a later round.
                return;
            }

            const spotifyId = trackLink.href.match(TRACK_RE)![1]!;
            const title = (trackLink.textContent ?? "").trim();
            if (!title) return; // still rendering

            const artists: string[] = [];
            const seenArtists = new Set<string>();
            for (const a of links) {
                const m = a.href.match(ARTIST_RE);
                if (m && !seenArtists.has(m[1]!)) {
                    seenArtists.add(m[1]!);
                    const name = (a.textContent ?? "").trim();
                    if (name) artists.push(name);
                }
            }

            const albumLink = links.find(a => ALBUM_RE.test(a.href));
            tracks.set(position, {
                position,
                spotifyId,
                title,
                artists,
                album: albumLink?.textContent?.trim() || undefined,
                durationMs: parseDuration(row),
            });
        });
        return accounted() - before;
    };

    const reportProgress = (pass: number, paused = false) => {
        const msg: HarvestProgress = {
            type: "harvest-progress",
            collected: tracks.size,
            expected: expectedCount,
            pass,
            paused,
            tracks: [...tracks.values()],
        };
        // No listener (e.g. popup closed) is fine; swallow the rejection.
        (globalThis as any).browser.runtime.sendMessage(msg).catch(() => {});
    };

    const isDone = () => expectedCount !== null && accounted() >= expectedCount;

    // Scroll through the list

    try {
        for (let pass = 1; pass <= opts.maxPasses && !isDone(); pass++) {
            scroller.scrollTop = 0;
            await waitForQuiet(grid);

            let idleAtBottom = 0;
            for (let step = 0; step < opts.maxStepsPerPass; step++) {
                if (document.hidden) {
                    reportProgress(pass, true);
                    await waitUntilVisible();
                    await waitForQuiet(grid);
                }
                const added = collectVisible();
                reportProgress(pass);
                if (isDone()) break;

                const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
                if (atBottom) {
                    // Rows may still be loading in; give them a few rounds.
                    idleAtBottom = added > 0 ? 0 : idleAtBottom + 1;
                    if (idleAtBottom >= opts.maxIdleRoundsAtBottom) break;
                } else {
                    scroller.scrollTop += Math.max(100, Math.floor(scroller.clientHeight * opts.stepRatio));
                }
                await waitForQuiet(grid);
            }
        }
    } finally {
        scroller.scrollTop = originalScrollTop;
    }

    let ordered = Array.from(tracks.values()).sort((a, b) => a.position - b.position);
    if (fallbackIds.size > 0) ordered = ordered.map((t, i) => ({ ...t, position: i + 1 }));
    return {
        ok: true,
        playlistName,
        tracks: ordered,
        expectedCount,
        skipped: { localOrUnavailable: localOrUnavailable.size, episodes: episodes.size },
        complete: isDone(),
    };
}
