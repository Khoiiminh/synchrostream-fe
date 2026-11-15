export interface PlaybackDriftSample {
    timestamp: number;
    participantId: string;
    actualPositionSeconds: number;
    expectedPositionSeconds: number;
    driftMs: number;
    playbackState: "PLAYING" | "PAUSED";
}

export class SyncMetrics {
    private readonly samples: PlaybackDriftSample[] = [];

    private readonly driftToleranceMs = 250;

    public recordPlaybackDrift(sample: PlaybackDriftSample): void {
        this.samples.push(sample);
    }

    public getPlaybackDriftSamples(): PlaybackDriftSample[] {
        return [...this.samples];
    }

    public getSampleCount(): number {
        return this.samples.length;
    }

    public clear(): void {
        this.samples.length = 0;
    }

    public exportJson(): string{
        return JSON.stringify(
            this.samples,
            null,
            2
        );
    }

    public downloadJson(filename = "synchrostream-sync-metrics.json"): void {
        if (typeof window === "undefined") {
            return;
        }

        const blob = new Blob(
            [this.exportJson()],
            {
                type: "application/json",
            },
        );

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");

        anchor.href = url;
        anchor.download = filename;

        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);

        URL.revokeObjectURL(url);
    }
}