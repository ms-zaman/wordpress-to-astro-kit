import js from "@eslint/js";
import astro from "eslint-plugin-astro";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/.astro/",
      "research/",
      "docs/",
      "decisions/",
    ],
  },
  js.configs.recommended,
  ...astro.configs.recommended,
  {
    // TypeScript syntax inside .astro frontmatter (`interface Props`) needs a
    // TS-capable script parser. Parser only: type-aware lint rules stay out of
    // the baseline; `astro check` owns type diagnostics.
    files: ["**/*.astro"],
    languageOptions: {
      parserOptions: {
        parser: tsParser,
      },
    },
  },
  {
    // The island sources: plain JavaScript that a BROWSER runs, inlined into
    // the page by the component that ships it. They are the only files in
    // the repository that legitimately reach for `document`, `fetch` and
    // `history`; every other file runs in Node at build time, where naming
    // those would be a real defect. So the browser globals are declared on
    // this narrow glob rather than repository-wide.
    files: [
      "apps/website/src/search/search-island.js",
      "apps/website/src/search/search-core.js",
      "apps/website/src/forms/form-transport.js",
    ],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        location: "readonly",
        history: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        URLSearchParams: "readonly",
        Intl: "readonly",
        setTimeout: "readonly",
      },
    },
  },
];
