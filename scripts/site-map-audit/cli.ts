#!/usr/bin/env node
// `pnpm sitemap:crawl` and `pnpm sitemap:audit`.
//
//   node scripts/site-map-audit/cli.ts crawl [--max-requests N] [--waves N]
//   node scripts/site-map-audit/cli.ts diff [--inventory <file>] [--dist <dir>]
//
// Two commands because they are two different acts. `crawl` reaches out to
// somebody else's server and takes time; `diff` is arithmetic over files and
// takes none. Keeping them apart means you can re-run the comparison as often
// as you like against one polite capture, which is the behaviour a rate limit
// rewards.
//
// `diff` exits non-zero when the data cannot be trusted, or when any GAP
// remains: a URL the source site serves, that this build publishes nothing
// for, that no redirect covers, and that nobody has ruled retired.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseRedirectMap } from "../../apps/website/src/deployment/redirects.ts";
import { migration } from "../../migration.config.ts";
import { crawlLiveSite, writeInventory } from "./crawl.ts";
import {
  configurationNotes,
  diffInventories,
  integrityFindings,
  type LiveRecord,
} from "./diff.ts";
import { readDistRoutes } from "./local.ts";
import { parseArgs } from "../lib/args.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const args = parseArgs(process.argv.slice(2), {
  valued: ["--max-requests", "--waves", "--inventory", "--dist"],
  defaultCommand: "diff",
});
const command = args.command;
const value = args.value;
const has = args.has;

if (command === "crawl") {
  // A misconfiguration is a message, not a stack trace. Running the crawl is
  // the first thing somebody does with this kit, and the commonest way it
  // fails is that they have not said which site to read yet.
  let result;
  try {
    result = await crawlLiveSite({
      maxRequests: Number(value("--max-requests", "2000")),
      waves: Number(value("--waves", "2")),
      onProgress: (line) => process.stdout.write(`  ${line}\n`),
    });
  } catch (cause) {
    process.stderr.write(`\n${(cause as Error).message}\n`);
    process.exit(1);
  }
  const file = writeInventory(repositoryRoot, result);
  process.stdout.write(
    `\n${result.records.length} URL(s) recorded, ${result.requests} request(s) made\n` +
      `written to ${path.relative(repositoryRoot, file)}\n`,
  );
  for (const note of result.notes) process.stdout.write(`  note: ${note}\n`);
  process.exit(0);
}

if (command !== "diff") {
  process.stderr.write(
    `unknown command "${command}". Use "crawl" or "diff".\n`,
  );
  process.exit(2);
}

// --- diff -------------------------------------------------------------------

/** The newest dated crawl, unless one is named. */
function newestInventory(): string | undefined {
  const root = path.join(repositoryRoot, migration.evidenceDir);
  if (!existsSync(root)) return undefined;
  const candidates = readdirSync(root)
    .filter((name) => name.startsWith("site-map-"))
    .sort()
    .reverse()
    .map((name) => path.join(root, name, "live-inventory.json"))
    .filter((file) => existsSync(file));
  return candidates[0];
}

const inventoryFile = value("--inventory", newestInventory() ?? "");
if (inventoryFile === "" || !existsSync(inventoryFile)) {
  process.stderr.write(
    "No live inventory to compare against.\n" +
      "Run `node scripts/site-map-audit/cli.ts crawl` first, or pass --inventory <file>.\n",
  );
  process.exit(1);
}

const distDirectory = path.resolve(
  repositoryRoot,
  value("--dist", "apps/website/dist"),
);
if (!existsSync(distDirectory)) {
  process.stderr.write(
    `No build at ${path.relative(repositoryRoot, distDirectory)} — run \`pnpm build\` first.\n`,
  );
  process.exit(1);
}

const inventory = JSON.parse(readFileSync(inventoryFile, "utf8")) as {
  crawl?: { origin?: string; startedAt?: string; requests?: number };
  records: (LiveRecord & { skipped?: string })[];
};

const live: LiveRecord[] = inventory.records.map((record) => ({
  url: record.url,
  key: record.key,
  sources: record.sources,
  ...(record.status === undefined ? {} : { status: record.status }),
  ...(record.location === undefined ? {} : { location: record.location }),
  ...(record.canonical === undefined ? {} : { canonical: record.canonical }),
}));
const local = readDistRoutes(distDirectory);

const redirects = parseRedirectMap(
  JSON.parse(
    readFileSync(path.join(repositoryRoot, "content/redirects.json"), "utf8"),
  ),
);

