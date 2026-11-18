import { readFile } from "node:fs/promises";

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
    sampleCount: number;
    meanDriftMs: number;
    p50DriftMs: number;
    p95DriftMs: number;
    p99DriftMs: number;
    maxDriftMs: number;
    standardDeviationMs: number;
}

interface ToleranceAnalysis {
    toleranceMs: number;
    withinToleranceCount: number;
    exceedingToleranceCount: number;
    synchronizationAccuracyPercent: number;
    accuracyImprovementPercent: number;
}

/**
 * [50, 100, 150, 200, 250, 300, 400, 500]
 */
const CANDIDATE_TOLERANCE_MS = [
    50, 100, 150, 200,
    250, 300, 400, 500,
];

async function main(): Promise<void> {
    const inputPath = process.argv[2];

    if (!inputPath) {
        console.error(
            "Usage: npm run analyze:sync -- <path-to-json>",
        );

        process.exit(1);
    }

    const samples = await loadSamples(inputPath);

    if (samples.length === 0) {
        console.error("The input file contains no playback drift samples.");
        process.exit(1);
    }

    const driftValues = extractDriftValues(samples);

    const statistics = calculateStatistics(driftValues);
    const toleranceAnalysis = calculateToleranceAnalysis(driftValues);

    printReport(
        inputPath,
        statistics,
        toleranceAnalysis,
    );
}

/**
 * 
 * @param inputPath 
 * @returns 
 */
async function loadSamples(inputPath: string): Promise<PlaybackDriftSample[]> {
    const fileContent = await readFile(inputPath, "utf-8");

    let parsed: unknown;

    try {
        parsed = JSON.parse(fileContent);
    } catch {
        throw new Error(
            `Unable to parse JSON file: ${inputPath}`
        );
    }

    if (!Array.isArray(parsed)) {
        throw new Error("Expected the JSON root to be an array of playback drift samples.");
    }

    const samples: PlaybackDriftSample[] = [];

    for (let index = 0; index < parsed.length; index++) {
        const item = parsed[index];

        if (!isPlaybackDriftSample(item)) {
            throw new Error(
                `Invalid playback drift sample at index ${index}.`,
            );
        }

        samples.push(item);
    }

    return samples;
}

/**
 * 
 * @param value 
 * @returns 
 */
function isPlaybackDriftSample(value: unknown): value is PlaybackDriftSample {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }

    const sample = value as Record<string, unknown>;

    if (typeof sample.participantId !== "string" || sample.participantId.trim() === "") {
        return false;
    }

    if (typeof sample.timestamp !== "number" || !Number.isFinite(sample.timestamp)) {
        return false;
    }

    if (typeof sample.actualPositionSeconds !== "number" ||
        !Number.isFinite(sample.actualPositionSeconds) ||
        sample.actualPositionSeconds < 0) 
    {
        return false;
    }

    if (typeof sample.expectedPositionSeconds !== "number" ||
        !Number.isFinite(sample.expectedPositionSeconds) ||
        sample.expectedPositionSeconds < 0) 
    {
        return false;
    }

    if (typeof sample.driftMs !== "number" ||
        !Number.isFinite(sample.driftMs) ||
        sample.driftMs < 0) 
    {
        return false;
    }

    if (sample.playbackState !== "PLAYING" &&
        sample.playbackState !== "PAUSED") 
    {
        return false;
    }

    return true;
}

/**
 * samples: [                                       -----               
 *      {                                               |                   
            timestamp: number;                          |                   
            participantId: string;                      |                   
            actualPositionSeconds: number;              |                   
            expectedPositionSeconds: number;            |                  
            driftMs: number;                            |                   
            playbackState: "PLAYING" | "PAUSED";        |               samples: [
        },                                              |                   "drift ms 1",
        {                                               |                   "drift ms 2",
            timestamp: number;                          | ======>>          "drift ms 3",
            participantId: string;                      |                   .
            actualPositionSeconds: number;              |                   .
            expectedPositionSeconds: number;            |                   .
            driftMs: number;                            |               ]
            playbackState: "PLAYING" | "PAUSED";        |
        },                                              |
        .                                               |
        .                                               |
        .                                               |
 * ]                                                -----
 * 
 * @param samples 
 * @returns 
 */
