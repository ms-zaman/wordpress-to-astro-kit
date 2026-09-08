#!/usr/bin/env node
// `pnpm provenance` — where did this page come from?
//
//   node scripts/provenance/cli.ts                     the whole lineage table
//   node scripts/provenance/cli.ts route /blog/example  one URL
//   node scripts/provenance/cli.ts output blog/example/index.html
//   node scripts/provenance/cli.ts source wp:post/product#42
//   node scripts/provenance/cli.ts withheld              what was not emitted
//   node scripts/provenance/cli.ts --json                the table, machine-readable
//
// ## Where each half comes from, and why they are in different places
//
// The lineage this prints is a join of two things:
//
//     content/                 local identity → SOURCE ENTITY
//     dist/deployment.json     local identity → route, output file
//
// The source ids are read from the content tree rather than from the build,
// because `dist/deployment.json` is a ROUTE — everything in `dist/` is served,
// and the WordPress ids describe the site somebody migrated FROM, which a
// deployment has no need to publish. The manifest therefore carries provenance
// WITHOUT the source entity, and the ids stay where whoever migrated the
// content wrote them.
//
// That also means there is no third artifact to produce, keep in step, or
// accidentally deploy. `--json` writes the join to stdout for CI or a
// migration report; nothing is written to disk.
//
// The caveat, because it is real: this joins today's `content/` against the
// last build's `dist/`. Every gate in this kit that reads `dist/` has that
// property — run `pnpm build` first.
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  sourceKey,
  type Provenance,
  type PublicProvenance,
} from "../../apps/website/src/content-model/provenance.ts";
import { readProvenance } from "../../apps/website/content-contract/read-entries.ts";
import { parseArgs } from "../lib/args.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const args = parseArgs(process.argv.slice(2), {
  valued: ["--dist"],
  defaultCommand: "table",
});
const distDirectory = path.resolve(
  repositoryRoot,
  args.value("--dist", "apps/website/dist"),
);

interface IntendedRow {
  id: string;
  expectedRoute?: string;
  provenance?: PublicProvenance;
}
interface InventoryRow {
  path: string;
  file: string;
  kind: string;
  origin: string;
  source: string;
  entry?: string;
}

const manifestFile = path.join(distDirectory, "deployment.json");
let manifest: {
  content?: { locale?: string; intended?: IntendedRow[] };
  routes?: { inventory?: InventoryRow[] };
};
try {
  manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as typeof manifest;
} catch {
  process.stderr.write(
    `\nNo deployment manifest at ${path.relative(repositoryRoot, manifestFile)}.\n` +
      "Run `pnpm build` first — provenance is read from the artifact, never\n" +
      "recomputed from the source, so that it describes the build somebody has\n" +
      "rather than the build they would get if they ran it again.\n",
  );
  process.exit(1);
}

const intended = manifest.content?.intended ?? [];
const inventory = manifest.routes?.inventory ?? [];

if (intended.length === 0) {
  process.stderr.write(
    "\nThe manifest carries no `content.intended`, so it cannot say what this\n" +
      "build was a build OF. Rebuild with a current kit.\n",
  );
  process.exit(1);
}

// The source half, from `content/`. A missing or unreadable tree is reported
// rather than quietly producing a table with an empty SOURCE column — a report
// that says "nothing came from WordPress" because it failed to look is the
// exact failure this kit keeps finding in its own gates.
const contentRoot = path.join(repositoryRoot, "content");
const { claims, problems: contentProblems } = readProvenance(contentRoot);
for (const problem of contentProblems)
  process.stderr.write(`  ! content/${problem}\n`);

const sourceByLocal = new Map<string, Provenance>();
for (const claim of claims)
  sourceByLocal.set(claim.provenance.local, claim.provenance);

/** Every route and output one local identity produced. */
const claimsByIdentity = new Map<string, InventoryRow[]>();
for (const row of inventory) {
  if (row.entry === undefined) continue;
  const existing = claimsByIdentity.get(row.entry);
  if (existing === undefined) claimsByIdentity.set(row.entry, [row]);
  else existing.push(row);
}

/** One entity's complete lineage: source → local → route(s) → output(s). */
interface Lineage {
  readonly local: string;
  readonly origin: string;
  /** `wp:post/product#42@en`, or absent for anything not from WordPress. */
  readonly source?: string;
  readonly collection?: string;
  readonly locale?: string;
  /** For a derived entity: what declares it. */
  readonly declaredBy?: string;
  readonly routes: readonly string[];
  readonly outputs: readonly string[];
  /** Where a reader would have looked, for an entity that produced nothing. */
  readonly expectedRoute?: string;
}

const lineage: Lineage[] = intended
  .map((row) => {
    const claims = claimsByIdentity.get(row.id) ?? [];
    // The manifest's row says WHAT it is; `content/` says which source entity
    // it was. Neither half is complete on its own, which is the whole shape of
    // this command.
    const provenance = sourceByLocal.get(row.id) ?? row.provenance;
    return {
      local: row.id,
      origin: provenance?.origin ?? "unstated",
      ...(provenance?.source === undefined
        ? {}
        : { source: sourceKey(provenance.source) }),
      ...(provenance?.collection === undefined
        ? {}
        : { collection: provenance.collection }),
      ...(provenance?.locale === undefined
        ? {}
        : { locale: provenance.locale }),
      ...(provenance?.derived === undefined
        ? {}
        : { declaredBy: provenance.derived.declaredBy }),
      routes: claims.map((claim) => claim.path).sort(),
      outputs: claims.map((claim) => claim.file).sort(),
      ...(row.expectedRoute === undefined
        ? {}
        : { expectedRoute: row.expectedRoute }),
    };
  })
  .sort((left, right) => left.local.localeCompare(right.local));

