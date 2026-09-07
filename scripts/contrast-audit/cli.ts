#!/usr/bin/env node
// `pnpm contrast:audit`
//
//   node scripts/contrast-audit/cli.ts          every route, both widths
//   node scripts/contrast-audit/cli.ts --all    also list what is baselined
//
// Reads `apps/website/dist`, so `pnpm contrast:audit` builds first. Needs a
// browser, which is why it belongs to the browser stage and not to `validate`.
//
// Exits non-zero on any unexplained finding, and on any baseline entry nothing
// measures any more.
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { KNOWN_BASELINE } from "./baseline.ts";
import { CONTRAST_VIEWPORTS, probeContrast } from "./probe.ts";
import { classify, describe } from "./report.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const distDirectory = path.join(repositoryRoot, "apps/website/dist");
const verbose = process.argv.slice(2).includes("--all");

console.log(
  `\ncontrast-audit — ${CONTRAST_VIEWPORTS.join(", ")}px, ` +
    "text against the ground actually painted behind it\n",
);

const findings = await probeContrast(distDirectory);
const { failures, baselined, stale } = classify(
  findings,
  KNOWN_BASELINE.map((entry) => entry.id),
);

for (const finding of failures) console.log(describe(finding) + "\n");

if (verbose && baselined.length > 0) {
  console.log("  Baselined, and still measured:\n");
  for (const finding of baselined) console.log(describe(finding) + "\n");
}

for (const id of stale)
  console.log(
    `  STALE BASELINE  ${id}\n` +
      "      nothing measures this any more — the entry describes a page that\n" +
      "      no longer exists, and a repository asserting something untrue\n" +
      "      about itself is a defect, not a status.\n",
  );

console.log(
  `${failures.length} unexplained, ${baselined.length} baselined, ` +
    `${stale.length} stale`,
);

if (failures.length === 0 && stale.length === 0) {
  console.log("\nEvery piece of text meets AA against the ground behind it.");
  process.exit(0);
}
console.log(
  "\nA finding here is text a reader cannot read. Fix the colour, or record a\n" +
    "decision in `scripts/contrast-audit/baseline.ts` — never silence it here.",
);
process.exit(1);
