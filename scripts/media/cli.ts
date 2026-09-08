#!/usr/bin/env node
// `pnpm media` — the media migration engine.
//
//   node scripts/media/cli.ts discover     what the content tree references
//   node scripts/media/cli.ts capture      download what is migratable
//   node scripts/media/cli.ts verify       intended vs captured vs emitted
//
// ## The pipeline, and where each stage lives
//
//   DISCOVER   scripts/media/scan.ts        reads content/, not the build
//   IDENTIFY   src/media/asset-identity.ts  six classes, no "probably"
//   NORMALIZE  the same module              uploads:2026/01/a.png
//   OWN        distinctAssets()             one file, however many references
//   CAPTURE    this file                    GET, paced, never writes outside
//   EMIT       apps/website/public/media/   Astro's static passthrough
//   REWRITE    src/media/references.ts      at render time, by value
//   VERIFY     this file                    and preview-audit, on every build
//
// ## Why `public/` and not an asset pipeline
//
// Astro copies `public/` verbatim. The output path is therefore the URL, the
// build is deterministic, a clean build reproduces it, and — the part that
// matters — `preview-audit` ALREADY asserts that every internal asset a page
// references exists in the build output. Migrated media becomes checkable by a
// gate that was written before this engine existed, with no new coupling.
//
// Nothing is hashed. WordPress puts `2026/01/a.png` and `2026/02/a.png` in
// different months, and preserving that structure keeps two same-named files
// apart without making the output unreadable.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  isMigrated,
  outputFileFor,
  resolveMediaProfile,
  type AssetClass,
  type AssetIdentity,
} from "../../apps/website/src/media/asset-identity.ts";
import {
  assetConflicts,
  distinctAssets,
} from "../../apps/website/src/media/references.ts";
import { migration } from "../../migration.config.ts";
import { parseArgs } from "../lib/args.ts";
import { capturedFiles, scanContentTree, type FoundReference } from "./scan.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const args = parseArgs(process.argv.slice(2), {
  valued: ["--content", "--static", "--dist", "--limit"],
  defaultCommand: "discover",
});

// The same derivation the schema and the render path use: `liveOrigin` is the
// source site, so its uploads are this migration's whether or not the host was
// repeated in `media.migrateFrom`.
const profile = resolveMediaProfile(migration.media, migration.liveOrigin);
const contentRoot = path.resolve(
  repositoryRoot,
  args.value("--content", "content"),
);
const staticRoot = path.resolve(
  repositoryRoot,
  args.value("--static", "apps/website/public"),
);

const found = scanContentTree(contentRoot, profile);
const identities = found.map((one) => one.identity);
const owned = distinctAssets(identities);
const conflicts = assetConflicts(identities);

const CLASSES: readonly AssetClass[] = [
  "SUPPORTED",
  "CONFIGURED",
  "EXTERNAL",
  "UNSUPPORTED",
  "MISSING",
  "CONFLICT",
];

const byClass = (references: readonly FoundReference[]) => {
  const counts = new Map<AssetClass, number>(
    CLASSES.map((one) => [one, 0] as const),
  );
  for (const one of references)
    counts.set(
      one.identity.classification,
      (counts.get(one.identity.classification) ?? 0) + 1,
    );
  return counts;
};

const report = (): void => {
  const counts = byClass(found);
  process.stdout.write(
    `\nmedia — content/ → classification → ${profile.localBase}/\n\n` +
      `  uploads path    ${profile.uploadsPath}\n` +
      `  migrate from    ${profile.migrateFrom.length === 0 ? "(nothing — media.migrateFrom is empty)" : profile.migrateFrom.join(", ")}\n` +
      `  references      ${found.length}\n` +
      `  owned assets    ${owned.size}\n\n`,
  );
  for (const one of CLASSES)
    process.stdout.write(`  ${one.padEnd(12)} ${counts.get(one) ?? 0}\n`);
  process.stdout.write("\n");
};

/** Every migrated asset, with the one output file it owns. */
const plan = (): { key: string; identity: AssetIdentity; file: string }[] => {
  const rows: { key: string; identity: AssetIdentity; file: string }[] = [];
  for (const [key, group] of [...owned].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const identity = group.find((one) => isMigrated(one));
    if (identity === undefined) continue;
    const file = outputFileFor(identity, profile);
    if (file !== undefined) rows.push({ key, identity, file });
  }
  return rows;
};