const diff = diffInventories(live, local, { redirects });
// Integrity is judged over the records as CRAWLED, including the ones the
// crawl deliberately skipped, because "recorded and never fetched" is exactly
// what a truncated capture looks like.
const findings = integrityFindings(
  inventory.records.filter((record) => record.skipped === undefined),
  local,
  diff,
);

process.stdout.write(
  `\nsite-map audit — ${path.relative(repositoryRoot, inventoryFile)}\n` +
    `  crawled ${inventory.crawl?.origin ?? "?"} on ${inventory.crawl?.startedAt?.slice(0, 10) ?? "?"}\n` +
    `  live ${live.length} URL(s) · local ${local.length} route(s)\n\n`,
);
for (const [name, count] of Object.entries(diff.counts))
  process.stdout.write(`  ${name.padEnd(15)} ${count}\n`);

for (const note of configurationNotes(diff))
  process.stdout.write(`\n  note: ${note}\n`);

const gaps = diff.rows.filter((row) => row.classification === "GAP");
// A gap LIST printed above an "the inventory cannot be trusted" message is a
// report contradicting itself: the reader takes the list and ignores the
// caveat. When integrity is broken, the findings are the whole output.
if (findings.length === 0 && gaps.length > 0) {
  process.stdout.write(`\n  GAPS by family:\n`);
  const byFamily = new Map<string, number>();
  for (const row of gaps)
    byFamily.set(row.family, (byFamily.get(row.family) ?? 0) + 1);
  for (const [family, count] of [...byFamily].sort())
    process.stdout.write(`    ${family.padEnd(16)} ${count}\n`);
  process.stdout.write("\n");
  for (const row of gaps.slice(0, 20))
    process.stdout.write(
      `  ✗ ${row.key} [${row.family}]${row.live?.status === undefined ? "" : ` (live ${row.live.status})`}\n`,
    );
  if (gaps.length > 20)
    process.stdout.write(`  … ${gaps.length - 20} more, all in the report\n`);
}

// The report goes beside the inventory it was computed from, so a directory is
// one crawl and everything derived from it.
const reportDirectory = path.dirname(inventoryFile);
writeFileSync(
  path.join(reportDirectory, "diff.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      counts: diff.counts,
      byFamily: diff.byFamily,
      integrityFindings: findings,
      rows: diff.rows,
    },
    null,
    2,
  )}\n`,
);

const lines: string[] = [
  `# Live and local site-map diff`,
  "",
  `Crawl: ${inventory.crawl?.origin ?? "?"} on ${inventory.crawl?.startedAt?.slice(0, 10) ?? "?"}`,
  `Live URLs: ${live.length} · Local routes: ${local.length}`,
  "",
  "| classification | count |",
  "| --- | --- |",
  ...Object.entries(diff.counts).map(
    ([name, count]) => `| ${name} | ${count} |`,
  ),
  "",
];
for (const classification of [
  "GAP",
  "REDIRECT",
  "RETIRED",
  "INFRASTRUCTURE",
  "LOCAL_ONLY",
] as const) {
  const rows = diff.rows.filter((row) => row.classification === classification);
  if (rows.length === 0) continue;
  lines.push(`## ${classification} (${rows.length})`, "");
  for (const row of rows)
    lines.push(
      `- \`${row.key}\` [${row.family}]` +
        `${row.redirectTarget === undefined ? "" : ` to \`${row.redirectTarget}\``}` +
        ` — ${row.reason}` +
        `${row.live?.status === undefined ? "" : ` (live ${row.live.status})`}`,
    );
  lines.push("");
}
if (findings.length > 0) {
  lines.push("## INTEGRITY FINDINGS", "");
  for (const finding of findings) lines.push(`- ${finding}`);
  lines.push("");
}
writeFileSync(
  path.join(reportDirectory, "diff-report.md"),
  `${lines.join("\n")}\n`,
);
process.stdout.write(
  `\n  report written to ${path.relative(repositoryRoot, reportDirectory)}/\n`,
);

for (const finding of findings)
  process.stderr.write(`\nINTEGRITY: ${finding}\n`);

if (findings.length > 0) {
  process.stderr.write(
    "\nThe inventory cannot be trusted, so no gap count is reported. A crawl taken " +
      "through a rate limit returns a smaller site that looks entirely plausible.\n",
  );
  process.exit(1);
}
if (gaps.length > 0) {
  process.stderr.write(
    `\n${gaps.length} gap(s). Every live URL is a page, a redirect, or a recorded ` +
      "decision to retire it — there is no fourth category (PLAYBOOK.md §7).\n",
  );
  process.exit(1);
}
process.stdout.write("\nNo gaps: every live URL is accounted for.\n");
