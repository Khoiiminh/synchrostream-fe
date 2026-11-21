import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * What every page loads: the root layout and the Redux store (via
 * StoreProvider). Their import closure must stay free of the heavy,
 * route-specific libraries; those load only on the routes that need them,
 * through the features' ./routes entries. (F3 found livekit-client on the
 * landing page because a feature index re-exported its room page.)
 */

const SRC = __dirname;
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
const HEAVY = ["livekit-client", "recharts", "hls.js", "@mantine/charts"];

function resolveFile(base: string): string | null {
    for (const c of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
    ]) {
        if (existsSync(c) && /\.tsx?$/.test(c)) return c;
    }
    return null;
}

function closure(entries: string[]) {
    const files = new Set<string>();
    const packages = new Map<string, string>();
    const visit = (file: string) => {
        if (files.has(file)) return;
        files.add(file);
        for (const [, spec] of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
            let base: string | null = null;
            if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
            else if (spec.startsWith(".")) base = resolve(dirname(file), spec);
            else if (!packages.has(spec))
                packages.set(spec, relative(SRC, file).split("\\").join("/"));
            const target = base && resolveFile(base);
            if (target) visit(target);
        }
    };
    entries.forEach(visit);
    return { files, packages };
}

describe("app-wide entries", () => {
    const { files, packages } = closure([
        join(SRC, "app/layout.tsx"),
        join(SRC, "store/index.ts"),
    ]);

    it("reach the store, session and gateway", () => {
        expect(files.size).toBeGreaterThan(10);
        expect(packages.has("@reduxjs/toolkit")).toBe(true);
    });

    it.each(HEAVY)("never load %s", (pkg) => {
        const importer = [...packages].find(
            ([spec]) => spec === pkg || spec.startsWith(`${pkg}/`),
        );
        expect(importer?.[1] ?? null).toBeNull();
    });

    it("never load a feature's route entry", () => {
        const routeEntries = [...files]
            .map((f) => relative(SRC, f).split("\\").join("/"))
            .filter((f) => /^features\/[^/]+\/routes\.ts$/.test(f));
        expect(routeEntries).toEqual([]);
    });
});