function extractDriftValues(samples: PlaybackDriftSample[]): number[] {
    return samples.map((sample) => sample.driftMs)
                .sort((a, b) => a - b);
}

/**
 * Ex:
 *
 * sortedDriftValues: [10, 20, 30, 40, 50]
 *
 * Step 1: Count the samples
 *
 *     sampleCount = sortedDriftValues.length
 *                 = 5
 *
 *          |
 *          v
 *
 * Step 2: Calculate the total drift
 *
 *     totalDriftMs = 10 + 20 + 30 + 40 + 50
 *                  = 150
 *
 *     General equation:
 *
 *         totalDriftMs = Σ driftMs[i]
 *
 *     where i ranges from 0 to sampleCount - 1.
 *
 *          |
 *          v
 *
 * Step 3: Calculate the mean drift
 *
 *     meanDriftMs = totalDriftMs / sampleCount
 *                 = 150 / 5
 *                 = 30 ms
 *
 *     General equation:
 *
 *         mean = (Σ driftMs[i]) / n
 *
 *          |
 *          v
 *
 * Step 4: Calculate the percentiles
 *
 *     For n = 5 and percentile p:
 *
 *         index = (p / 100) * (n - 1)
 *
 *     P50:
 *
 *         index = (50 / 100) * 4 = 2
 *         P50   = sortedDriftValues[2] = 30 ms
 *
 *     P95:
 *
 *         index = (95 / 100) * 4 = 3.8
 *
 *         lowerIndex = floor(3.8) = 3
 *         upperIndex = ceil(3.8)  = 4
 *
 *         fraction = 3.8 - 3 = 0.8
 *
 *         P95 = lowerValue + (upperValue - lowerValue) * fraction
 *             = 40 + (50 - 40) * 0.8
 *             = 48 ms
 *
 *     P99:
 *
 *         index = (99 / 100) * 4 = 3.96
 *
 *         lowerIndex = floor(3.96) = 3
 *         upperIndex = ceil(3.96)  = 4
 *
 *         fraction = 3.96 - 3 = 0.96
 *
 *         P99 = 40 + (50 - 40) * 0.96
 *             = 49.6 ms
 *
 *     P50 describes the median drift.
 *     P95 and P99 describe drift near the upper end
 *     of the observed distribution.
 *
 *          |
 *          v
 *
 * Step 5: Find the maximum drift
 *
 *     maxDriftMs = sortedDriftValues[n - 1]
 *                = sortedDriftValues[4]
 *                = 50 ms
 *
 *     The array is sorted in ascending order, so its
 *     final element is the maximum observed drift.
 *
 *          |
 *          v
 *
 * Step 6: Calculate the population standard deviation
 *
 *     Step 6.1: Calculate each difference from the mean
 *
 *         differences = [-20, -10, 0, 10, 20]
 *
 *     Step 6.2: Square each difference
 *
 *         squaredDifferences = [400, 100, 0, 100, 400]
 *
 *     Step 6.3: Calculate the population variance
 *
 *         variance = Σ (driftMs[i] - mean)^2 / n
 *                  = (400 + 100 + 0 + 100 + 400) / 5
 *                  = 200
 *
 *     Step 6.4: Take the square root
 *
 *         standardDeviationMs = sqrt(variance)
 *                             = sqrt(200)
 *                             ≈ 14.142 ms
 *
 *          |
 *          v
 *
 * Step 7: Return the statistics
 *
 *     {
 *         sampleCount: 5,
 *         meanDriftMs: 30,
 *         p50DriftMs: 30,
 *         p95DriftMs: 48,
 *         p99DriftMs: 49.6,
 *         maxDriftMs: 50,
 *         standardDeviationMs: 14.142...
 *     }
 *
 *          |
 *          v
 *
 *     The resulting statistics summarize the distribution
 *     of playback drift for synchronization analysis.
 *
 * @param sortedDriftValues
 * @returns
 */
