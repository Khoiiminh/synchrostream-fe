import type { PlaybackDriftSample } from "./SyncMetrics";

/** Read access to a controller's drift samples, used by the sync test runner and admin diagnostics. */
export interface SyncDiagnostics {
    getPlaybackDriftSamples(): PlaybackDriftSample[];

    getSampleCount(): number;
}