switch (args.command) {
  case "discover": {
    report();
    const groups = new Map<AssetClass, FoundReference[]>();
    for (const one of found) {
      const list = groups.get(one.identity.classification) ?? [];
      list.push(one);
      groups.set(one.identity.classification, list);
    }
    for (const one of CLASSES) {
      const list = groups.get(one) ?? [];
      if (list.length === 0) continue;
      process.stdout.write(`  ${one}\n`);
      const seen = new Set<string>();
      for (const reference of list) {
        const line = `${reference.identity.source}`;
        if (seen.has(line)) continue;
        seen.add(line);
        process.stdout.write(
          `    ${line}\n      ${reference.where} (${reference.field})` +
            `${reference.identity.local === undefined ? "" : ` → ${reference.identity.local}`}` +
            `${reference.identity.reason === undefined ? "" : `\n      ${reference.identity.reason}`}\n`,
        );
      }
      process.stdout.write("\n");
    }
    if (conflicts.length > 0) {
      process.stdout.write(`  CONFLICT (${conflicts.length})\n`);
      for (const conflict of conflicts)
        process.stdout.write(
          `    ${conflict.key} is claimed by ${conflict.sources.join(" and ")}\n`,
        );
      process.stdout.write("\n");
      process.exit(1);
    }
    break;
  }

  case "capture": {
    const rows = plan();
    if (rows.length === 0) {
      process.stdout.write(
        "\nNothing to capture. Either the content tree references no migratable\n" +
          "media, or `media.migrateFrom` in migration.config.ts names no host —\n" +
          "a fresh clone captures nothing rather than reaching out to whatever a\n" +
          "body happens to reference.\n\n",
      );
      break;
    }
    if (migration.liveOrigin === undefined) {
      process.stderr.write(
        "\nNo `liveOrigin` in migration.config.ts, so a root-relative reference\n" +
          "names no host to fetch from. Set it, or capture with the source's\n" +
          "absolute URLs in the content.\n\n",
      );
      process.exit(1);
    }

    const limit = Number(args.value("--limit", String(rows.length)));
    const pace = migration.crawl.mediaDelayMs;
    let written = 0;
    const failures: string[] = [];

    for (const row of rows.slice(
      0,
      Number.isFinite(limit) ? limit : rows.length,
    )) {
      const destination = path.join(staticRoot, row.file);
      // Never outside the static directory. `identifyAsset` already refuses a
      // `..` segment; this is the second line, because the consequence of
      // getting it wrong is writing anywhere on the disk.
      if (!destination.startsWith(`${staticRoot}${path.sep}`)) {
        failures.push(`${row.key}: refused, path escapes ${staticRoot}`);
        continue;
      }
      if (existsSync(destination)) continue;

      const url = /^https?:\/\//i.test(row.identity.source)
        ? row.identity.source
        : row.identity.source.startsWith("//")
          ? `https:${row.identity.source}`
          : `${migration.liveOrigin.replace(/\/+$/, "")}${row.identity.source}`;

      try {
        const response = await fetch(url, {
          headers: { "user-agent": migration.crawl.userAgent },
        });
        if (!response.ok) {
          failures.push(`${row.key}: HTTP ${response.status} for ${url}`);
          continue;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength === 0) {
          failures.push(`${row.key}: zero bytes from ${url}`);
          continue;
        }
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, bytes);
        written += 1;
      } catch (cause) {
        failures.push(`${row.key}: ${(cause as Error).message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pace));
    }

    process.stdout.write(
      `\ncaptured ${written} file(s) into ${path.relative(repositoryRoot, staticRoot)}/${profile.localBase.replace(/^\/+/, "")}\n`,
    );
    if (failures.length > 0) {
      process.stderr.write(`\n${failures.length} could not be captured:\n`);
      for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
      process.stderr.write(
        "\nA reference whose file never arrived is a broken image on the live\n" +
          "site. `pnpm media verify` fails while any remain.\n\n",
      );
      process.exit(1);
    }
    break;
  }

  case "verify": {
    report();
    const rows = plan();
    const captured = capturedFiles(staticRoot, profile.localBase);
    const failures: string[] = [];

    // MISSING — a reference claims a file nothing captured.
    for (const row of rows)
      if (!captured.has(row.file))
        failures.push(
          `MISSING  ${row.identity.source}\n           expected ${row.file}, which is not in ` +
            `${path.relative(repositoryRoot, staticRoot)}/. Run \`pnpm media capture\`.`,
        );

    // Unclaimed — a captured file nothing references. Reported, not fatal by
    // itself: a file may be referenced by a template rather than by content,
    // and this scanner reads content. It is named so nobody has to guess.
    const claimed = new Set(rows.map((row) => row.file));
    const unclaimed = [...captured].filter((file) => !claimed.has(file)).sort();

    for (const conflict of conflicts)
      failures.push(
        `CONFLICT ${conflict.key} is claimed by ${conflict.sources.join(" and ")}. ` +
          "Two hosts, one output file — the engine will not choose between them.",
      );

    if (unclaimed.length > 0) {
      process.stdout.write(`  UNCLAIMED (${unclaimed.length})\n`);
      for (const file of unclaimed) process.stdout.write(`    ${file}\n`);
      process.stdout.write(
        "\n    Captured, and no content reference names them. A template may;\n" +
          "    this scanner reads content. Delete them, or leave them knowingly.\n\n",
      );
    }

    if (failures.length > 0) {
      process.stderr.write(`${failures.length} failure(s):\n\n`);
      for (const failure of failures) process.stderr.write(`  ${failure}\n\n`);
      process.exit(1);
    }
    process.stdout.write(
      `Every migrated reference names a captured file (${rows.length}).\n\n`,
    );
    break;
  }

  default: {
    process.stderr.write(
      `\nUnknown command "${args.command}".\n\n` +
        "  media discover   what the content tree references, classified\n" +
        "  media capture    download what is migratable into public/\n" +
        "  media verify     every reference names a file that is there\n\n",
    );
    process.exit(1);
  }
}
