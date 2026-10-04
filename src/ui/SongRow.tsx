import { formatAddedDate, formatArtists, formatDuration, youtubeSearchUrl } from "@/utils/stringFormat";
import type { LibraryEntry } from "@/utils/types";
import { memo, type MouseEvent } from "react";
import styles from "./SongList.module.css";

interface SongRowProps {
    entry: LibraryEntry;
    /** 0-based index in the visible (filtered, sorted) list. */
    index: number;
    selected: boolean;
    deleteDisabled: boolean;
    onToggle: (id: string, index: number, wasShiftPressed: boolean) => void;
    onDelete: (id: string) => void;
}

export const SongRow = memo(function SongRow({
    entry,
    index,
    selected,
    deleteDisabled,
    onToggle,
    onDelete,
}: SongRowProps) {
    const artists = formatArtists(entry);
    const name = `“${entry.title}” by ${artists}`;

    // Toggled from onClick, not onChange: React delivers a checkbox's onChange from
    // the native change event, which has no shiftKey. Space on a focused checkbox
    // also fires click, so keyboard toggling still works.
    const handleToggle = (event: MouseEvent<HTMLInputElement>) => onToggle(entry.id, index, event.shiftKey);

    return (
        <li className={styles.item} data-selected={selected || undefined}>
            <label className={styles.check}>
                <input
                    type="checkbox"
                    checked={selected}
                    onClick={handleToggle}
                    onChange={() => {}} // state changes in onClick; this just marks the input as controlled
                    aria-label={`Select ${name}`}
                />
            </label>

            <a
                className={styles.link}
                href={youtubeSearchUrl(entry)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Search YouTube for “${artists} - ${entry.title}”`}
            >
                <span className={styles.colIndex}>
                    <span className={styles.number}>{index + 1}</span>
                    <svg className={styles.searchIcon} viewBox="0 0 16 16" aria-hidden="true">
                        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                        <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                </span>
                <span className={styles.titleCell}>
                    <span className={styles.title}>{entry.title}</span>
                    <span className={styles.artists}>{artists}</span>
                </span>
                <span className={styles.colAlbum}>{entry.album ?? ""}</span>
                <span className={styles.colAdded}>
                    <time dateTime={entry.addedAt}>{formatAddedDate(entry.addedAt)}</time>
                </span>
                <span className={styles.colDuration}>{formatDuration(entry.durationMs)}</span>
                <span className={styles.srOnly}>, search on YouTube (opens in a new tab)</span>
            </a>

            <button
                type="button"
                className={styles.deleteButton}
                onClick={() => onDelete(entry.id)}
                disabled={deleteDisabled}
                aria-label={`Delete ${name} from your library`}
                title="Delete from library"
            >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                        d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>
        </li>
    );
});
