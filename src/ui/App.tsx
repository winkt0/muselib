import { parseSpotifyLikedSongs, parseSpotifyPlaylistUrl } from "@/spotify/selectors";
import { Harvester } from "@/ui/Harvester";
import { SongList } from "@/ui/SongList";
import "./App.css";

function App({ variant = "popup" }: { variant?: "popup" | "page" }) {
    const [isHarvestable, setHarvestable] = useState(false);
    const [tabId, setTabId] = useState<number | null>(null);
    const [tabUrl, setTabUrl] = useState("");

    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        const tab = tabs[0];
        if (!tab?.id || !tab.url || !(parseSpotifyPlaylistUrl(tab.url) || parseSpotifyLikedSongs(tab.url))) {
            return;
        }
        setHarvestable(true);
        setTabId(tab.id);
        setTabUrl(tab.url);
    });
    return (
        <>
            {isHarvestable ? <Harvester tabId={tabId!} tabUrl={tabUrl!}></Harvester> : null}
            {<SongList variant={variant}></SongList>}
        </>
    );
}

export default App;
