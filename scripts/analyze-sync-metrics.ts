import { readFileSync } from "node:fs";

type PlaybackState = "PLAYING" | "PAUSED";

interface PlaybackDriftSample {
    timestamp: number;
    participantId: string;
    actualPositionSeconds: number;
    expectedPositionSeconds: number;
    driftMs: number;
    playbackState: PlaybackState;
}

interface DriftStatistics {
    count: number;
    meanMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    standardDeviationMs: number;
}

const TOLERANCES_MS = [50, 100, 150, 200, 250, 300, 400, 500];
const TIMELINE_BUCKET_COUNT = 20;

/**
 * Reports a fatal error and terminates the Node.js process.
 *
 * Writes the supplied message to standard error, then exits with status code
 * 1 to indicate that the script did not complete successfully.
 *
 * @param message - The error description to display.
 * @returns Never returns because the process terminates.
 *
 * @example
 * fail("The JSON root must be an array of playback drift samples.");
 */
function fail(message: string): never {
    console.error(`Error: ${message}`);
    process.exit(1);
}

/**
 * Checks whether an unknown value is a finite JavaScript number.
 *
 * Rejects non-number values, NaN, Infinity, and -Infinity.
 * Acts as a TypeScript type guard, narrowing the value's type to `number`
 * when the result is true.
 *
 * @param value - The value to validate.
 * @returns True if the value is a finite number; otherwise, false.
 *
 * @example
 * isFiniteNumber(12.5);     // true
 * isFiniteNumber(NaN);      // false
 * isFiniteNumber(Infinity); // false
 * isFiniteNumber("12.5");   // false
 */
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates one unknown JSON value against the PlaybackDriftSample structure.
 *
 * Checks that the value is a non-null object and not an array, then validates
 * each required property:
 *
 * - timestamp: finite number >= 0.
 * - participantId: non-empty string after trimming.
 * - actualPositionSeconds: finite number >= 0.
 * - expectedPositionSeconds: finite number >= 0.
 * - driftMs: finite number >= 0.
 * - playbackState: exactly "PLAYING" or "PAUSED".
 *
 * If any check fails, calls `fail()` with the sample index and terminates
 * the script. Otherwise, returns the object with the PlaybackDriftSample type.
 *
 * Note: This function validates the supplied drift value; it does not verify
 * that driftMs equals the absolute difference between the two positions.
 *
 * @param value - The unknown value to validate, typically from parsed JSON.
 * @param index - Zero-based position of the sample in the input array.
 * @returns The validated value typed as PlaybackDriftSample.
 */
function validateSample(value: unknown, index: number): PlaybackDriftSample {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        fail(`Sample at index ${index} must be an object.`);
    }

    const sample = value as Record<string, unknown>;

    if (!isFiniteNumber(sample.timestamp) || sample.timestamp < 0) {
        fail(`Sample ${index}: timestamp must be a non-negative number.`);
    }

    if (
        typeof sample.participantId !== "string" ||
        sample.participantId.trim().length === 0
    ) {
        fail(`Sample ${index}: participantId must be a non-empty string.`);
    }

    if (
        !isFiniteNumber(sample.actualPositionSeconds) ||
        sample.actualPositionSeconds < 0
    ) {
        fail(
            `Sample ${index}: actualPositionSeconds must be a non-negative number.`,
        );
    }

    if (
        !isFiniteNumber(sample.expectedPositionSeconds) ||
        sample.expectedPositionSeconds < 0
    ) {
        fail(
            `Sample ${index}: expectedPositionSeconds must be a non-negative number.`,
        );
    }

    if (!isFiniteNumber(sample.driftMs) || sample.driftMs < 0) {
        fail(`Sample ${index}: driftMs must be a non-negative number.`);
    }

    if (
        sample.playbackState !== "PLAYING" &&
        sample.playbackState !== "PAUSED"
    ) {
        fail(`Sample ${index}: playbackState must be PLAYING or PAUSED.`);
    }

    return sample as unknown as PlaybackDriftSample;
}

