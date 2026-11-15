import { SyncDiagnostics } from "@/diagnostics/SyncDiagnostics";
import { ISyncAdapter } from "./ISyncAdapter";

interface SyncMetricsProvider extends SyncDiagnostics{
    downloadJson(filename?: string): void;
}

interface SyncMetricsProviderAccessor {
    getSyncMetrics(): SyncMetricsProvider;
}

/**
 * Controls media playback through an ISyncAdapter implementation.
 *
 * Manages video attachment, playback, seeking, quality selection,
 * and access to optional synchronization diagnostics.
 */
export class MediaSyncController {
    private attached = false;

    /**
     * Creates a media synchronization controller.
     *
     * @param adapter - Adapter responsible for interacting with the
     * underlying media player and its playback capabilities.
     */
    constructor(private adapter: ISyncAdapter) {}

    /**
     * Attaches a video element to the underlying media adapter.
     *
     * Prevents duplicate attachment if a video is already attached.
     *
     * @param video - HTML video element to attach to the adapter.
     */
    attach(video: HTMLVideoElement) {
        if (this.attached) {
            console.warn('MediaSyncController already attached');

            return;
        }

        this.adapter.attachVideo(video);
        this.attached = true;
    }

    /**
     * Starts media playback if a video has been attached.
     *
     * Waits for the adapter's playback operation to complete.
     * Logs a warning and returns without playing if no video
     * is attached.
     *
     * @returns A promise that resolves when the adapter's play
     * operation completes.
     */
    async play() {
        if (!this.attached) {
            console.warn('Cannot play before attaching video');
            return;
        }

        await this.adapter.play();
    }

    /**
     * Pauses media playback if a video is attached.
     *
     * Does nothing if no video is currently attached.
     *
     * @returns A promise that resolves when the adapter's pause
     * operation completes.
     */
    async pause() {
        if (!this.attached) {
            return;
        }

        await this.adapter.pause();
    }

    /**
     * Seeks to the specified playback position.
     *
     * Does nothing if no video is currently attached.
     *
     * @param seconds - Target playback position in seconds.
     */
    seek(seconds: number) {
        if (!this.attached) return;

        this.adapter.seek(seconds);
    }

    /**
     * Disposes of the underlying adapter and resets the attachment
     * state.
     *
     * This delegates resource cleanup to the adapter. Unlike
     * detach(), it does not explicitly call detachVideo().
     */
    dispose() {
        this.adapter.dispose();

        this.attached = false;
    }

    /**
     * Detaches the currently attached video from the adapter.
     *
     * Does nothing if no video is attached. Unlike dispose(),
     * this method does not dispose of the adapter itself.
     */
    detach() {
        if (!this.attached) {
            return;
        }

        this.adapter.detachVideo();
        this.attached = false;
    }

    /**
     * Retrieves the available media quality levels.
     *
     * @returns The quality levels reported by the adapter.
     */
    getQualityLevels() {
        return this.adapter.getQualityLevels();
    }

    /**
     * Selects a media quality level through the adapter.
     *
     * @param level - Quality level identifier or index expected
     * by the adapter.
     */
    setQualityLevel(level:number) {
        this.adapter.setQualityLevel(level);
    }

    /**
     * Retrieves the current playback position.
     *
     * @returns The current playback position in seconds.
     */
    getCurrentTime() {
        return this.adapter.getCurrentTime();
    }

    /**
     * Retrieves the index of the currently selected quality level.
     *
     * @returns The current quality level index reported by
     * the adapter.
     */
    getCurrentQualityIndex() {
        return this.adapter.getCurrentQualityIndex();
    }

    /**
     * Downloads synchronization metrics as a JSON file.
     *
     * Checks whether the underlying adapter supports synchronization
     * metrics. If the provider is unavailable, logs a warning and
     * returns without downloading a file.
     *
     * @param filename - Name of the downloaded JSON file.
     * Defaults to "synchrostream-sync-metrics.json".
     */
    public downloadSyncMetrics(filename = "synchrostream-sync-metrics.json"): void {
        const metricsProvider = this.adapter as ISyncAdapter & Partial<SyncMetricsProviderAccessor>;

        if (!metricsProvider.getSyncMetrics) {
            console.warn(
                "[MediaSyncController] Sync metrics are only available in party mode.",
            );

            return;
        }

        metricsProvider.getSyncMetrics().downloadJson(filename);
    }

    /**
     * Retrieves synchronization diagnostics when supported by
     * the underlying adapter.
     *
     * Returns null if the adapter does not expose a synchronization
     * metrics provider, such as when running outside party mode.
     *
     * @returns The synchronization diagnostics provider, or null
     * if diagnostics are unavailable.
     */
    public getSyncDiagnostics(): SyncDiagnostics | null {
        const metricsProvider = this.adapter as ISyncAdapter & Partial<SyncMetricsProviderAccessor>;

        if (!metricsProvider.getSyncMetrics) {
            return null;
        }

        return metricsProvider.getSyncMetrics();
    }
}