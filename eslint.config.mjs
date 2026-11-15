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
