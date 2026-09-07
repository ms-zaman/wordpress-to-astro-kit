// @ts-check
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";

import {
  parseRedirectMap,
  toAstroRedirects,
  toNetlifyRedirects,
  toRedirectsJson,
} from "./src/deployment/redirects.ts";
import { siteOrigin } from "./src/rendering/site-identity.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

// URL continuity (`content/redirects.json`, modelled in
// `src/deployment/redirects.ts`). Every rule becomes an Astro redirect — a
// meta-refresh page a static host serves without any configuration — AND a
// row in `dist/_redirects` / `dist/redirects.json` for a host that answers
// with a real 301. The build audit checks every internal target exists.
const redirectMap = parseRedirectMap(
  JSON.parse(
    readFileSync(path.join(here, "../../content/redirects.json"), "utf8"),
  ),
);

/** @returns {import("astro").AstroIntegration} */
const redirectArtifacts = () => ({
  name: "wpk-redirect-artifacts",
  hooks: {
    "astro:build:done": ({ dir }) => {
      const out = fileURLToPath(dir);
      mkdirSync(out, { recursive: true });
      writeFileSync(
        path.join(out, "_redirects"),
        toNetlifyRedirects(redirectMap),
      );
      writeFileSync(
        path.join(out, "redirects.json"),
        toRedirectsJson(redirectMap),
      );
    },
  },
});

// Static-first: every route is prerendered. No adapter is configured — the
// hosting provider is a decision the kit does not make — and every
// launch-time difference between the preview and production builds is decided
// by `src/deployment/site-environment.ts`, not by anything here.
export default defineConfig({
  output: "static",
  site: siteOrigin(),
  redirects: toAstroRedirects(redirectMap),
  // No Markdown plugins: migrated bodies are WordPress HTML and render through
  // `set:html` after `rendering/body.ts` prepares them, which is where the
  // media origin seam applies. An entry that opts into `bodyFormat: markdown`
  // goes through Astro's default pipeline.
  integrations: [redirectArtifacts()],
});
