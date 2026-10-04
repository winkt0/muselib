import { DEFAULT_HARVEST_OPTIONS, harvestPlaylistInPage } from "@/spotify/harvestPlaylist";
import { parseSpotifyPlaylistUrl, SPOTIFY_SELECTORS } from "@/spotify/selectors";
import { mergeIntoLibrary } from "@/storage/mergeHarvested";
import type { ExportRequest, ExportResult, HarvestResult } from "@/utils/types";

export default defineBackground(() => {
    const runningTabs = new Set<number>();

    browser.runtime.onMessage.addListener((msg: ExportRequest, _sender, sendResponse) => {
        if (msg?.type !== "export-playlist") return false;
        exportSpotifyPlaylist(msg.tabId, msg.tabUrl).then(sendResponse);
        return true; // keep the channel open for the async response
    });

    async function exportSpotifyPlaylist(tabId: number, tabUrl: string): Promise<ExportResult> {
        const playlistId = parseSpotifyPlaylistUrl(tabUrl);
        if (!playlistId) {
            return {
                ok: false,
                reason: "not-a-playlist",
                message: "Open a playlist on open.spotify.com to save its songs.",
            };
        }

        if (runningTabs.has(tabId)) {
            return { ok: false, reason: "already-running", message: "This playlist is already being saved." };
        }
        runningTabs.add(tabId);

        try {
            let harvest: HarvestResult | undefined;
            try {
                const [injection] = await browser.scripting.executeScript({
                    target: { tabId },
                    func: harvestPlaylistInPage,
                    args: [SPOTIFY_SELECTORS, DEFAULT_HARVEST_OPTIONS],
                });
                harvest = injection?.result as HarvestResult | undefined;
            } catch (err) {
                return {
                    ok: false,
                    reason: "harvest-failed",
                    message: `Couldn't read the playlist page: ${err instanceof Error ? err.message : String(err)}`,
                };
            }

            if (!harvest) {
                return {
                    ok: false,
                    reason: "harvest-failed",
                    message: "The playlist page didn't respond. Reload it and try again.",
                };
            }
            if (!harvest.ok) {
                return { ok: false, reason: "harvest-failed", message: harvest.error };
            }

            const { added, alreadyInLibrary } = await mergeIntoLibrary(harvest.tracks, {
                url: `https://open.spotify.com/playlist/${playlistId}`,
                context: harvest.playlistName ? `Spotify playlist: ${harvest.playlistName}` : "Spotify playlist",
            });

            return {
                ok: true,
                playlistName: harvest.playlistName,
                harvested: harvest.tracks.length,
                expected: harvest.expectedCount,
                complete: harvest.complete,
                added: added.length,
                alreadyInLibrary,
                skipped: harvest.skipped,
            };
        } finally {
            runningTabs.delete(tabId);
        }
    }
});
