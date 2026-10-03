import { parseSpotifyPlaylistUrl } from "@/spotify/selectors";
import { Harvester } from "@/ui/Harvester";
import "./App.css";

function App() {
    const [isHarvestable, setHarvestable] = useState(false);
    const [tabId, setTabId] = useState<number | null>(null);
    const [tabUrl, setTabUrl] = useState("");

    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        const tab = tabs[0];
        if (!tab?.id || !tab.url || !parseSpotifyPlaylistUrl(tab.url)) {
            return;
        }
        setHarvestable(true);
        setTabId(tab.id);
        setTabUrl(tab.url);
    });
    return <>{isHarvestable ? <Harvester tabId={tabId!} tabUrl={tabUrl!}></Harvester> : null}</>;
}

export default App;
