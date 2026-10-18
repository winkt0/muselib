import { readFromStorage, writeToStorage } from "@/storage/storage";
import type { LibraryEntry } from "@/utils/types";
import { useId, useState, type FormEvent } from "react";
import styles from "./AddSongForm.module.css";

export interface AddSongFormProps {
    /** Called after a song was saved. */
    onAdded?: (entry: LibraryEntry) => void;
    /** If given, a Cancel button is shown that calls it. */
    onCancel?: () => void;
}

// --- Parsing and validation ---------------------------------------------------

type Parsed<T> = { ok: true; value: T | undefined } | { ok: false; error: string };
const ok = <T,>(value: T | undefined): Parsed<T> => ({ ok: true, value });
const fail = <T,>(error: string): Parsed<T> => ({ ok: false, error });

/** "3:45" or "1:02:09" → milliseconds. Empty → undefined. */
export function parseLength(input: string): Parsed<number> {
    const s = input.trim();
    if (!s) return ok(undefined);
    const m = s.match(/^(?:(\d+):)?(\d{1,3}):(\d{2})$/);
    if (!m) return fail("Enter the length as minutes:seconds, for example 3:45.");
    const hours = Number(m[1] ?? 0);
    const minutes = Number(m[2]);
    const seconds = Number(m[3]);
    if (seconds > 59 || (m[1] !== undefined && minutes > 59)) {
        return fail("Seconds and minutes go up to 59, for example 3:45 or 1:02:09.");
    }
    const ms = ((hours * 60 + minutes) * 60 + seconds) * 1000;
    return ms > 0 ? ok(ms) : fail("The length has to be longer than 0:00.");
}

