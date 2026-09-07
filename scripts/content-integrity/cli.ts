#!/usr/bin/env node
// `pnpm content:integrity` — did every entry in `content/` cross the build
// boundary, and can every emitted page name the content it came from?
//
//   node scripts/content-integrity/cli.ts [--dist apps/website/dist]
//
// Reads the deployment manifest for what the build INTENDED and what it
// CLAIMS, and `dist/` for what is actually there. The join is by identity —
// `posts/hello-world@en` — never by count, because a build that drops one
// entry and invents another produces identical counts.
//
// The rule that made this necessary is in `src/deployment/content-integrity.ts`:
// every other gate reads one side of the boundary, so anything the resolver
// dropped between `content/` and `dist/` was invisible to all of them.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  checkContentIntegrity,
  findingsOfKind,
  localeExclusions,
  type Exclusion,
  type IntendedContent,
} from "../../apps/website/src/deployment/content-integrity.ts";
import { parseArgs } from "../lib/args.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const args = parseArgs(process.argv.slice(2), { valued: ["--dist"] });
const distDirectory = path.resolve(
  repositoryRoot,
  args.value("--dist", "apps/website/dist"),
);

/** Every file under `dist/`, relative to it, so the manifest can be checked. */
function filesUnder(root: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const name of readdirSync(root)) {
    const full = path.join(root, name);
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(full).isDirectory()) found.push(...filesUnder(full, relative));
    else found.push(relative);
  }
  return found;
}

const manifestFile = path.join(distDirectory, "deployment.json");
let manifest: {
  content?: {
    locale?: string;
    intended?: IntendedContent[];
  };
  routes?: {
    inventory?: {
      path: string;
      file: string;
      origin: string;
      entry?: string;
    }[];
  };
};
try {
  manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as typeof manifest;
} catch {
  process.stderr.write(
    `\nNo deployment manifest at ${path.relative(repositoryRoot, manifestFile)}.\n` +
      "Run `pnpm build` first — this gate reads the artifact, not the source.\n",
  );
  process.exit(1);
}

const intended = manifest.content?.intended;
const locale = manifest.content?.locale;
const inventory = manifest.routes?.inventory;

if (intended === undefined || locale === undefined || inventory === undefined) {
  process.stderr.write(
    "\nThe manifest predates the content-integrity contract: it carries no\n" +
      "`content.intended`, `content.locale` or `routes.inventory`. Rebuild.\n\n" +
      "Refusing to report on a manifest that cannot answer the question is the\n" +
      "point — a gate that reports 0 findings because it found no data to read\n" +
      "is the failure this whole tool exists to prevent.\n",
  );
  process.exit(1);
}

const filesInDist = new Set(filesUnder(distDirectory));

// The one systemic exclusion the kit ships. Derived from the rule rather than
// hand-listed, but every entry it covers is still named in the report.
const exclusions: Exclusion[] = localeExclusions(intended, locale);

const report = checkContentIntegrity({
  intended,
  emitted: inventory,
  exclusions,
  filesInDist,
});

process.stdout.write(
  `\ncontent-integrity — content/ → resolver → dist/, joined by identity\n\n` +
    `  locale built    ${locale}\n` +
    `  intended        ${intended.length}\n` +
    `  emitted         ${report.emitted.length}` +
    `  (posts ${report.counts.posts}, pages ${report.counts.pages}, ` +
    `categories ${report.counts.categories}, tags ${report.counts.tags}, ` +
    `authors ${report.counts.authors})\n` +
    `  excluded        ${report.excluded.length}\n`,
);

if (report.excluded.length > 0) {
  process.stdout.write("\n  EXCLUDED\n");
  for (const record of report.excluded)
    process.stdout.write(
      `    ${record.id}\n      reason: ${record.reason}\n      ${record.detail}\n`,
    );
}

for (const kind of [
  "SOURCE_ONLY",
  "OUTPUT_ONLY",
  "UNUSED_EXCLUSION",
] as const) {
  const found = findingsOfKind(report.findings, kind);
  if (found.length === 0) continue;
  process.stdout.write(`\n  ${kind} (${found.length})\n`);
  for (const finding of found) {
    process.stdout.write(`    ${finding.subject}\n`);
    if (finding.expectedRoute !== undefined)
      process.stdout.write(`      expected route: ${finding.expectedRoute}\n`);
    if (finding.expectedOutput !== undefined)
      process.stdout.write(
        `      expected output: ${finding.expectedOutput}\n`,
      );
    process.stdout.write(`      ${finding.detail}\n`);
  }
}

process.stdout.write(`\n${report.findings.length} finding(s)\n`);

if (report.findings.length > 0) {
  process.stderr.write(
    "\nEvery entry in content/ either becomes a page or carries a typed, stated\n" +
      "reason why it does not. An accidental exclusion and a deliberate one look\n" +
      "identical in a build log; they must not look identical here.\n",
  );
  process.exit(1);
}

process.stdout.write(
  "\nEvery intended entry arrived, and every emitted page names its source.\n",
);
