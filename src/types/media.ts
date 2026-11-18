/** Transcode states the admin dashboard tracks; mirrors backend `processing_status`. */
export type CloudTranscodeStatus =
    | "IDLE"
    | "PROCESSING"
    | "AVAILABLE"
    | "FAILED";

/** Payload of the admin telemetry socket's `movie_status_changed` event. */
export interface MovieStatusChangedPayload {
    movieId: string;
    status: Exclude<CloudTranscodeStatus, "IDLE">;
    hlsUrl?: string;
}