/** Spotify track link, spotify:track: URI or bare 22-character ID → track ID. */
export function parseSpotifyTrack(input: string): Parsed<string> {
    const s = input.trim();
    if (!s) return ok(undefined);
    const m = s.match(
        /^(?:https?:\/\/open\.spotify\.com\/(?:intl-[A-Za-z-]+\/)?track\/|spotify:track:)?([A-Za-z0-9]{22})(?:[?#].*)?$/,
    );
    return m ? ok(m[1]) : fail("Paste a Spotify track link, like https://open.spotify.com/track/…");
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** MusicBrainz recording link or bare MBID → lowercase MBID. Rejects release/work links. */
export function parseRecordingMbid(input: string): Parsed<string> {
    const s = input.trim();
    if (!s) return ok(undefined);
    const link = s.match(new RegExp(`musicbrainz\\.org/([a-z-]+)/(${UUID})`));
    if (link) {
        return link[1] === "recording"
            ? ok(link[2]!.toLowerCase())
            : fail(`That's a MusicBrainz ${link[1]} link. The library stores recordings, so use the recording's link.`);
    }
    if (new RegExp(`^${UUID}$`).test(s)) return ok(s.toLowerCase());
    return fail("Paste a MusicBrainz recording link or ID, like https://musicbrainz.org/recording/…");
}

/** One or more ISRCs separated by spaces or commas. Hyphens are optional: US-RC1-76-07839 = USRC17607839. */
export function parseIsrcs(input: string): Parsed<string[]> {
    const parts = input.split(/[\s,;]+/).filter(Boolean);
    if (parts.length === 0) return ok(undefined);
    const isrcs: string[] = [];
    for (const part of parts) {
        const isrc = part.replace(/-/g, "").toUpperCase();
        if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) {
            return fail(`“${part}” isn't a valid ISRC. An ISRC has 12 characters, like USRC17607839.`);
        }
        if (!isrcs.includes(isrc)) isrcs.push(isrc);
    }
    return ok(isrcs);
}

export function parseSourceUrl(input: string): Parsed<string> {
    const s = input.trim();
    if (!s) return ok(undefined);
    try {
        const url = new URL(s);
        if (url.protocol === "http:" || url.protocol === "https:") return ok(url.href);
    } catch {
        // fall through
    }
    return fail("Enter a full web address starting with https://");
}

// --- Saving ------------------------------------------------------------------

export interface NewSong {
    title: string;
    artists: string[];
    album?: string;
    durationMs?: number;
    externalIds: LibraryEntry["externalIds"];
    sourceUrl?: string;
}

/** Thrown when the song's Spotify track or MusicBrainz recording is already in the library. */
export class DuplicateSongError extends Error {
    constructor(
        readonly field: "spotify" | "mbid",
        readonly existing: LibraryEntry,
    ) {
        super(`“${existing.title}” by ${existing.artists.join(", ")} is already in your library with this ID.`);
    }
}

export async function addSongToLibrary(song: NewSong): Promise<LibraryEntry> {
    const state = await readFromStorage();
    const existing = Object.values(state.entries);

    const { spotify, mbidRecording } = song.externalIds;
    const sameSpotify = spotify && existing.find(e => e.externalIds.spotify === spotify);
    if (sameSpotify) throw new DuplicateSongError("spotify", sameSpotify);
    const sameMbid = mbidRecording && existing.find(e => e.externalIds.mbidRecording === mbidRecording);
    if (sameMbid) throw new DuplicateSongError("mbid", sameMbid);

    const now = new Date().toISOString();
    const entry: LibraryEntry = {
        id: crypto.randomUUID(),
        title: song.title,
        artists: song.artists,
        album: song.album,
        durationMs: song.durationMs,
        externalIds: song.externalIds,
        // With an MBID there's nothing left to look up; without one, the resolver should try.
        resolveStatus: mbidRecording ? "resolved" : "pending",
        addedAt: now,
        custom_order_index: existing.reduce((max, e) => Math.max(max, e.custom_order_index ?? 0), 0) + 1,
        sources: song.sourceUrl ? [{ url: song.sourceUrl, context: "Added manually", savedAt: now }] : [],
    };
    await writeToStorage({ ...state, entries: { ...state.entries, [entry.id]: entry } });
    return entry;
}

// --- Component -----------------------------------------------------------------

interface FormValues {
    title: string;
    artists: string[];
    album: string;
    length: string;
    spotify: string;
    mbid: string;
    isrc: string;
    sourceUrl: string;
}

type FieldName = "title" | "artists" | "length" | "spotify" | "mbid" | "isrc" | "sourceUrl";
type Errors = Partial<Record<FieldName, string>>;

const EMPTY: FormValues = {
    title: "",
    artists: [""],
    album: "",
    length: "",
    spotify: "",
    mbid: "",
    isrc: "",
    sourceUrl: "",
};
const FIELD_ORDER: FieldName[] = ["title", "artists", "length", "spotify", "mbid", "isrc", "sourceUrl"];
const ID_FIELDS: FieldName[] = ["spotify", "mbid", "isrc", "sourceUrl"];

function validate(values: FormValues): { song?: NewSong; errors: Errors } {
    const errors: Errors = {};
    const title = values.title.trim();
    if (!title) errors.title = "Enter the song name.";
    const artists = values.artists.map(a => a.trim()).filter(Boolean);
    if (artists.length === 0) errors.artists = "Enter at least one artist.";

    const length = parseLength(values.length);
    const spotify = parseSpotifyTrack(values.spotify);
    const mbid = parseRecordingMbid(values.mbid);
    const isrc = parseIsrcs(values.isrc);
    const sourceUrl = parseSourceUrl(values.sourceUrl);
    if (!length.ok) errors.length = length.error;
    if (!spotify.ok) errors.spotify = spotify.error;
    if (!mbid.ok) errors.mbid = mbid.error;
    if (!isrc.ok) errors.isrc = isrc.error;
    if (!sourceUrl.ok) errors.sourceUrl = sourceUrl.error;

    if (!length.ok || !spotify.ok || !mbid.ok || !isrc.ok || !sourceUrl.ok || Object.keys(errors).length > 0) {
        return { errors };
    }
    return {
        errors,
        song: {
            title,
            artists,
            album: values.album.trim() || undefined,
            durationMs: length.value,
            externalIds: {
                ...(spotify.value && { spotify: spotify.value }),
                ...(mbid.value && { mbidRecording: mbid.value }),
                ...(isrc.value && { isrc: isrc.value }),
            },
            sourceUrl: sourceUrl.value,
        },
    };
}

export function AddSongForm({ onAdded, onCancel }: AddSongFormProps) {
    const baseId = useId();
    const fieldId = (name: string) => `${baseId}-${name}`;
    const errorId = (name: FieldName) => `${baseId}-${name}-error`;

    const [values, setValues] = useState<FormValues>(EMPTY);
    const [errors, setErrors] = useState<Errors>({});
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState<string | null>(null);
    const [showIds, setShowIds] = useState(false);

    const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
        setValues(v => ({ ...v, [key]: value }));
        setSaved(null);
        // Clear a field's error as soon as it's edited; it's checked again on submit.
        if (key in errors) setErrors(({ [key as FieldName]: _, ...rest }) => rest);
    };

    const setArtist = (index: number, value: string) =>
        set(
            "artists",
            values.artists.map((a, i) => (i === index ? value : a)),
        );
    const addArtist = () => {
        set("artists", [...values.artists, ""]);
        requestAnimationFrame(() => document.getElementById(fieldId(`artists-${values.artists.length}`))?.focus());
    };
    const removeArtist = (index: number) => {
        set(
            "artists",
            values.artists.filter((_, i) => i !== index),
        );
        requestAnimationFrame(() => document.getElementById(fieldId(`artists-${Math.max(0, index - 1)}`))?.focus());
    };

    const focusField = (name: FieldName) =>
        requestAnimationFrame(() => document.getElementById(fieldId(name === "artists" ? "artists-0" : name))?.focus());

    const showErrors = (next: Errors) => {
        setErrors(next);
        const first = FIELD_ORDER.find(f => next[f]);
        if (!first) return;
        if (ID_FIELDS.includes(first)) setShowIds(true);
        focusField(first);
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        const { song, errors: found } = validate(values);
        if (!song) return showErrors(found);

        setSaving(true);
        try {
            const entry = await addSongToLibrary(song);
            setValues(EMPTY);
            setErrors({});
            setSaved(`Added “${entry.title}” to your library.`);
            focusField("title"); // ready for the next song
            onAdded?.(entry);
        } catch (err) {
            if (err instanceof DuplicateSongError) showErrors({ [err.field]: err.message });
            else setSaved(`Couldn't add the song: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setSaving(false);
        }
    };

    /** Props shared by every validated input. */
    const a11y = (name: FieldName) => ({
        "aria-invalid": errors[name] ? true : undefined,
        "aria-describedby": errors[name] ? errorId(name) : undefined,
    });
    const error = (name: FieldName) =>
        errors[name] ? (
            <p id={errorId(name)} className={styles.error}>
                {errors[name]}
            </p>
        ) : null;

    return (
        <form className={styles.form} onSubmit={submit} noValidate aria-labelledby={fieldId("heading")}>
            <h2 id={fieldId("heading")} className={styles.heading}>
                Add a song
            </h2>

            <div className={styles.field}>
                <label htmlFor={fieldId("title")} className={styles.label}>
                    Song name
                </label>
                <input
                    id={fieldId("title")}
                    className={styles.input}
                    value={values.title}
                    onChange={e => set("title", e.target.value)}
                    autoComplete="off"
                    {...a11y("title")}
                />
                {error("title")}
            </div>

            <fieldset className={styles.field} aria-describedby={errors.artists ? errorId("artists") : undefined}>
                <legend className={styles.label}>{values.artists.length > 1 ? "Artists" : "Artist"}</legend>
                {values.artists.map((artist, i) => (
                    <div key={i} className={styles.artistRow}>
                        <input
                            id={fieldId(`artists-${i}`)}
                            className={styles.input}
                            value={artist}
                            onChange={e => setArtist(i, e.target.value)}
                            aria-label={values.artists.length > 1 ? `Artist ${i + 1}` : "Artist"}
                            aria-invalid={errors.artists && i === 0 ? true : undefined}
                            autoComplete="off"
                        />
                        {values.artists.length > 1 && (
                            <button
                                type="button"
                                className={styles.iconButton}
                                onClick={() => removeArtist(i)}
                                aria-label={`Remove artist ${i + 1}${artist.trim() ? `, ${artist.trim()}` : ""}`}
                            >
                                ×
                            </button>
                        )}
                    </div>
                ))}
                {error("artists")}
                <button type="button" className={styles.linkButton} onClick={addArtist}>
                    Add another artist
                </button>
            </fieldset>

            <div className={styles.pair}>
                <div className={styles.field}>
                    <label htmlFor={fieldId("album")} className={styles.label}>
                        Album <span className={styles.optional}>(optional)</span>
                    </label>
                    <input
                        id={fieldId("album")}
                        className={styles.input}
                        value={values.album}
                        onChange={e => set("album", e.target.value)}
                        autoComplete="off"
                    />
                </div>
                <div className={styles.field}>
                    <label htmlFor={fieldId("length")} className={styles.label}>
                        Length <span className={styles.optional}>(optional)</span>
                    </label>
                    <input
                        id={fieldId("length")}
                        className={`${styles.input} ${styles.lengthInput}`}
                        value={values.length}
                        onChange={e => set("length", e.target.value)}
                        placeholder="3:45"
                        inputMode="numeric"
                        autoComplete="off"
                        {...a11y("length")}
                    />
                </div>
                {error("length")}
            </div>

            <details className={styles.ids} open={showIds} onToggle={e => setShowIds(e.currentTarget.open)}>
                <summary className={styles.summary}>Links and IDs (optional)</summary>
                <div className={styles.idFields}>
                    <p className={styles.hint}>
                        These identify the exact recording, so the same song isn't saved twice and other services can
                        find it.
                    </p>

                    <div className={styles.field}>
                        <label htmlFor={fieldId("spotify")} className={styles.label}>
                            Spotify track link
                        </label>
                        <input
                            id={fieldId("spotify")}
                            className={styles.input}
                            value={values.spotify}
                            onChange={e => set("spotify", e.target.value)}
                            placeholder="https://open.spotify.com/track/…"
                            autoComplete="off"
                            spellCheck={false}
                            {...a11y("spotify")}
                        />
                        {error("spotify")}
                    </div>

                    <div className={styles.field}>
                        <label htmlFor={fieldId("mbid")} className={styles.label}>
                            MusicBrainz recording
                        </label>
                        <input
                            id={fieldId("mbid")}
                            className={styles.input}
                            value={values.mbid}
                            onChange={e => set("mbid", e.target.value)}
                            placeholder="https://musicbrainz.org/recording/…"
                            autoComplete="off"
                            spellCheck={false}
                            {...a11y("mbid")}
                        />
                        {error("mbid")}
                    </div>

                    <div className={styles.field}>
                        <label htmlFor={fieldId("isrc")} className={styles.label}>
                            ISRC
                        </label>
                        <input
                            id={fieldId("isrc")}
                            className={styles.input}
                            value={values.isrc}
                            onChange={e => set("isrc", e.target.value)}
                            placeholder="USRC17607839"
                            autoComplete="off"
                            spellCheck={false}
                            {...a11y("isrc")}
                        />
                        {error("isrc")}
                    </div>

                    <div className={styles.field}>
                        <label htmlFor={fieldId("sourceUrl")} className={styles.label}>
                            Where you found it
                        </label>
                        <input
                            id={fieldId("sourceUrl")}
                            type="url"
                            className={styles.input}
                            value={values.sourceUrl}
                            onChange={e => set("sourceUrl", e.target.value)}
                            placeholder="https://…"
                            autoComplete="off"
                            spellCheck={false}
                            {...a11y("sourceUrl")}
                        />
                        {error("sourceUrl")}
                    </div>
                </div>
            </details>

            <div className={styles.footer}>
                <p className={styles.status} role="status" aria-live="polite">
                    {saved}
                </p>
                <div className={styles.buttons}>
                    {onCancel && (
                        <button type="button" className={styles.secondary} onClick={onCancel}>
                            Cancel
                        </button>
                    )}
                    <button type="submit" className={styles.primary} disabled={saving}>
                        {saving ? "Adding…" : "Add to library"}
                    </button>
                </div>
            </div>
        </form>
    );
}