function calculateStatistics(sortedDriftValues: number[]): DriftStatistics {
    const sampleCount = sortedDriftValues.length;

    const totalDriftMs = sortedDriftValues.reduce(
        (sum, driftMs) => sum + driftMs,
        0,
    );

    const meanDriftMs = totalDriftMs / sampleCount;

    /**
     * 50th percentile — the median
     * ---------------------------------------------------------------------------------------
     * Half of the samples have drift at or below this value, and 
     * half have drift at or above it (allowing for ties).
     *
     * Example: P50 = 18.833 ms means the median sample has approximately 18.833 ms of drift.
     * ---------------------------------------------------------------------------------------
     * 
     *      ===> What does typical drift look like?
     */
    const p50DriftMs = calculatePercentile(
        sortedDriftValues,
        50,
    );

    /**
     * 95th percentile
     * ---------------------------------------------------------------------------------------
     * Approximately 95% of samples have drift at or below this value; approximately 5% are above it. 
     * 
     * Example: P95 = 44.501 ms means about 95% of measured samples are at or below 44.501 ms.
     * ---------------------------------------------------------------------------------------
     * 
     *      ===> How much drift do users experience in the higher end of ordinary observations?
     */
    const p95DriftMs = calculatePercentile(
        sortedDriftValues,
        95,
    );

    /**
     * 99th percentile
     * ---------------------------------------------------------------------------------------
     * Approximately 99% of samples have drift at or below this value; approximately 1% are above it.
     * 
     * Example: P99 = 122.747 ms means approximately 99% of samples are at or below 122.747 ms.
     * ---------------------------------------------------------------------------------------
     * 
     *      ===> How large is drift near the extreme end of observations?
     */
    const p99DriftMs = calculatePercentile(
        sortedDriftValues,
        99,
    );

    /**
     *   What was the single largest observed drift?
     */
    const maxDriftMs = sortedDriftValues[sortedDriftValues.length - 1];

    const standardDeviationMs = calculateStandardDeviation(
        sortedDriftValues,
        meanDriftMs,
    );

    return {
        sampleCount,
        meanDriftMs,
        p50DriftMs,
        p95DriftMs,
        p99DriftMs,
        maxDriftMs,
        standardDeviationMs
    };
}

/**
 * values: [10, 20, 30]
mean:   20

Step 1: Subtract the mean from each value

    10 - 20 = -10
    20 - 20 =   0
    30 - 20 = +10

         |
         v

Step 2: Square each difference

    (-10)² = 100
      (0)² =   0
    (+10)² = 100

    squaredDifferences: [100, 0, 100]

         |
         v

Step 3: Calculate population variance

    (100 + 0 + 100) / 3
    = 66.667

         |
         v

Step 4: Take the square root

    sqrt(66.667) ≈ 8.165 ms

         |
         v

Return: standard deviation ≈ 8.165 ms

 * @param values 
 * @param mean 
 * @returns 
 */
function calculateStandardDeviation(values: number[], mean: number): number {
    if (values.length === 0) return 0;

    const squaredDifferences = values.map(
        (value) => {
            const difference = value - mean;

            return difference * difference;
        },
    );

    const variance = squaredDifferences.reduce(
        (sum, value) => sum + value,
        0,
    ) / values.length;

    return Math.sqrt(variance);
}

