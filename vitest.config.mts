import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the frontend's pure logic (chat timeline, clock sync,
// playback coordination, run analysis). Node environment: none of these
// touch the DOM. Add `environment: "jsdom"` per file when components get tests.
export default defineConfig({
    resolve: {
        alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
        restoreMocks: true,
    },
});
