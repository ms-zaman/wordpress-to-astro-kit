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
  unpublishedTypeExclusions,
  unpublishedTaxonomyExclusions,
  type Exclusion,
  type IntendedContent,
} from "../../apps/website/src/deployment/content-integrity.ts";
import { readProvenance } from "../../apps/website/content-contract/read-entries.ts";
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
    postTypes?: {
      name: string;
      collection: string;
      published: boolean;
      archive: string;
      taxonomies: string[];
    }[];
    taxonomies?: {
      name: string;
      collection: string;
      published: boolean;
      appliesTo: string[];
      hierarchical: boolean;
      urlHierarchy: boolean;
    }[];
  };
  routes?: {
    inventory?: {
      path: string;
      file: string;
      origin: string;
      source?: string;
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

// Two systemic exclusions, both derived from a RULE rather than hand-listed —
// nobody maintains a list of 1,235 translated entries or every row of a
// withheld type — and both naming every entry they cover.
//
// Read from the manifest, not from migration.config.ts: a gate that reads the
// same configuration the build read cannot notice the build ignoring it.
const postTypeRecords = manifest.content?.postTypes ?? [];
const withheldTypes = postTypeRecords
  .filter((record) => !record.published)
  .map((record) => ({ name: record.collection, type: record.name }));

const taxonomyRecords = manifest.content?.taxonomies ?? [];
const withheldTaxonomies = taxonomyRecords
  .filter((record) => !record.published)
  .map((record) => ({ name: record.collection, taxonomy: record.name }));

const exclusions: Exclusion[] = [
  ...localeExclusions(intended, locale),
  ...unpublishedTypeExclusions(intended, withheldTypes),
  ...unpublishedTaxonomyExclusions(intended, withheldTaxonomies),
];

// The source-identity contest check needs the WordPress ids, and the manifest
// deliberately does not carry them — it is a served route, and a deployment has
// no need to publish the source site's primary keys. They are read from
// `content/`, where whoever migrated the content wrote them.
//
// The AUTHORITATIVE check is upstream: `pnpm content:validate` runs it over the
// filesystem, which is the only layer that sees two entries claiming one id.
// This is defence in depth, and it says so when it cannot run rather than
// reporting zero findings — a gate that finds nothing because it was given
// nothing to read is the failure this whole tool exists to prevent.
const contentRoot = path.join(repositoryRoot, "content");
let sourceClaims;
let sourceNote = "";
try {
  const provenance = readProvenance(contentRoot);
  sourceClaims = provenance.claims;
  sourceNote = `  source ids      ${provenance.claims.length} read from content/\n`;
} catch (cause) {
  sourceNote =
    `  source ids      NOT READ — ${(cause as Error).message}. The ` +
    `one-source-entity-one-local-entity check did not run here; ` +
    `\`pnpm content:validate\` is where it is authoritative.\n`;
}

const report = checkContentIntegrity({
  intended,
  emitted: inventory,
  exclusions,
  filesInDist,
  sourceClaims,
});

process.stdout.write(
  `\ncontent-integrity — content/ → resolver → dist/, joined by identity\n\n` +
    `  locale built    ${locale}\n` +
    `  intended        ${intended.length}\n` +
    `  emitted         ${report.emitted.length}` +
    `  (${Object.entries(report.counts)
      .filter(([key, value]) => key !== "total" && value > 0)
      .map(([key, value]) => `${key} ${value}`)
      .join(", ")})\n` +
    `  excluded        ${report.excluded.length}\n` +
    sourceNote +
    (postTypeRecords.length === 0
      ? ""
      : `  custom types    ${postTypeRecords
          .map(
            (record) =>
              `${record.collection}${record.published ? "" : " (withheld)"}` +
              `${record.archive === "archive" ? " +archive" : ""}`,
          )
          .join(", ")}\n`) +
    (taxonomyRecords.length === 0
      ? ""
      : `  taxonomies      ${taxonomyRecords
          .map(
            (record) =>
              `${record.collection}${record.published ? "" : " (stored only)"}` +
              `${record.urlHierarchy ? " +hierarchy" : ""}`,
          )
          .join(", ")}\n`),
);

if (report.excluded.length > 0) {
  process.stdout.write("\n  EXCLUDED\n");
  for (const record of report.excluded)
    process.stdout.write(
      `    ${record.id}\n      reason: ${record.reason} (at the ${record.stage}, by ${record.by})\n      ${record.detail}\n`,
    );
}

for (const kind of [
  "IDENTITY_CONTESTED",
  "PROVENANCE_CONTESTED",
  "PROVENANCE_MISSING",
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
