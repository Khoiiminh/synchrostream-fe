import type { MediaSyncController } from "../core/sync/MediaSyncController";
import type { PlaybackDriftSample } from "../core/sync/SyncMetrics";

export interface RapidSeekScenarioConfig {
    /** Total duration of the rapid-seek phase, in milliseconds. */
    durationMs: number;
    /** Delay between consecutive seek commands, in milliseconds. */
    seekIntervalMs: number;
    /** Minimum playback position targeted by the test, in seconds. */
    minPositionSeconds: number;
    /** Maximum playback position targeted by the test, in seconds. */
    maxPositionSeconds: number;
    /** Additional observation duration after the seek phase, in milliseconds. */
    observationWindowMs: number;
}

export type SyncTestRunStatus = "COMPLETED" | "CANCELLED";

export interface SyncTestRunResult {
    status: SyncTestRunStatus;
    startedAt: number;
    finishedAt: number;

    config: RapidSeekScenarioConfig;

    /** Playback position before the test began, in seconds. */
    initialPositionSeconds: number;
    /** Playback position when the result was collected, in seconds. */
    finalPositionSeconds: number;
    /** Number of seek commands issued during the test. */
    seekCommandsIssued: number;

    /** Number of drift samples recorded before the test began. */
    sampleCountBefore: number;
    /** Total number of drift samples recorded when the result was collected. */
    sampleCountAfter: number;

    samples: PlaybackDriftSample[];
}

/**
 * Default configuration used when no rapid-seek configuration is supplied.
 *
 * Runs the seek phase for 10 seconds, issues seeks every 250 milliseconds,
 * alternates between 5 and 120 seconds, and observes synchronization
 * behavior for an additional 5 seconds.
 */
export const DEFAULT_RAPID_SEEK_CONFIG: RapidSeekScenarioConfig = {
    durationMs: 10_000,
    seekIntervalMs: 250,
    minPositionSeconds: 5,
    maxPositionSeconds: 120,
    observationWindowMs: 5_000,
};

export class SyncTestRunner {
    private activeAbortController: AbortController | null = null;

    /**
     * Checks whether a synchronization test is currently running.
     *
     * A test is considered active while its AbortController is assigned
     * to `activeAbortController`.
     *
     * @returns `true` if a test is running; otherwise, `false`.
     */
    public get isRunning(): boolean {
        return this.activeAbortController !== null;
    }

    /**
     * Requests cancellation of the currently running synchronization test.
     *
     * Aborts the cative AbortController, allowing the test's asynchronous
     * wait operations to terminate early and the run to finish with a
     * `CANCELLED` status.
     *
     * Does nothing if no test is currently running.
     */
    public cancel(): void {
        this.activeAbortController?.abort();
    }

    /**
     * Runs a repid-seek synchronization scenario and collects playback
     * drift samples throughtout the test and observation periods.
     *
     * The scenario alternates seek commands between the configured minimum
     * and maximum positions at the specified interval. After the seek phase,
     * it waits for the observation window to capture synchronization behavior.
     *
     * Only one scenario can run at a time. The returned result includes the
     * execution status, timing information, seek count, playback positions,
     * sample counts, and collected drift samples.
     *
     * @param controller - Media synchronization controller used to issue
     * seek commands, read playback positions, and access synchronization diagnostics.
     * @param config - Configuration specifying the test duration, seek interval,
     * seek-position range, and post-test observation window.
     * Defaults to `DEFAULT_RAPID_SEEK_CONFIG`.
     *
     * @returns A promise resolving to the synchronization test result.
     *
     * @throws {Error} If another synchronization test is already running.
     * @throws {Error} If the supplied configuration is invalid.
     * @throws {Error} If synchronization diagnostics are unavailable.
     */
    public async runRapidSeekScenario(
        controller: MediaSyncController,
        config: RapidSeekScenarioConfig = DEFAULT_RAPID_SEEK_CONFIG,
    ): Promise<SyncTestRunResult> {
        if (this.isRunning) {
            throw new Error("A synchronization test is already running.");
        }

        this.validateConfig(config);

        const diagnostics = controller.getSyncDiagnostics();

        if (!diagnostics) {
            throw new Error(
                "Sync diagnostics are unavailable. Run this test in party mode.",
            );
        }

        const abortController = new AbortController();

        this.activeAbortController = abortController;

        const signal = abortController.signal;

        const initialSamples = diagnostics.getPlaybackDriftSamples();

        const startedAt = Date.now();
        const initialPositionSeconds = controller.getCurrentTime();

        let seekCommandsIssued = 0;
        let status: SyncTestRunStatus = "COMPLETED";

        try {
            let seekIndex = 0;

            while (Date.now() - startedAt < config.durationMs) {
                if (signal.aborted) {
                    status = "CANCELLED";
                    break;
                }

                const targetPositionSeconds = this.getSeekTarget(
                    seekIndex,
                    config.minPositionSeconds,
                    config.maxPositionSeconds,
                );

                controller.seek(targetPositionSeconds);

                seekCommandsIssued += 1;
                seekIndex += 1;

                const elapsedMs = Date.now() - startedAt;
                const remainingMs = config.durationMs - elapsedMs;

                if (remainingMs <= 0) {
                    break;
                }

                const shouldContinue = await this.wait(
                    Math.min(config.seekIntervalMs, remainingMs),
                    signal,
                );

                if (!shouldContinue) {
                    status = "CANCELLED";
                    break;
                }
            }

            if (status === "COMPLETED" && !signal.aborted) {
                const observationCompleted = await this.wait(
                    config.observationWindowMs,
                    signal,
                );

                if (!observationCompleted) {
                    status = "CANCELLED";
                }
            } else {
                status = "CANCELLED";
            }
        } finally {
            if (this.activeAbortController === abortController) {
                this.activeAbortController = null;
            }
        }

        const finishedAt = Date.now();
        const finalSamples = diagnostics.getPlaybackDriftSamples();

        const samples = finalSamples.filter((sample) => {
            return (
                sample.timestamp >= startedAt && sample.timestamp <= finishedAt
            );
        });

        return {
            status,
            startedAt,
            finishedAt,
            config: { ...config },
            initialPositionSeconds,
            finalPositionSeconds: controller.getCurrentTime(),
            seekCommandsIssued,
            sampleCountBefore: initialSamples.length,
            sampleCountAfter: diagnostics.getSampleCount(),
            samples,
        };
    }

