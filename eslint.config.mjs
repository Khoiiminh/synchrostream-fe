import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    // Last, so it can switch off stylistic rules that conflict with Prettier.
    eslintPluginPrettierRecommended,
    {
        rules: {
            // Formatting options live in .prettierrc (4-space indent); the rule reads them from there.
            "prettier/prettier": ["error", {}, { usePrettierrc: true }],
        },
    },
    // Import boundaries (plan "Backend clean architecture and frontend vertical
    // slices", F0). Warn while the slices are being built (F1–F4); F5 turns
    // them into errors.
    {
        files: ["src/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": [
                "warn",
                {
                    patterns: [
                        {
                            group: ["@/features/*/*", "@/features/*/**"],
                            message:
                                "Import a feature through its public index (@/features/<name>); inside the feature, use relative imports.",
                        },
                    ],
                },
            ],
        },
    },
    {
        // Logic never depends on UI: engines, state, types and helpers stay
        // importable from any component, route or test.
        files: [
            "src/core/**/*.{ts,tsx}",
            "src/store/**/*.{ts,tsx}",
            "src/types/**/*.{ts,tsx}",
            "src/lib/**/*.{ts,tsx}",
            "src/shared/**/*.{ts,tsx}",
        ],
        rules: {
            "no-restricted-imports": [
                "warn",
                {
                    patterns: [
                        {
                            group: [
                                "@/components/*",
                                "@/components/**",
                                "@/app/*",
                                "@/app/**",
                            ],
                            message:
                                "Logic must not import UI (components or routes).",
                        },
                        {
                            group: ["@/features/*/*", "@/features/*/**"],
                            message:
                                "Import a feature through its public index (@/features/<name>).",
                        },
                    ],
                },
            ],
        },
    },
    {
        // The sync engine is shared by solo and party playback; admin-only
        // diagnostics depend on it, never the other way round.
        files: ["src/core/**/*.{ts,tsx}", "src/shared/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": [
                "warn",
                {
                    patterns: [
                        {
                            group: [
                                "@/components/*",
                                "@/components/**",
                                "@/app/*",
                                "@/app/**",
                            ],
                            message:
                                "Logic must not import UI (components or routes).",
                        },
                        {
                            group: [
                                "@/diagnostics/*",
                                "@/diagnostics/**",
                                "@/features/*",
                                "@/features/**",
                            ],
                            message:
                                "Shared engines must not import diagnostics or features; they depend on these, not the reverse.",
                        },
                    ],
                },
            ],
        },
    },
    // Override default ignores of eslint-config-next.
    globalIgnores([
        // Default ignores of eslint-config-next:
        ".next/**",
        "out/**",
        "build/**",
        "next-env.d.ts",
    ]),
]);

export default eslintConfig;
