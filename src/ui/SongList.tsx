import { useLibrary } from "@/hooks/useLibrary";
import { deleteEntries, restoreEntries } from "@/storage/storage";
import { downloadLibraryExport } from "@/utils/exportLibrary";
import { importLibraryFile } from "@/utils/importLibrary";
import { openLibraryTab } from "@/utils/openLibraryTab";
import { matchesSearch, parseSearchQuery, songSearchKey } from "@/utils/searchSongs";
import { DEFAULT_DIRECTION, sortSongs, type SortDirection, type SortKey } from "@/utils/sortSongs";
import type { LibraryEntry } from "@/utils/types";
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import styles from "./SongList.module.css";
import { SongRow } from "./SongRow";

export interface SongListProps {
    /** "popup" adds an "Open in tab" button and closes the popup when it's used. */
    variant?: "popup" | "page";
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: "added", label: "Date added" },
    { key: "artist", label: "Artist" },
    { key: "title", label: "Song" },
];

const NO_ENTRIES: LibraryEntry[] = [];
const NOTICE_MS = 10_000;

interface Notice {
    key: number;
    text: string;
    /** Entries that Undo would put back. */
    undo?: LibraryEntry[];
}

const songs = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function directionLabel(key: SortKey, direction: SortDirection): string {
    if (key === "added") return direction === "desc" ? "Newest first" : "Oldest first";
    return direction === "asc" ? "A to Z" : "Z to A";
}