    /**
     * Determines the next seek target by alternating between the configured
     * minimum and maximum playback positions.
     *
     * Even indices select the minimum position, while odd indices select
     * the maximum position. If both positions are equal, that position
     * is returned for every index.
     *
     * @param index - Zero-based index of the seek command.
     * @param minPositionSeconds - Minimum permitted seek position, in seconds.
     * @param maxPositionSeconds - Maximum permitted seek position, in seconds.
     *
     * @returns The target playback position, in seconds.
     */
    private getSeekTarget(
        index: number,
        minPositionSeconds: number,
        maxPositionSeconds: number,
    ): number {
        const range = maxPositionSeconds - minPositionSeconds;

        if (range === 0) {
            return minPositionSeconds;
        }

        // Alternate between the configured range endpoints.
        // Deterministic targets make repeated experiments easier to compare.
        if (index % 2 === 0) {
            return minPositionSeconds;
        }

        return maxPositionSeconds;
    }

    /**
     * Validates the rapid-seek scenario configuration before execution.
     *
     * Ensures that the test duration and seek interval are positive finite
     * numbers, the observation window is a non-negative finite number, and
     * the seek-position range contains valid non-negative finite values.
     *
     * @param config - Configuration to validate.
     *
     * @throws {Error} If any configuration value violates the required constraints.
     */
    private validateConfig(config: RapidSeekScenarioConfig): void {
        if (!Number.isFinite(config.durationMs) || config.durationMs <= 0) {
            throw new Error("Test duration must be a positive number.");
        }

        if (
            !Number.isFinite(config.seekIntervalMs) ||
            config.seekIntervalMs <= 0
        ) {
            throw new Error("Seek interval must be a positive number.");
        }

        if (
            !Number.isFinite(config.observationWindowMs) ||
            config.observationWindowMs < 0
        ) {
            throw new Error("Observation window must be zero or greater.");
        }

        if (
            !Number.isFinite(config.minPositionSeconds) ||
            !Number.isFinite(config.maxPositionSeconds) ||
            config.minPositionSeconds < 0 ||
            config.maxPositionSeconds < config.minPositionSeconds
        ) {
            throw new Error(
                "Seek positions must be non-negative, with maximum greater than or equal to minimum.",
            );
        }
    }

    /**
     * Waits for the specified duration or until cancellation is requested.
     *
     * Uses a timer to complete the wait normally and an AbortSignal listener
     * to clear the timer and resolve early when cancellation occurs.
     *
     * @param durationMs - Duration to wait, in milliseconds.
     * @param signal - AbortSignal used to request cancellation.
     *
     * @returns A promise resolving to `true` if the wait completes normally,
     * or `false` if cancellation occurs before completion.
     */
    private wait(durationMs: number, signal: AbortSignal): Promise<boolean> {
        if (signal.aborted) {
            return Promise.resolve(false);
        }

        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                signal.removeEventListener("abort", handleAbort);
                resolve(true);
            }, durationMs);

            const handleAbort = () => {
                clearTimeout(timeoutId);
                signal.removeEventListener("abort", handleAbort);
                resolve(false);
            };

            signal.addEventListener("abort", handleAbort, {
                once: true,
            });
        });
    }
}
