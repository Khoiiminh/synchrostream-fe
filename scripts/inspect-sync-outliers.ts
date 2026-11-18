import { readFileSync } from "node:fs";

const inputPaths = process.argv.slice(2);
const OUTLIER_THRESHOLD_MS = 500;

if (inputPaths.length === 0) {
    console.error(
        "Usage: npx tsx scripts/inspect-sync-outliers.ts <file1.json> [file2.json]",
    );

    process.exit(1);
}

for (const inputPath of inputPaths) {
    console.log(`\nFile: ${inputPath}`);
    console.log("=".repeat(80));

    let samples: unknown;

    try {
        samples = JSON.parse(readFileSync(inputPath, "utf8"));
    } catch (error) {
        console.error(`Could not read file: ${String(error)}`);
        continue;
    }

    if (!Array.isArray(samples)) {
        console.error("Expected a JSON array of samples.");
        continue;
    }

    const outliers = samples
        .filter((sample): sample is Record<string, unknown> => {
            return (
                typeof sample === "object" &&
                sample !== null &&
                typeof sample.driftMs === "number" &&
                sample.driftMs > OUTLIER_THRESHOLD_MS
            );
        })
        .sort((a, b) => {
            return Number(b.driftMs) - Number(a.driftMs);
        });

    console.log(`Total samples: ${samples.length}`);
    console.log(`Samples above ${OUTLIER_THRESHOLD_MS} ms: ${outliers.length}`);

    for (const sample of outliers) {
        const calculatedDriftMs =
            typeof sample.actualPositionSeconds === "number" &&
            typeof sample.expectedPositionSeconds === "number"
                ? Math.abs(
                      sample.actualPositionSeconds -
                          sample.expectedPositionSeconds,
                  ) * 1000
                : null;

        console.log("\n----------------------------------------");
        console.log(
            `Recorded time: ${
                typeof sample.timestamp === "number"
                    ? new Date(sample.timestamp).toISOString()
                    : "Unknown"
            }`,
        );
        console.log(`Participant: ${sample.participantId}`);
        console.log(`State: ${sample.playbackState}`);
        console.log(`Actual position: ${sample.actualPositionSeconds} seconds`);
        console.log(
            `Expected position: ${sample.expectedPositionSeconds} seconds`,
        );
        console.log(`Recorded drift: ${sample.driftMs} ms`);
        console.log(
            `Recalculated drift: ${
                calculatedDriftMs === null
                    ? "Unavailable"
                    : `${calculatedDriftMs.toFixed(3)} ms`
            }`,
        );
    }
}