const byRoute = new Map<string, Lineage>();
const byOutput = new Map<string, Lineage>();
for (const one of lineage) {
  for (const route of one.routes) byRoute.set(route, one);
  for (const output of one.outputs) byOutput.set(output, one);
}

/** `/blog/example/` and `/blog/example` are the same page. */
const routeKey = (value: string): string => {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
};

const describe = (one: Lineage): string => {
  const lines = [
    `  local identity   ${one.local}`,
    `  origin           ${one.origin}`,
  ];
  if (one.source !== undefined) lines.push(`  source entity    ${one.source}`);
  if (one.declaredBy !== undefined)
    lines.push(`  declared by      ${one.declaredBy}`);
  if (one.collection !== undefined)
    lines.push(`  collection       ${one.collection}`);
  if (one.locale !== undefined) lines.push(`  locale           ${one.locale}`);
  lines.push(
    one.routes.length === 0
      ? `  route            none — not published by this build` +
          (one.expectedRoute === undefined
            ? ""
            : ` (expected ${one.expectedRoute})`)
      : `  route            ${one.routes.join(", ")}`,
  );
  if (one.outputs.length > 0)
    lines.push(`  output           ${one.outputs.join(", ")}`);
  return lines.join("\n");
};

const found = (one: Lineage | undefined, missing: string): void => {
  if (one === undefined) {
    process.stderr.write(`\n${missing}\n\n`);
    process.exit(1);
  }
  process.stdout.write(`\n${describe(one)}\n\n`);
};

const subject = args.positional[1];

switch (args.command) {
  case "route": {
    if (subject === undefined) {
      process.stderr.write("\nUsage: provenance route <path>\n\n");
      process.exit(1);
    }
    found(
      byRoute.get(routeKey(subject)),
      `No route "${routeKey(subject)}" in this build. ` +
        "`pnpm provenance` lists every one.",
    );
    break;
  }

  case "output": {
    if (subject === undefined) {
      process.stderr.write(
        "\nUsage: provenance output <file, relative to dist/>\n\n",
      );
      process.exit(1);
    }
    found(
      byOutput.get(subject.replace(/^\/+/, "")),
      `No output "${subject}" in this build's manifest.`,
    );
    break;
  }

  case "source": {
    if (subject === undefined) {
      process.stderr.write(
        "\nUsage: provenance source wp:<kind>/<type>#<id>[@<locale>]\n\n",
      );
      process.exit(1);
    }
    const matches = lineage.filter((one) => one.source === subject);
    if (matches.length === 0) {
      process.stderr.write(
        `\nNo entity in this build claims "${subject}".\n\n`,
      );
      process.exit(1);
    }
    // More than one is a defect the integrity gate reports; printing them all
    // is what makes it actionable rather than only detected.
    for (const one of matches) process.stdout.write(`\n${describe(one)}\n`);
    process.stdout.write("\n");
    break;
  }

  case "withheld": {
    const withheld = lineage.filter((one) => one.routes.length === 0);
    process.stdout.write(
      `\nWithheld — intended by content/, published by nothing (${withheld.length})\n\n`,
    );
    for (const one of withheld)
      process.stdout.write(
        `  ${one.local.padEnd(38)} ${one.source ?? one.origin}\n`,
      );
    process.stdout.write(
      "\n  Why each one is withheld is `pnpm content:integrity`, which names the\n" +
        "  stage and the setting responsible for every exclusion.\n\n",
    );
    break;
  }

  case "table": {
    if (args.has("--json")) {
      process.stdout.write(`${JSON.stringify(lineage, null, 2)}\n`);
      break;
    }
    process.stdout.write(
      `\nprovenance — source entity → content entry → route → output\n\n` +
        `  locale built    ${manifest.content?.locale ?? "unknown"}\n` +
        `  entities        ${lineage.length}\n` +
        `  from WordPress  ${lineage.filter((one) => one.origin === "wordpress").length}\n` +
        `  derived         ${lineage.filter((one) => one.origin === "derived").length}\n` +
        `  published       ${lineage.filter((one) => one.routes.length > 0).length}\n\n`,
    );
    const width = Math.max(...lineage.map((one) => one.local.length), 16);
    process.stdout.write(
      `  ${"LOCAL IDENTITY".padEnd(width)}  ${"SOURCE".padEnd(26)}  ROUTE\n`,
    );
    for (const one of lineage)
      process.stdout.write(
        `  ${one.local.padEnd(width)}  ` +
          `${(one.source ?? one.origin).padEnd(26)}  ` +
          `${one.routes[0] ?? "—"}${one.routes.length > 1 ? ` (+${one.routes.length - 1})` : ""}\n`,
      );
    process.stdout.write("\n");
    break;
  }

  default: {
    process.stderr.write(
      `\nUnknown command "${args.command}".\n\n` +
        "  provenance                    the lineage table (--json for CI)\n" +
        "  provenance route <path>       which entity publishes this URL\n" +
        "  provenance output <file>      which entity produced this file\n" +
        "  provenance source <wp:key>    where a source entity ended up\n" +
        "  provenance withheld           what content/ intends and nothing published\n\n",
    );
    process.exit(1);
  }
}