/**
 * Ex:
 * 
 * 
sortedDriftValues: [20, 80, 120, 180, 250, 350]
sampleCount = 6

Candidates:
[50, 100, 150, 200, 250, 300, 400, 500]

For tolerance = 100 ms:

    Within:   [20, 80]
    Exceed:   [120, 180, 250, 350]

    Accuracy = (2 / 6) * 100
             = 33.33%

For tolerance = 200 ms:

    Within:   [20, 80, 120, 180]
    Exceed:   [250, 350]

    Accuracy = (4 / 6) * 100
             = 66.67%

For tolerance = 300 ms:

    Within:   [20, 80, 120, 180, 250]
    Exceed:   [350]

    Accuracy = (5 / 6) * 100
             = 83.33%

         |
         v

results: [
    { toleranceMs: 50,  ... },
    { toleranceMs: 100, ... },
    { toleranceMs: 150, ... },
    ...
    { toleranceMs: 500, ... }
]

 * @param sortedDriftValues 
 * @returns 
 */
function calculateToleranceAnalysis(sortedDriftValues: number[]): ToleranceAnalysis[] {
    const sampleCount = sortedDriftValues.length;

    const results: ToleranceAnalysis[] = [];

    let previousAccuracyPercent = 0;

    for (const toleranceMs of CANDIDATE_TOLERANCE_MS) {
        const withinToleranceCount = countWithinTolerance(sortedDriftValues, toleranceMs);

        const exceedingToleranceCount = sampleCount - withinToleranceCount;

        const synchronizationAccuracyPercent =  (withinToleranceCount / sampleCount) * 100;

        const accuracyImprovementPercent = synchronizationAccuracyPercent - previousAccuracyPercent;

        results.push({
            toleranceMs,
            withinToleranceCount,
            exceedingToleranceCount,
            synchronizationAccuracyPercent,
            accuracyImprovementPercent,
        });

        previousAccuracyPercent = synchronizationAccuracyPercent;
    }

    return results;
}

/**
 * Ex:
 * 
 * 
sortedDriftValues = [20, 80, 120, 180, 250, 350]
toleranceMs = 150

Initial boundaries:

    lower = 0
    upper = 6

    Index:  0   1   2   3    4    5
    Value: 20  80  120 180  250  350
                         ^
                         First value exceeding 150 is
                         somewhere to the right.

----------------------------------------
Iteration 1
----------------------------------------

    middle = floor((0 + 6) / 2) = 3

    values[3] = 180

    180 > 150
        |
        v
    upper = middle = 3

    Search range: [0, 3)

----------------------------------------
Iteration 2
----------------------------------------

    middle = floor((0 + 3) / 2) = 1

    values[1] = 80

    80 <= 150
        |
        v
    lower = middle + 1 = 2

    Search range: [2, 3)

----------------------------------------
Iteration 3
----------------------------------------

    middle = floor((2 + 3) / 2) = 2

    values[2] = 120

    120 <= 150
        |
        v
    lower = middle + 1 = 3

    Search range: [3, 3)

----------------------------------------
Termination
----------------------------------------

    lower === upper === 3

    return lower

    Result: 3 samples within tolerance

 * @param sortedDriftValues 
 * @param toleranceMs 
 * @returns 
 */
function countWithinTolerance(
    sortedDriftValues: number[],
    toleranceMs: number,
): number {
    let lower = 0;
    let upper = sortedDriftValues.length;

    while (lower < upper) {
        const middle = Math.floor((lower + upper) / 2);

        if (sortedDriftValues[middle] <= toleranceMs) {
            lower = middle + 1;
        } else {
            upper = middle;
        }
    }

    return lower;
}

