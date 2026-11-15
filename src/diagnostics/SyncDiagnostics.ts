import { PlaybackDriftSample } from "@/core/sync/SyncMetrics";

export interface SyncDiagnostics {
    getPlaybackDriftSamples(): PlaybackDriftSample[];

    getSampleCount(): number;
}