export function SongList({ variant = "page" }: SongListProps) {
    const library = useLibrary();
    const entries = library.status === "ready" ? library.entries : NO_ENTRIES;

    const [sortKey, setSortKey] = useState<SortKey>("added");
    const [direction, setDirection] = useState<SortDirection>(DEFAULT_DIRECTION.added);
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);
    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
    const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [busy, setBusy] = useState(false);
    const searchId = useId();
    const headingId = useId();

    // --- Search stuff ------------------------------------------------------

    const searchKeys = useMemo(() => new Map(entries.map(e => [e.id, songSearchKey(e)])), [entries]);
    const terms = useMemo(() => parseSearchQuery(deferredQuery), [deferredQuery]);
    const visible = useMemo(() => {
        const filtered = terms.length ? entries.filter(e => matchesSearch(searchKeys.get(e.id) ?? "", terms)) : entries;
        return sortSongs(filtered, sortKey, direction);
    }, [entries, searchKeys, terms, sortKey, direction]);

    // Actions only ever apply to selected songs the user can currently see.
    const visibleSelected = useMemo(() => visible.filter(e => selected.has(e.id)), [visible, selected]);
    const allVisibleSelected = visible.length > 0 && visibleSelected.length === visible.length;

    // Callbacks below read these through refs so rows can stay memoized.
    const visibleRef = useRef(visible);
    visibleRef.current = visible;
    const entriesRef = useRef(entries);
    entriesRef.current = entries;
    const lastToggled = useRef<number | null>(null);
    useEffect(() => {
        lastToggled.current = null; // indexes are meaningless after a re-sort or new search
    }, [visible]);

    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(n => (n?.key === notice.key ? null : n)), NOTICE_MS);
        return () => clearTimeout(timer);
    }, [notice]);

    // --- Selection ---------------------------------------------------------

    /** Shift-click selects or clears the whole range since the last toggled row. */
    const toggle = useCallback((id: string, index: number, wasShiftPressed: boolean) => {
        // Read the anchor now: the state updater below runs later, after the ref has moved on.
        const anchor = lastToggled.current;
        lastToggled.current = index;
        const [from, to] =
            wasShiftPressed && anchor !== null ? [Math.min(anchor, index), Math.max(anchor, index)] : [index, index];
        const rangeIds = visibleRef.current.slice(from, to + 1).map(e => e.id);
        setSelected(prev => {
            const next = new Set(prev);
            const select = !prev.has(id);
            for (const rangeId of rangeIds) {
                if (select) next.add(rangeId);
                else next.delete(rangeId);
            }
            return next;
        });
    }, []);

    const toggleAllVisible = () => {
        setSelected(prev => {
            const next = new Set(prev);
            for (const entry of visible) {
                if (allVisibleSelected) next.delete(entry.id);
                else next.add(entry.id);
            }
            return next;
        });
    };

    const selectAllRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (selectAllRef.current) {
            selectAllRef.current.indeterminate = visibleSelected.length > 0 && !allVisibleSelected;
        }
    });

    // --- Deleting ----------------------------------------------------------

    const deleteSongs = useCallback(async (ids: string[]) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        const removed = entriesRef.current.filter(e => idSet.has(e.id));
        setBusy(true);
        try {
            const count = await deleteEntries(ids);
            setSelected(prev => new Set([...prev].filter(id => !idSet.has(id))));
            setNotice({ key: Date.now(), text: `Deleted ${songs(count)}.`, undo: removed });
        } catch (err) {
            setNotice({ key: Date.now(), text: `Couldn't delete: ${errorText(err)}` });
        } finally {
            setBusy(false);
        }
    }, []);

    const deleteOne = useCallback((id: string) => void deleteSongs([id]), [deleteSongs]);

    const deleteAll = async () => {
        setConfirmingDeleteAll(false);
        await deleteSongs(entries.map(e => e.id));
    };

    const undo = async () => {
        if (!notice?.undo) return;
        setBusy(true);
        try {
            const count = await restoreEntries(notice.undo);
            setNotice({ key: Date.now(), text: `Restored ${songs(count)}.` });
        } catch (err) {
            setNotice({ key: Date.now(), text: `Couldn't restore: ${errorText(err)}` });
        } finally {
            setBusy(false);
        }
    };

    // --- Other actions -----------------------------------------------------

    const fileInputRef = useRef<HTMLInputElement>(null);

    const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = ""; // so choosing the same file again still fires onChange
        if (!file) return;
        setBusy(true);
        try {
            const { imported, duplicates, invalid } = await importLibraryFile(file);
            const parts =
                imported === 0 && duplicates > 0
                    ? [`All ${songs(duplicates)} in this file are already in your library.`]
                    : [`Imported ${songs(imported)}.`];
            if (imported > 0 && duplicates > 0) parts.push(`Skipped ${songs(duplicates)} already in your library.`);
            if (invalid > 0) parts.push(`Skipped ${invalid} invalid ${invalid === 1 ? "entry" : "entries"}.`);
            setNotice({ key: Date.now(), text: parts.join(" ") });
        } catch (err) {
            setNotice({ key: Date.now(), text: `Couldn't import: ${errorText(err)}` });
        } finally {
            setBusy(false);
        }
    };

    const exportJson = () => {
        try {
            const filename = downloadLibraryExport(entries);
            setNotice({ key: Date.now(), text: `Exported ${songs(entries.length)} to ${filename}.` });
        } catch (err) {
            setNotice({ key: Date.now(), text: `Couldn't export: ${errorText(err)}` });
        }
    };

    const openInTab = async () => {
        await openLibraryTab();
        if (variant === "popup") window.close();
    };

    const chooseSort = (key: SortKey) => {
        if (key === sortKey) return;
        setSortKey(key);
        setDirection(DEFAULT_DIRECTION[key]);
    };

    // --- Render ------------------------------------------------------------

    if (library.status === "loading") {
        return (
            <section className={styles.root} aria-busy="true">
                <p className={styles.message}>Loading your songs…</p>
            </section>
        );
    }
    if (library.status === "error") {
        return (
            <section className={styles.root}>
                <p className={styles.message}>Couldn't load your library: {library.message}</p>
            </section>
        );
    }

    const total = entries.length;
    const countText = terms.length ? `${visible.length} of ${songs(total)}` : songs(total);

    return (
        <section className={styles.root} data-variant={variant} aria-labelledby={headingId}>
            <div className={styles.top}>
                <header className={styles.header}>
                    <div className={styles.titleRow}>
                        <h2 id={headingId} className={styles.heading}>
                            Your songs
                        </h2>
                        <span className={styles.count}>{countText}</span>
                    </div>
                    <div className={styles.actions}>
                        <button
                            type="button"
                            className={styles.action}
                            onClick={() => fileInputRef.current?.click()}
                            disabled={busy}
                        >
                            Import JSON
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,application/json"
                            hidden
                            onChange={importJson}
                        />
                        <button type="button" className={styles.action} onClick={exportJson} disabled={total === 0}>
                            Export JSON
                        </button>
                        {variant === "popup" && (
                            <button type="button" className={styles.action} onClick={openInTab}>
                                Open in tab
                            </button>
                        )}
                        <button
                            type="button"
                            className={`${styles.action} ${styles.dangerText}`}
                            onClick={() => setConfirmingDeleteAll(true)}
                            disabled={total === 0 || busy || confirmingDeleteAll}
                        >
                            Delete all
                        </button>
                    </div>
                </header>

                {confirmingDeleteAll && (
                    <div className={styles.confirm} role="group" aria-label="Confirm deleting all songs">
                        <p className={styles.confirmText}>Delete all {songs(total)} from your library?</p>
                        <div className={styles.confirmButtons}>
                            <button
                                type="button"
                                className={styles.action}
                                onClick={() => setConfirmingDeleteAll(false)}
                                autoFocus
                            >
                                Cancel
                            </button>
                            <button type="button" className={styles.dangerSolid} onClick={deleteAll}>
                                Delete all songs
                            </button>
                        </div>
                    </div>
                )}

                {total > 0 && (
                    <>
                        <div className={styles.search} role="search">
                            <label htmlFor={searchId} className={styles.srOnly}>
                                Search your songs
                            </label>
                            <svg className={styles.searchFieldIcon} viewBox="0 0 16 16" aria-hidden="true">
                                <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                                <path
                                    d="m10.5 10.5 3.5 3.5"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                />
                            </svg>
                            <input
                                id={searchId}
                                type="search"
                                className={styles.searchInput}
                                placeholder="Search songs, artists, albums"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>

                        <div className={styles.toolbar}>
                            <div className={styles.segmented} role="group" aria-label="Sort by">
                                {SORT_OPTIONS.map(({ key, label }) => (
                                    <button
                                        key={key}
                                        type="button"
                                        className={styles.segment}
                                        aria-pressed={sortKey === key}
                                        onClick={() => chooseSort(key)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <button
                                type="button"
                                className={styles.direction}
                                onClick={() => setDirection(d => (d === "asc" ? "desc" : "asc"))}
                                aria-label={`Sort order: ${directionLabel(sortKey, direction)}. Click to reverse.`}
                            >
                                <svg
                                    className={styles.directionIcon}
                                    data-dir={direction}
                                    viewBox="0 0 16 16"
                                    aria-hidden="true"
                                >
                                    <path
                                        d="M8 2v11M3.5 8.5 8 13l4.5-4.5"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.6"
                                    />
                                </svg>
                                {directionLabel(sortKey, direction)}
                            </button>
                        </div>

                        {visible.length > 0 && (
                            <div className={styles.columns}>
                                <label className={styles.check}>
                                    <input
                                        ref={selectAllRef}
                                        type="checkbox"
                                        checked={allVisibleSelected}
                                        onChange={toggleAllVisible}
                                        aria-label={terms.length ? "Select all matching songs" : "Select all songs"}
                                    />
                                </label>
                                {visibleSelected.length > 0 ? (
                                    <div className={styles.selectionBar}>
                                        <span className={styles.selectionCount}>{visibleSelected.length} selected</span>
                                        <button
                                            type="button"
                                            className={styles.action}
                                            onClick={() => setSelected(new Set())}
                                        >
                                            Clear
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.dangerSolid}
                                            onClick={() => deleteSongs(visibleSelected.map(e => e.id))}
                                            disabled={busy}
                                        >
                                            Delete selected
                                        </button>
                                    </div>
                                ) : (
                                    <div className={styles.columnLabels} aria-hidden="true">
                                        <span className={styles.colIndex}>#</span>
                                        <span>Title</span>
                                        <span className={styles.colAlbum}>Album</span>
                                        <span className={styles.colAdded}>Added</span>
                                        <span className={styles.colDuration}>Length</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            {total === 0 ? (
                <p className={styles.message}>No songs yet. Open a playlist and choose Save playlist to library.</p>
            ) : visible.length === 0 ? (
                <p className={styles.message}>
                    No songs match “{query.trim()}”.{" "}
                    <button type="button" className={styles.inlineButton} onClick={() => setQuery("")}>
                        Clear search
                    </button>
                </p>
            ) : (
                <ol className={styles.list} aria-labelledby={headingId}>
                    {visible.map((entry, i) => (
                        <SongRow
                            key={entry.id}
                            entry={entry}
                            index={i}
                            selected={selected.has(entry.id)}
                            deleteDisabled={busy}
                            onToggle={toggle}
                            onDelete={deleteOne}
                        />
                    ))}
                </ol>
            )}

            <div className={styles.noticeSlot} role="status" aria-live="polite">
                {notice && (
                    <div className={styles.notice} key={notice.key}>
                        <span className={styles.noticeText}>{notice.text}</span>
                        {notice.undo && notice.undo.length > 0 && (
                            <button type="button" className={styles.noticeButton} onClick={undo} disabled={busy}>
                                Undo
                            </button>
                        )}
                        <button
                            type="button"
                            className={styles.noticeClose}
                            onClick={() => setNotice(null)}
                            aria-label="Dismiss"
                        >
                            ×
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
}
