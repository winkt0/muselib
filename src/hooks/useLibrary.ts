import { readFromStorage, watchStorage, type LibraryState } from "@/storage/storage";
import type { LibraryEntry } from "@/utils/types";
import { useEffect, useState } from "react";

export type LibraryLoadState =
    | { status: "loading" }
    | { status: "ready"; entries: LibraryEntry[] }
    | { status: "error"; message: string };

// Unordered: chrome.storage returns keys alphabetically. Sorting is the caller's job.
const toEntries = (state: LibraryState | null): LibraryEntry[] => Object.values(state?.entries ?? {});

/** The user's library, kept in sync with storage (e.g. while an export runs). */
export function useLibrary(): LibraryLoadState {
    const [state, setState] = useState<LibraryLoadState>({ status: "loading" });

    useEffect(() => {
        let active = true;
        let watched = false; // a change event is newer than the initial read
        readFromStorage()
            .then(value => active && !watched && setState({ status: "ready", entries: toEntries(value) }))
            .catch(
                (err: unknown) =>
                    active && setState({ status: "error", message: err instanceof Error ? err.message : String(err) }),
            );
        const unwatch = watchStorage(value => {
            watched = true;
            if (active) setState({ status: "ready", entries: toEntries(value) });
        });
        return () => {
            active = false;
            unwatch();
        };
    }, []);

    return state;
}