/**
 * Ex:
 * 
 * 
sortedValues = [10, 20, 30, 40, 50]
percentile = 75

Step 1: Calculate the fractional index

    index = (75 / 100) * (5 - 1)
          = 3

Step 2: Find the bounding indices

    lowerIndex = floor(3) = 3
    upperIndex = ceil(3)  = 3

Step 3: Because both indices are equal

    return sortedValues[3]

    Result: 40

========================================

Example with interpolation:

sortedValues = [10, 20, 30, 40, 50]
percentile = 62.5

Step 1:

    index = (62.5 / 100) * (5 - 1)
          = 2.5

Step 2:

    lowerIndex = 2
    upperIndex = 3

    lowerValue = 30
    upperValue = 40

Step 3: Calculate the fractional distance

    fraction = 2.5 - 2
             = 0.5

Step 4: Interpolate

    result = 30 + (40 - 30) * 0.5
           = 35

 * @param sortedValues 
 * @param percentile 
 * @returns 
 */
function calculatePercentile(
    sortedValues: number[],
    percentile: number,
): number {
    if (sortedValues.length === 0) {
        return 0;
    }

    if (sortedValues.length === 1) {
        return sortedValues[0];
    }

    const index = (percentile / 100) * (sortedValues.length - 1);

    const lowerIndex = Math.floor(index);
    const upperIndex = Math.ceil(index);

    if (lowerIndex === upperIndex) {
        return sortedValues[lowerIndex];
    }

    const lowerValue = sortedValues[lowerIndex];

    const upperValue = sortedValues[upperIndex];

    const fraction = index - lowerIndex;

    return (
        lowerValue + (upperValue - lowerValue) * fraction
    );
}

/**
 * 
 * @param inputPath 
 * @param statistics 
 * @param toleranceAnalysis 
 */
function printReport(
    inputPath: string,
    statistics: DriftStatistics,
    toleranceAnalysis: ToleranceAnalysis[],
): void {
    console.log("");
    console.log(
        "SynchroStream Synchronization Analysis",
    );
    console.log(
        "=======================================",
    );

    console.log("");
    console.log(`Input: ${inputPath}`);

    console.log("");
    console.log("Drift Statistics");
    console.log("----------------");

    console.log(
        `Samples:              ${statistics.sampleCount}`,
    );

    console.log(
        `Mean drift:           ${formatMs(statistics.meanDriftMs)}`,
    );

    console.log(
        `P50 drift:            ${formatMs(statistics.p50DriftMs)}`,
    );

    console.log(
        `P95 drift:            ${formatMs(statistics.p95DriftMs)}`,
    );

    console.log(
        `P99 drift:            ${formatMs(statistics.p99DriftMs)}`,
    );

    console.log(
        `Maximum drift:        ${formatMs(statistics.maxDriftMs)}`,
    );

    console.log(
        `Standard deviation:   ${formatMs(statistics.standardDeviationMs)}`,
    );

    console.log("");
    console.log("Tolerance Analysis");
    console.log("------------------");

    console.log(
        "Tolerance | Within | Exceeding | Accuracy | Gain",
    );

    console.log(
        "----------|--------|-----------|----------|------",
    );

    for (const result of toleranceAnalysis) {
        console.log(
            `${padNumber(result.toleranceMs, 9)} | ` +
            `${padNumber(result.withinToleranceCount, 6)} | ` +
            `${padNumber(result.exceedingToleranceCount, 9)} | ` +
            `${padPercent(result.synchronizationAccuracyPercent)} | ` +
            `${padPercent(result.accuracyImprovementPercent)}`,
        );
    }

    console.log("");
}

/**
 * 
 * @param value 
 * @returns 
 */
function formatMs(value: number): string {
    return `${value.toFixed(3)} ms`;
}

/**
 * 
 * @param value 
 * @param width 
 * @returns 
 */
function padNumber(
    value: number,
    width: number,
): string {
    return value.toString().padStart(width, " ");
}

/**
 * 
 * @param value 
 * @returns 
 */
function padPercent(value: number): string {
    return `${value.toFixed(2).padStart(7, " ")}%`;
}

main().catch((error: unknown) => {
    if (error instanceof Error) {
        console.error("");
        console.error(
            `Analysis failed: ${error.message}`,
        );
    } else {
        console.error("");
        console.error("Analysis failed.");
    }

    process.exit(1);
});