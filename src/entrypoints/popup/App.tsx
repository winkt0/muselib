import { parseSpotifyPlaylistUrl } from "@/spotify/selectors";
import type { ExportResult, HarvestedTrack, HarvestProgress } from "@/utils/types";
import { useState } from "react";
import "./App.css";

function App() {
    const [harvestHasBegun, setHarvesting] = useState(false);
    const [progess, setProgress] = useState(0);
    const [harvestedTracks, setHarvested] = useState<Array<HarvestedTrack>>([]);
    const [maxNumSongs, setMaxNumSongs] = useState(0);
    const [status, setStatus] = useState("");
    const [tabId, setTabId] = useState<number | null>(null);
    const [tabUrl, setTabUrl] = useState("");

    function describe(result: ExportResult): string {
        if (!result.ok) return result.message;
        console.log(result);
        const parts = [`Added ${result.added} ${result.added === 1 ? "song" : "songs"} to your library.`];
        if (result.alreadyInLibrary > 0) parts.push(`${result.alreadyInLibrary} were already in it.`);
        const skipped = result.skipped.localOrUnavailable + result.skipped.episodes;
        if (skipped > 0) parts.push(`Skipped ${skipped} local files, podcast episodes or unavailable tracks.`);
        if (!result.complete && result.expected !== null) {
            parts.push(
                `Only ${result.harvested} of ${result.expected} rows could be read. Save again to pick up the rest.`,
            );
        }
        return parts.join(" ");
    }

    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        const tab = tabs[0];
        if (!tab?.id || !tab.url || !parseSpotifyPlaylistUrl(tab.url)) {
            setStatus("Open a playlist on open.spotify.com to save its songs.");
            return;
        }
        setTabId(tab.id);
        setTabUrl(tab.url);
    });

    browser.runtime.onMessage.addListener((msg: HarvestProgress) => {
        if (msg?.type !== "harvest-progress") return;
        if (msg.expected) {
            setMaxNumSongs(msg.expected);
            setProgress(msg.collected);
        }
        if (msg.paused) {
            setStatus("Paused. Switch back to the Spotify tab to continue.");
            return;
        }
        setStatus(
            msg.expected ? `Reading songs: ${msg.collected} of ${msg.expected}` : `Reading songs: ${msg.collected}`,
        );
        setHarvested(msg.tracks);
    });

    function beginHarvest() {
        setHarvesting(true);
        setStatus("Reading songs… Keep this tab in view until it's done.");
        browser.runtime.sendMessage({ type: "export-playlist", tabId, tabUrl }).then(result => {
            setStatus(describe(result));
            setHarvesting(false);
        });
    }

    return (
        <>
            <h1>MuseLib</h1>
            {!harvestHasBegun ? (
                <button type="button" onClick={beginHarvest}>
                    Save playlist to library
                </button>
            ) : (
                <progress id="progress" value={progess} max={maxNumSongs}></progress>
            )}
            <p role="status" aria-live="polite">
                {status}
            </p>
            <ul>
                {harvestedTracks.map(track => (
                    <li>
                        [{track.position}/{maxNumSongs}] {track.artists} - {track.title}
                    </li>
                ))}
            </ul>
        </>
    );
}

export default App;
