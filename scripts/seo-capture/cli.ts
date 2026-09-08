#!/usr/bin/env node
// `pnpm seo:capture` — the metadata the source publishes about itself.
//
//   node scripts/seo-capture/cli.ts [--from research/content-capture-<date>]
//                                   [--locale en] [--dry]
//
// Writes `content/seo/overrides.json`, the table the head model already reads.
//
// ## Why this exists
//
// Measured by comparing a migrated site against its source: every hand-written
// `<meta name="description">` was gone, and the home page had lost its
// `og:image`. The descriptions were not derived from the body — somebody wrote
// them — and a marketing site's meta descriptions are a migration asset in the
// same way its copy is.
//
// They are not in REST. `wp/v2/posts/<id>?_fields=meta` returned
// `{"footnotes":""}` on a site running Rank Math, because SEO plugins keep
// these in postmeta and do not register them in the public schema. The rendered
// `<head>` is where every one of them agrees to put the result.
//
// ## What it writes, and what it leaves alone
//
// A row is written only where the source says something the kit would not
// derive anyway:
//
//   * `metaDescription` — always, when the source has one. This is the field
//     the audit found missing, and the kit's own fallback is derived text.
//   * `ogImage` — when the source names one and the entry has no featured
//     image of its own to supply it.
//   * `robots` — only when the source asks for noindex or nofollow. WordPress's
//     default is `index, follow`, and recording that would put a row on every
//     page saying nothing.
//
// `metaTitle` is deliberately NOT written by default. The source's title is
// `<title>` including its own separator and site-name convention, and the kit
// composes titles itself; copying them would freeze the source's formatting
// into the new site. `--titles` opts in for a migration that wants them.
//
// `canonical` is not written either: the kit's canonical is self-referencing
// and already matched the source exactly in the audit. A stored copy would be
// a second answer that can go stale.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { migration } from "../../migration.config.ts";
import { PoliteReader, settingsFromConfig } from "../site-map-audit/fetch.ts";
import { parseArgs } from "../lib/args.ts";
import { readSourceHead, type SourceHead } from "./head.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const args = parseArgs(process.argv.slice(2), {
  valued: ["--from", "--locale", "--content", "--limit"],
});

const evidenceRoot = path.resolve(repositoryRoot, migration.evidenceDir);
const contentRoot = path.resolve(
  repositoryRoot,
  args.value("--content", "content"),
);
const locale = args.value("--locale", "en");
const dry = args.has("--dry");
const withTitles = args.has("--titles");

const captureDirectory = ((): string => {
  const named = args.value("--from", "");
  if (named !== "") return path.resolve(repositoryRoot, named);
  const candidates = existsSync(evidenceRoot)
    ? readdirSync(evidenceRoot)
        .filter((name) => name.startsWith("content-capture-"))
        .sort()
    : [];
  if (candidates.length === 0) {
    process.stderr.write(
      "\nNo capture to read the URL list from. Run `pnpm content:capture` first.\n\n",
    );
    process.exit(1);
  }
  return path.join(evidenceRoot, candidates[candidates.length - 1]!);
})();

interface Artifact {
  readonly entries?: {
    id: number;
    slug: string;
    link: string;
    status?: string;
    featured_media?: number;
    content?: { rendered?: string };
  }[];
}

const entries: {
  id: number;
  slug: string;
  link: string;
  /** True when the CONTENT MODEL will supply an og:image for this entry. */
  suppliesOwnImage: boolean;
}[] = [];
for (const name of ["post", "page"]) {
  const file = path.join(captureDirectory, `${name}.json`);
  if (!existsSync(file)) continue;
  const artifact = JSON.parse(readFileSync(file, "utf8")) as Artifact;
  for (const entry of artifact.entries ?? []) {
    if ((entry.status ?? "publish") !== "publish") continue;
    if ((entry.content?.rendered ?? "") === "") continue;
    entries.push({
      id: entry.id,
      slug: entry.slug,
      link: entry.link,
      // Only a POST carries `featuredImage` in the content model, so only a
      // post can supply its own og:image. A page's `featured_media` exists on
      // the source and has nowhere to go — measured: the home page had one,
      // and skipping on `featured_media > 0` alone dropped its social image
      // entirely.
      suppliesOwnImage: name === "post" && (entry.featured_media ?? 0) > 0,
    });
  }
}

const limit = Number(args.value("--limit", String(entries.length)));
const wanted = entries.slice(
  0,
  Number.isFinite(limit) ? limit : entries.length,
);

const reader = new PoliteReader(settingsFromConfig());

process.stdout.write(
  `\nseo:capture — reading ${wanted.length} source page(s) for the metadata\n` +
    `they publish about themselves\n\n`,
);

const rows: Record<string, unknown>[] = [];
const refused: string[] = [];
const silent: string[] = [];

for (const entry of wanted) {
  const response = await reader.get(entry.link);
  if (response.status !== 200 || response.body === undefined) {
    refused.push(`${entry.link} answered ${response.status}`);
    continue;
  }
  const head: SourceHead = readSourceHead(response.body);
  const url = new URL(entry.link);
  const row: Record<string, unknown> = {
    path: url.pathname,
    locale,
    disposition: {
      state: "preserve",
      note: "Captured from the source page's own head — see scripts/seo-capture/.",
    },
    source: {
      system: "wordpress",
      sourceId: String(entry.id),
      capturedAt: new Date().toISOString().slice(0, 10),
    },
  };

  if (head.description !== undefined) row.metaDescription = head.description;
  if (withTitles && head.title !== undefined) row.metaTitle = head.title;
  if (head.robots !== undefined) row.robots = head.robots;
  // Only when nothing else will supply one. A post's featured image already
  // reaches the head model, and a second source for one value is a second
  // answer that can disagree.
  if (head.ogImage !== undefined && !entry.suppliesOwnImage)
    row.ogImage = { url: head.ogImage };

  const said = Object.keys(row).filter(
    (key) => !["path", "locale", "disposition", "source"].includes(key),
  );
  if (said.length === 0) {
    silent.push(url.pathname);
    continue;
  }
  rows.push(row);
  process.stdout.write(`  ${url.pathname.padEnd(46)} ${said.join(", ")}\n`);
}

rows.sort((left, right) => String(left.path).localeCompare(String(right.path)));

if (!dry) {
  const file = path.join(contentRoot, "seo", "overrides.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
}

process.stdout.write(
  `\n  ${rows.length} row(s)${dry ? " would be" : ""} written` +
    `${dry ? "" : " to content/seo/overrides.json"}\n` +
    `  ${silent.length} page(s) published no metadata of their own\n` +
    `  ${reader.requests} request(s)\n`,
);

if (refused.length > 0) {
  process.stderr.write(
    `\n${refused.length} page(s) could not be read:\n` +
      refused.map((one) => `  - ${one}\n`).join("") +
      "\nTheir metadata is NOT in the table, so those routes keep the title and\n" +
      "description the kit derives. That is a gap, not a silent success.\n\n",
  );
  process.exit(1);
}
process.stdout.write("\n");
