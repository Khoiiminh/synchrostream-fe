import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The watch-party index is loaded on every page (root layout and navbar).
 * Its import closure must not reach the room UI or LiveKit; those belong to
 * ./routes, which only the /party route loads. F3 found the index pulling
 * livekit-client into the landing page.
 */

const SRC = resolve(__dirname, "../..");
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

function resolveFile(base: string): string | null {
    for (const candidate of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
    ]) {
        if (existsSync(candidate) && candidate.match(/\.tsx?$/))
            return candidate;
    }
    return null;
}

/** Project files and packages reachable from `entry`. */
function closure(entry: string) {
    const files = new Set<string>();
    const packages = new Set<string>();
    const visit = (file: string) => {
        if (files.has(file)) return;
        files.add(file);
        for (const [, spec] of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
            let base: string | null = null;
            if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
            else if (spec.startsWith(".")) base = resolve(dirname(file), spec);
            else packages.add(spec);
            const target = base && resolveFile(base);
            if (target) visit(target);
        }
    };
    visit(entry);
    return {
        files: [...files].map((f) => relative(SRC, f).split("\\").join("/")),
        packages: [...packages],
    };
}

describe("watch-party public entries", () => {
    const index = closure(join(__dirname, "index.ts"));

    it("the light index never reaches the room UI or LiveKit", () => {
        expect(index.files.length).toBeGreaterThan(3);
        expect(
            index.files.filter((f) =>
                /features\/watch-party\/(ui\/PartyRoom|engine\/LiveKitMediaEngine|hooks\/)/.test(
                    f,
                ),
            ),
        ).toEqual([]);
        expect(
            index.packages.filter((p) => p.startsWith("livekit-client")),
        ).toEqual([]);
    });

    it("the routes entry is where the room and LiveKit live", () => {
        const routes = closure(join(__dirname, "routes.ts"));
        expect(routes.files).toContain("features/watch-party/ui/PartyRoom.tsx");
        expect(routes.packages).toContain("livekit-client");
    });
});