/**
 * Calculates a percentile from an ascending-sorted array using linear
 * interpolation between adjacent observations.
 *
 * The fractional index is:
 *
 *   index = (p / 100) * (n - 1)
 *
 * where p is the requested percentile and n is the number of observations.
 *
 * If the index is an integer, returns the value at that index. Otherwise:
 *
 *   lowerIndex = floor(index)
 *   upperIndex = ceil(index)
 *   fraction = index - lowerIndex
 *
 *   percentile =
 *     sortedValues[lowerIndex] * (1 - fraction)
 *     + sortedValues[upperIndex] * fraction
 *
 * An empty array returns 0. The caller must provide values sorted in
 * ascending order. The percentile argument is not explicitly range-validated.
 *
 * @param sortedValues - Numeric observations sorted from smallest to largest.
 * @param p - Requested percentile, conventionally between 0 and 100.
 * @returns The calculated percentile value.
 *
 * @example
 * // Values: [10, 20, 30, 40, 50]
 * percentile([10, 20, 30, 40, 50], 50); // 30
 * percentile([10, 20, 30, 40, 50], 95); // 48
 * percentile([10, 20, 30, 40, 50], 99); // 49.6
 */
function percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) {
        return 0;
    }

    const index = (p / 100) * (sortedValues.length - 1);
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.ceil(index);

    if (lowerIndex === upperIndex) {
        return sortedValues[lowerIndex];
    }

    const fraction = index - lowerIndex;

    return (
        sortedValues[lowerIndex] * (1 - fraction) +
        sortedValues[upperIndex] * fraction
    );
}

/**
 * Calculates descriptive statistics for a collection of playback-drift samples.
 *
 * Extracts each sample's driftMs, sorts a copy of those values for percentile
 * calculations, and returns the count, mean, P50, P95, P99, maximum, and
 * population standard deviation.
 *
 * Mean:
 *   meanMs = Σx[i] / n
 *
 * Percentile:
 *   index = (p / 100) * (n - 1)
 *
 *   Uses `percentile()` to interpolate between neighboring sorted values.
 *
 * Maximum:
 *   maxMs = sortedValues[n - 1]
 *
 * Population variance:
 *   variance = Σ(x[i] - meanMs)² / n
 *
 * Population standard deviation:
 *   standardDeviationMs = √variance
 *
 * The variance divides by n, not n - 1, so the result is the population
 * standard deviation of the supplied observations.
 *
 * Worked example for drift values [10, 20, 30, 40, 50] ms:
 *
 *   n = 5
 *   meanMs = (10 + 20 + 30 + 40 + 50) / 5 = 30 ms
 *   P50 = 30 ms
 *   P95 = 48 ms
 *   P99 = 49.6 ms
 *   maxMs = 50 ms
 *
 *   variance = [(10 - 30)² + (20 - 30)² + (30 - 30)²
 *               + (40 - 30)² + (50 - 30)²] / 5
 *            = 200 ms²
 *
 *   standardDeviationMs = √200 ≈ 14.14 ms
 *
 * Returns null for an empty array because the statistics cannot be meaningfully
 * calculated without observations.
 *
 * @param samples - Playback-drift samples to analyze.
 * @returns The calculated DriftStatistics, or null if samples is empty.
 */
function calculateStatistics(
    samples: PlaybackDriftSample[],
): DriftStatistics | null {
    if (samples.length === 0) {
        return null;
    }

    const values = samples.map((sample) => sample.driftMs);
    const sortedValues = [...values].sort((a, b) => a - b);

    const meanMs =
        values.reduce((total, value) => total + value, 0) / values.length;

    const variance =
        values.reduce((total, value) => {
            return total + Math.pow(value - meanMs, 2);
        }, 0) / values.length;

    return {
        count: values.length,
        meanMs,
        p50Ms: percentile(sortedValues, 50),
        p95Ms: percentile(sortedValues, 95),
        p99Ms: percentile(sortedValues, 99),
        maxMs: sortedValues[sortedValues.length - 1],
        standardDeviationMs: Math.sqrt(variance),
    };
}

