
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import markdown from "@eslint/markdown";
import css from "@eslint/css";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { ignores: ["src/**/*.spec.*", "src/**/*.stoch.*", "src/**/*.mutat.*", "build/**", "coverage/**", "coverage-stoch/**", "dist/**", "docs/**", ".stryker-tmp/**", "typedoc-options.cjs", "**/CHANGELOG.md", "**/CHANGELOG.long.md", "src/doc_md/tasklist.md", "_incoming/**", ".superpowers/**", "src/scripts/desk/cardkit/**", "src/ts/tests/fixtures/cardkit-mini/**"] }, // vendored card kit (and its test fixture copy): checked by its own check.mjs, not by eslint
  { files: ["**/*.{js,mjs,cjs,ts,mts,cts}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.browser } },
  { files: ["src/build_js/**/*.js", "src/scripts/**/*.mjs"], languageOptions: { globals: globals.node } },
  ...tseslint.configs.strictTypeChecked.map(cfg => ({ ...cfg, files: ["**/*.{ts,mts,cts}"] })),
  ...tseslint.configs.stylisticTypeChecked.map(cfg => ({ ...cfg, files: ["**/*.{ts,mts,cts}"] })),
  {
    files: ["**/*.{ts,mts,cts}"],
    languageOptions: {
      parserOptions: {
        projectService: {
          // The desk's hand-written declarations sit beside a .mjs that no tsconfig owns
          // (tsconfig's rootDir is src/ts, and the desk deliberately runs unbuilt), so they
          // need the default project to be type-aware-lintable at all.
          allowDefaultProject: ["*.config.ts", "src/scripts/desk/deskcards.d.mts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  { files: ["**/*.md"], plugins: { markdown }, language: "markdown/gfm", extends: ["markdown/recommended"] },
  { files: ["**/*.css"], plugins: { css }, language: "css/css", extends: ["css/recommended"] },
]);
