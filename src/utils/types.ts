/**
 * A library entry identifies one specific *recording* (a particular studio,
 * live, remix... version), not the underlying composition.
 */
export interface LibraryEntry {
    /** Internal, stable key. Never changes, even as external IDs get resolved. */
    id: string;
    title: string;
    artists: string[];
    album?: string;
    durationMs?: number;
    externalIds: ExternalIds;
    /** Status of MusicBrainz recording resolution. */
    resolveStatus: "pending" | "resolved" | "not_found";
    addedAt: string; // ISO 8601
    custom_order_index: number;
    sources: EntrySource[];
}

export interface ExternalIds {
    /** Spotify track ID (22 chars, base62). */
    spotify?: string;
    /** MusicBrainz *recording* MBID. */
    mbidRecording?: string;
    /** A recording can carry several ISRCs (reissues, compilations...). */
    isrc?: string[];
}

export interface EntrySource {
    url: string;
    /** Human-readable context, e.g. "Spotify playlist: Road trip". */
    context?: string;
    savedAt: string; // ISO 8601
}

/** One row read from the Spotify web player's playlist view. */
export interface HarvestedTrack {
    /** 1-based position in the playlist. */
    position: number;
    spotifyId: string;
    title: string;
    artists: string[];
    album?: string;
    durationMs?: number;
}

export interface HarvestProgress {
    type: "harvest-progress";
    tabId?: number;
    collected: number;
    expected: number | null;
    pass: number;
    /** True while waiting for the user to switch back to the Spotify tab. */
    paused: boolean;
    tracks: HarvestedTrack[];
}

export type HarvestResult =
    | {
          ok: true;
          playlistName: string | null;
          tracks: HarvestedTrack[];
          /** Total rows Spotify reports for the playlist, if available. */
          expectedCount: number | null;
          /** Rows that aren't Spotify tracks and were deliberately skipped. */
          skipped: { localOrUnavailable: number; episodes: number };
          /** True when every row the playlist reports was accounted for. */
          complete: boolean;
      }
    | { ok: false; error: string };

export type ExportResult =
    | {
          ok: true;
          playlistName: string | null;
          /** Tracks read from the page. */
          harvested: number;
          /** Rows the playlist reports (null if Spotify didn't expose a count). */
          expected: number | null;
          /** False if some rows couldn't be read; the user may want to retry. */
          complete: boolean;
          added: number;
          alreadyInLibrary: number;
          skipped: { localOrUnavailable: number; episodes: number };
      }
    | {
          ok: false;
          reason: "no-tab" | "not-a-playlist" | "already-running" | "harvest-failed";
          message: string;
      };

export interface ExportRequest {
    type: "export-playlist";
    tabId: number;
    tabUrl: string;
}