/**
 * Formats a numeric drift or duration value in milliseconds to two decimal
 * places and appends the "ms" unit.
 *
 * This function is for report presentation; it does not alter the original
 * numeric value used in statistical calculations.
 *
 * @param value - Numeric value measured in milliseconds.
 * @returns A string containing the value to two decimal places and "ms".
 *
 * @example
 * formatMs(12);      // "12.00 ms"
 * formatMs(12.345);  // "12.35 ms"
 */
function formatMs(value: number): string {
    return `${value.toFixed(2)} ms`;
}

/**
 * Formats a duration measured in seconds for the experiment overview.
 *
 * For durations shorter than one minute, displays seconds to two decimal
 * places. For durations of one minute or longer, displays whole minutes
 * and the remaining whole seconds.
 *
 * For example, 125.7 seconds becomes "2 min 5 sec"; the fractional second
 * is omitted in the minutes format.
 *
 * @param seconds - Duration in seconds.
 * @returns A human-readable duration string.
 *
 * @example
 * formatDuration(12.5);  // "12.50 seconds"
 * formatDuration(125.7); // "2 min 5 sec"
 * formatDuration(60);    // "1 min 0 sec"
 */
function formatDuration(seconds: number): string {
    const wholeSeconds = Math.floor(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const remainingSeconds = wholeSeconds % 60;

    if (minutes === 0) {
        return `${seconds.toFixed(2)} seconds`;
    }

    return `${minutes} min ${remainingSeconds} sec`;
}

/**
 * Formats elapsed seconds as a zero-padded MM:SS timeline label.
 *
 * Calculates whole elapsed minutes and the remaining whole seconds.
 * Unlike a clock time, the minute component is not restricted to 0–59,
 * so the label can represent elapsed durations longer than one hour.
 *
 * @param seconds - Elapsed time in seconds.
 * @returns A string formatted as MM:SS, with each component zero-padded
 *          to at least two characters.
 *
 * @example
 * formatElapsed(65);   // "01:05"
 * formatElapsed(600);  // "10:00"
 * formatElapsed(3665); // "61:05"
 */
function formatElapsed(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${String(minutes).padStart(2, "0")}:${String(
        remainingSeconds,
    ).padStart(2, "0")}`;
}

/**
 * Prints descriptive playback-drift statistics and guidance for interpreting
 * them for a specified group of samples.
 *
 * First prints the section title and description, then calls
 * `calculateStatistics()` to calculate the metrics. If no samples exist,
 * prints a message and returns without printing numerical statistics.
 *
 * Otherwise, prints:
 * - Sample count and mean drift.
 * - Median (P50), P95, and P99 drift.
 * - Maximum observed drift.
 * - Population standard deviation.
 * - Explanations of how to interpret the median, percentiles, and maximum.
 *
 * This function handles report presentation; the statistical calculations
 * are delegated to `calculateStatistics()`.
 *
 * @param title - Heading for the report section.
 * @param description - Explanation of which observations the section covers.
 * @param samples - Samples whose statistics should be calculated and printed.
 * @returns Nothing. Writes the report to the console.
 */
function printStatistics(
    title: string,
    description: string,
    samples: PlaybackDriftSample[],
): void {
    console.log(`\n${title}`);
    console.log("-".repeat(title.length));
    console.log(description);

    const statistics = calculateStatistics(samples);

    if (statistics === null) {
        console.log("No samples available for this playback state.");
        return;
    }

    console.log(`Samples analyzed:       ${statistics.count}`);
    console.log(`Mean drift:             ${formatMs(statistics.meanMs)}`);
    console.log(`Median drift (P50):     ${formatMs(statistics.p50Ms)}`);
    console.log(`95th percentile (P95):  ${formatMs(statistics.p95Ms)}`);
    console.log(`99th percentile (P99):  ${formatMs(statistics.p99Ms)}`);
    console.log(`Maximum observed drift: ${formatMs(statistics.maxMs)}`);
    console.log(
        `Standard deviation:     ${formatMs(statistics.standardDeviationMs)}`,
    );

    console.log("\nHow to read these values:");
    console.log(
        `- Median: half of the observations are at or below ${formatMs(statistics.p50Ms)}.`,
    );
    console.log(
        `- P95: approximately 95% of observations are at or below ${formatMs(statistics.p95Ms)}.`,
    );
    console.log(
        `- P99: approximately 99% of observations are at or below ${formatMs(statistics.p99Ms)}.`,
    );
    console.log(
        `- Maximum: the largest drift recorded in these ${statistics.count} observations.`,
    );
}

/**
 * Evaluates the percentage of observations within each configured drift
 * tolerance and prints the results as a table.
 *
 * Uses the thresholds in TOLERANCES_MS. For each tolerance T:
 *
 *   withinToleranceCount = count(driftMs <= T)
 *
 *   exceedingToleranceCount = totalSamples - withinToleranceCount
 *
 *   accuracyPercentage =
 *     (withinToleranceCount / totalSamples) * 100
 *
 * An observation exactly equal to the tolerance is considered within tolerance.
 * If the sample array is empty, prints a message and skips the calculations.
 *
 * Here, "accuracy" means the percentage of measurements within a chosen drift
 * threshold; it is not a general measure of system correctness.
 *
 * @param title - Heading identifying the tolerance-analysis section.
 * @param samples - Samples evaluated against every configured tolerance.
 * @returns Nothing. Prints the results and column definitions to the console.
 */
function printToleranceAnalysis(
    title: string,
    samples: PlaybackDriftSample[],
): void {
    console.log(`\n${title}`);
    console.log("-".repeat(title.length));

    if (samples.length === 0) {
        console.log("No samples available for tolerance analysis.");
        return;
    }

    console.log("Tolerance | Within / Total | Exceeding | Within tolerance");
    console.log("----------|----------------|-----------|-----------------");

    for (const toleranceMs of TOLERANCES_MS) {
        const withinToleranceCount = samples.filter((sample) => {
            return sample.driftMs <= toleranceMs;
        }).length;

        const exceedingToleranceCount = samples.length - withinToleranceCount;

        const accuracyPercentage =
            (withinToleranceCount / samples.length) * 100;

        const withinText =
            `${withinToleranceCount} / ${samples.length}`.padStart(14);

        console.log(
            `${String(toleranceMs).padStart(9)} | ${withinText} | ` +
                `${String(exceedingToleranceCount).padStart(9)} | ` +
                `${accuracyPercentage.toFixed(2)}%`,
        );
    }

    console.log("\nColumn definitions:");
    console.log(
        "- Within / Total: observations with drift <= tolerance, divided by all observations in this section.",
    );
    console.log("- Exceeding: observations with drift > tolerance.");
    console.log(
        "- Within tolerance: Within / Total expressed as a percentage.",
    );
}

/**
 * Prints a time-bucketed timeline of the maximum playback drift recorded
 * throughout the experiment.
 *
 * Processing steps:
 * 1. Sorts a copy of the samples by timestamp.
 * 2. Determines the first timestamp, last timestamp, and elapsed duration.
 * 3. Handles empty input and the special case where every timestamp is equal.
 * 4. Divides the elapsed interval into at most TIMELINE_BUCKET_COUNT buckets,
 *    with no more buckets than there are observations.
 * 5. Assigns each sample to a bucket based on its elapsed timestamp.
 * 6. Tracks each bucket's maximum drift and PLAYING/PAUSED sample counts.
 * 7. Prints each interval and a bar scaled against the largest bucket maximum.
 *
 * Bucket selection:
 *
 *   elapsedMs = sample.timestamp - firstTimestamp
 *
 *   bucketIndex = min(
 *     bucketCount - 1,
 *     floor((elapsedMs / durationMs) * bucketCount)
 *   )
 *
 * Bar scaling:
 *
 *   barLength ≈ (bucketMaximumDrift / maximumBucketDrift) * 30
 *
 * Empty buckets may occur when observations are unevenly distributed.
 * Each bar represents the maximum drift in its interval, not the average
 * or the drift of every participant at that time.
 *
 * @param samples - Samples containing timestamps, drift values, and playback
 *                  states.
 * @returns Nothing. Prints the timeline and its explanatory notes.
 */
function printTimeline(samples: PlaybackDriftSample[]): void {
    const title = "Playback Drift Over Time";

    console.log(`\n${title}`);
    console.log("-".repeat(title.length));
    console.log(
        "Each row summarizes one time interval. The bar represents the maximum drift recorded in that interval.",
    );

    if (samples.length === 0) {
        console.log("No samples available.");
        return;
    }

    const orderedSamples = [...samples].sort(
        (a, b) => a.timestamp - b.timestamp,
    );

    const firstTimestamp = orderedSamples[0].timestamp;
    const lastTimestamp = orderedSamples[orderedSamples.length - 1].timestamp;

    const durationMs = lastTimestamp - firstTimestamp;

    if (durationMs === 0) {
        console.log("All observations have the same timestamp.");
        console.log(
            `Maximum drift at that timestamp: ${formatMs(
                Math.max(...orderedSamples.map((sample) => sample.driftMs)),
            )}`,
        );
        return;
    }

    const bucketCount = Math.min(TIMELINE_BUCKET_COUNT, orderedSamples.length);

    const buckets = Array.from({ length: bucketCount }, () => ({
        samples: [] as PlaybackDriftSample[],
        maximumDriftMs: 0,
        playingCount: 0,
        pausedCount: 0,
    }));

    for (const sample of orderedSamples) {
        const elapsedMs = sample.timestamp - firstTimestamp;

        const bucketIndex = Math.min(
            bucketCount - 1,
            Math.floor((elapsedMs / durationMs) * bucketCount),
        );

        const bucket = buckets[bucketIndex];

        bucket.samples.push(sample);
        bucket.maximumDriftMs = Math.max(bucket.maximumDriftMs, sample.driftMs);

        if (sample.playbackState === "PLAYING") {
            bucket.playingCount += 1;
        } else {
            bucket.pausedCount += 1;
        }
    }

    const maximumBucketDrift = Math.max(
        ...buckets.map((bucket) => bucket.maximumDriftMs),
    );

    const elapsedWidth = 15;
    const driftWidth = 19;
    const observationsWidth = 14;
    const statesWidth = 30;
    const barWidth = 30;
    const columnGap = "  ";

    console.log(
        "\n" +
            "Elapsed".padEnd(elapsedWidth) +
            columnGap +
            "Maximum drift".padStart(driftWidth) +
            columnGap +
            "Observations".padStart(observationsWidth) +
            columnGap +
            "Playback states".padEnd(statesWidth) +
            columnGap +
            "Drift bar",
    );

    console.log(
        "-".repeat(elapsedWidth) +
            columnGap +
            "-".repeat(driftWidth) +
            columnGap +
            "-".repeat(observationsWidth) +
            columnGap +
            "-".repeat(statesWidth) +
            columnGap +
            "-".repeat(barWidth),
    );

    buckets.forEach((bucket, index) => {
        const startSeconds = (index / bucketCount) * (durationMs / 1000);

        const endSeconds = ((index + 1) / bucketCount) * (durationMs / 1000);

        const barLength =
            maximumBucketDrift === 0
                ? 0
                : Math.max(
                      1,
                      Math.round(
                          (bucket.maximumDriftMs / maximumBucketDrift) *
                              barWidth,
                      ),
                  );

        const bar = "#".repeat(barLength);

        const interval = `${formatElapsed(startSeconds)}-${formatElapsed(endSeconds)}`;

        const playbackStates =
            `PLAYING: ${bucket.playingCount}, ` +
            `PAUSED: ${bucket.pausedCount}`;

        console.log(
            interval.padEnd(elapsedWidth) +
                columnGap +
                formatMs(bucket.maximumDriftMs).padStart(driftWidth) +
                columnGap +
                String(bucket.samples.length).padStart(observationsWidth) +
                columnGap +
                playbackStates.padEnd(statesWidth) +
                columnGap +
                bar,
        );
    });

    console.log(
        "\nNote: each bar shows the interval's maximum, not its average. " +
            "The bar length is scaled relative to the largest interval maximum.",
    );
}

/**
 * Prints a high-level interpretation of the experiment's playback-drift data.
 *
 * Separates observations into PLAYING and PAUSED groups, reports their counts,
 * and calculates statistics for active playback when PLAYING observations
 * exist. It then reports the PLAYING median and P95 drift and evaluates the
 * percentages within 100 ms, 200 ms, and 500 ms tolerances.
 *
 * If there are no PLAYING observations, explains that active playback behavior
 * cannot be evaluated. If PAUSED observations exist, notes why they are
 * considered separately.
 *
 * Important measurement limitation:
 * The input records local drift relative to each browser's expected playback
 * timeline. These statistics alone do not establish the actual playback-time
 * difference between two participants.
 *
 * @param samples - All validated observations for the experiment.
 * @returns Nothing. Prints the interpretation and measurement limitations.
 */
function printInterpretation(samples: PlaybackDriftSample[]): void {
    const title = "Interpretation";
    console.log(`\n${title}`);
    console.log("-".repeat(title.length));

    const playingSamples = samples.filter(
        (sample) => sample.playbackState === "PLAYING",
    );

    const pausedSamples = samples.filter(
        (sample) => sample.playbackState === "PAUSED",
    );

    console.log(
        `The dataset contains ${samples.length} observations: ` +
            `${playingSamples.length} PLAYING and ${pausedSamples.length} PAUSED.`,
    );

    if (playingSamples.length > 0) {
        const playingStatistics = calculateStatistics(playingSamples);

        if (playingStatistics !== null) {
            console.log(
                `During PLAYING observations, the median drift was ` +
                    `${formatMs(playingStatistics.p50Ms)} and the P95 drift was ` +
                    `${formatMs(playingStatistics.p95Ms)}.`,
            );

            for (const toleranceMs of [100, 200, 500]) {
                const withinCount = playingSamples.filter((sample) => {
                    return sample.driftMs <= toleranceMs;
                }).length;

                const percentage = (withinCount / playingSamples.length) * 100;

                console.log(
                    `At a ${toleranceMs} ms tolerance, ` +
                        `${withinCount}/${playingSamples.length} PLAYING observations ` +
                        `(${percentage.toFixed(2)}%) were within tolerance.`,
                );
            }
        }
    } else {
        console.log(
            "There are no PLAYING observations, so active playback behavior cannot be evaluated.",
        );
    }

    if (pausedSamples.length > 0) {
        console.log(
            "PAUSED observations are reported separately because they can have a different drift distribution from active playback.",
        );
    }

    console.log(
        "\nThese results describe local drift relative to each browser's expected playback timeline. " +
            "They do not, by themselves, establish the playback difference between room members.",
    );

    console.log(
        "Interpret the results in light of the sample count, recording duration, " +
            "clock-offset handling, and the tested network conditions.",
    );
}

/**
 * Entry point for the SynchroStream local playback-drift analysis script.
 *
 * Reads the input JSON file path from `process.argv[2]`, reads and parses
 * the file, and validates the root array and each sample.
 *
 * Then calculates the experiment overview:
 * - Total observations and distinct participant IDs.
 * - PLAYING and PAUSED observation counts.
 * - Recording duration and timestamp range.
 *
 * Finally, generates the report by calling:
 * - `printTimeline()` for drift over time.
 * - `printStatistics()` for combined, PLAYING, and PAUSED samples.
 * - `printToleranceAnalysis()` for the same three groups.
 * - `printInterpretation()` for the high-level findings.
 *
 * Missing file paths, file-reading errors, invalid JSON, a non-array root,
 * an empty dataset, and invalid samples cause the script to terminate through
 * `fail()`.
 *
 * @returns Nothing. Writes the complete analysis report to the console.
 */
function main(): void {
    const inputPath = process.argv[2];

    if (!inputPath) {
        fail(
            "Please provide a JSON file path.\n" +
                "Example: npm run analyze:sync -- test-results/synchrostream-sync-metrics_owner_samples.json",
        );
    }

    let parsed: unknown;

    try {
        const fileContent = readFileSync(inputPath, "utf8");
        parsed = JSON.parse(fileContent);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        fail(`Could not read or parse "${inputPath}": ${message}`);
    }

    if (!Array.isArray(parsed)) {
        fail("The JSON root must be an array of playback drift samples.");
    }

    if (parsed.length === 0) {
        fail("The JSON file contains no playback drift samples.");
    }

    const samples = parsed.map((sample, index) => {
        return validateSample(sample, index);
    });

    const orderedSamples = [...samples].sort(
        (a, b) => a.timestamp - b.timestamp,
    );

    const firstTimestamp = orderedSamples[0].timestamp;
    const lastTimestamp = orderedSamples[orderedSamples.length - 1].timestamp;

    const durationSeconds = (lastTimestamp - firstTimestamp) / 1000;

    const participantIds = new Set(
        samples.map((sample) => sample.participantId),
    );

    const playingSamples = samples.filter(
        (sample) => sample.playbackState === "PLAYING",
    );

    const pausedSamples = samples.filter(
        (sample) => sample.playbackState === "PAUSED",
    );

    console.log("\nSynchroStream Local Playback Drift Report");
    console.log("=========================================");

    console.log("\n1. Experiment Overview");
    console.log("----------------------");
    console.log(`Input file:                ${inputPath}`);
    console.log(`Total observations:        ${samples.length}`);
    console.log(`Distinct participant IDs:  ${participantIds.size}`);
    console.log(`PLAYING observations:      ${playingSamples.length}`);
    console.log(`PAUSED observations:       ${pausedSamples.length}`);
    console.log(
        `Recording duration:        ${formatDuration(durationSeconds)}`,
    );

    console.log(
        `Observation timestamps:    ${new Date(firstTimestamp).toISOString()} to ` +
            `${new Date(lastTimestamp).toISOString()}`,
    );

    console.log(
        "\nMeasurement: absolute difference between actual and expected local playback positions.",
    );

    console.log(
        "Each observation is one browser measurement, not a comparison between room members.",
    );

    printTimeline(samples);

    printStatistics(
        "Combined Drift Statistics",
        "All recorded observations, including both PLAYING and PAUSED states.",
        samples,
    );

    printStatistics(
        "PLAYING Drift Statistics",
        "Only observations recorded while the expected playback state was PLAYING.",
        playingSamples,
    );

    printStatistics(
        "PAUSED Drift Statistics",
        "Only observations recorded while the expected playback state was PAUSED.",
        pausedSamples,
    );

    printToleranceAnalysis("Combined Tolerance Analysis", samples);

    printToleranceAnalysis("PLAYING Tolerance Analysis", playingSamples);

    printToleranceAnalysis("PAUSED Tolerance Analysis", pausedSamples);

    printInterpretation(samples);

    console.log("\nEnd of report.");
}

main();
