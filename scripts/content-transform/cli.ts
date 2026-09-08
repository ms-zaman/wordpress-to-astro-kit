#!/usr/bin/env node
// `pnpm content:transform` — a capture becomes the content tree.
//
//   node scripts/content-transform/cli.ts [--from research/content-capture-<date>]
//                                         [--content content] [--locale en] [--dry]
//
// Reads the artifacts `content:capture` wrote and produces `content/posts/*.md`,
// `content/pages/*.md`, `content/categories.json`, `content/tags.json` and
// `content/authors.json`.
//
// ## What it prints, and why that is the point
//
// Every row is accounted for. A migration's worst failure is not an error, it
// is a page that was never mentioned again — so the summary states, for each
// set, how many the source declared, how many the capture holds, how many
// became entries, and how many were excluded WITH the reason. Those numbers
// have to add up, and when they do not the command says so and exits non-zero.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { sameLanguage } from "../content-capture/language.ts";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { migration } from "../../migration.config.ts";
import { parseArgs } from "../lib/args.ts";
import {
  toFrontMatter,
  transform,
  type CapturedAuthor,
  type CapturedMedia,
  type CapturedRow,
  type CapturedTerm,
  type Excluded,
} from "./transform.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const args = parseArgs(process.argv.slice(2), {
  valued: ["--from", "--content", "--locale"],
});

const evidenceRoot = path.resolve(repositoryRoot, migration.evidenceDir);
const contentRoot = path.resolve(
  repositoryRoot,
  args.value("--content", "content"),
);
const dry = args.has("--dry");

/** The newest capture directory, unless one is named. */
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
      `\nNo capture under ${path.relative(repositoryRoot, evidenceRoot)}/.\n` +
        "Run `pnpm content:capture --type post` and `--type page` first — this\n" +
        "command transforms evidence, it does not fetch anything.\n\n",
    );
    process.exit(1);
  }
  return path.join(evidenceRoot, candidates[candidates.length - 1]!);
})();

interface Artifact {
  readonly origin?: string;
  readonly type?: string;
  readonly capturedAt?: string;
  readonly declaredTotal?: number | null;
  readonly received?: number;
  readonly entries?: CapturedRow[];
  readonly taxonomies?: Record<string, CapturedTerm[]>;
  readonly authors?: CapturedAuthor[];
  readonly media?: CapturedMedia[];
  readonly sourceLanguage?: { readonly lang: string | null };
}

const read = (name: string): Artifact | undefined => {
  const file = path.join(captureDirectory, `${name}.json`);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as Artifact;
};

const postArtifact = read("post");
const pageArtifact = read("page");
if (postArtifact === undefined && pageArtifact === undefined) {
  process.stderr.write(
    `\n${path.relative(repositoryRoot, captureDirectory)} holds neither post.json\n` +
      "nor page.json. Capture at least one of them first.\n\n",
  );
  process.exit(1);
}

const locale = args.value("--locale", "en");

// --- the language the source actually publishes in --------------------------
//
// The default above is a kit's default, not a fact about your site, and it
// used to be applied in silence. On ja.wordpress.org that wrote `locale: en`
// into 709 Japanese entries and every gate passed: nothing in this repository
// compares the language it renders against the language the source declares.
//
// REST carries no language field — measured, see `content-capture/language.ts`
// — so the capture reads `<html lang>` from the front page and records it.
// Here it is used, because a recorded fact nothing reads is not a check.
const sourceLanguage =
  postArtifact?.sourceLanguage ?? pageArtifact?.sourceLanguage;
const agrees = sameLanguage(sourceLanguage?.lang ?? null, locale);
if (agrees === false && !args.has("--allow-language-mismatch")) {
  process.stderr.write(
    `\ncontent:transform REFUSED\n\n` +
      `  The source declares <html lang="${sourceLanguage?.lang}"> and this run\n` +
      `  would write locale "${locale}" into every entry.\n\n` +
      `  A wrong \`lang\` is invisible to every gate here and wrong for every\n` +
      "  consumer: a screen reader picking a voice, a search engine picking an\n" +
      "  index, a browser picking a font.\n\n" +
      `  Fix it: add "${sourceLanguage?.lang}" to content/config/locales.json and\n` +
      `  re-run with \`--locale ${sourceLanguage?.lang}\`.\n\n` +
      "  Or, if the source's declaration is the thing that is wrong, re-run with\n" +
      "  `--allow-language-mismatch` and record why.\n\n",
  );
  process.exit(1);
}
const capturedAt = (
  postArtifact?.capturedAt ??
  pageArtifact?.capturedAt ??
  new Date().toISOString()
).slice(0, 10);

/**
 * Terms and authors, pooled across both artifacts.
 *
 * A capture records the taxonomy and author rows its own entries referenced,
 * so pages and posts each carry part of the picture. Pooling them keeps a
 * post's category resolvable when only the page capture happened to see it.
 */
const pool = <T extends { id: number }>(
  pick: (artifact: Artifact) => readonly T[] | undefined,
): T[] => {
  const byId = new Map<number, T>();
  for (const artifact of [postArtifact, pageArtifact])
    if (artifact !== undefined)
      for (const row of pick(artifact) ?? []) byId.set(row.id, row);
  return [...byId.values()];
};

const categories = pool((a) => a.taxonomies?.category);
const tags = pool((a) => a.taxonomies?.post_tag);
const authors = pool((a) => a.authors);
const media = pool((a) => a.media);

const results = [
  postArtifact === undefined
    ? undefined
    : {
        kind: "post" as const,
        artifact: postArtifact,
        result: transform({
          kind: "post",
          rows: postArtifact.entries ?? [],
          capturedAt,
          categories,
          tags,
          authors,
          media,
          locale,
        }),
      },
  pageArtifact === undefined
    ? undefined
    : {
        kind: "page" as const,
        artifact: pageArtifact,
        result: transform({
          kind: "page",
          rows: pageArtifact.entries ?? [],
          capturedAt,
          categories,
          tags,
          authors,
          media,
          locale,
        }),
      },
].filter((one) => one !== undefined);

// ---------------------------------------------------------------------------
// Write.
// ---------------------------------------------------------------------------

const written: string[] = [];
/**
 * Two entries with one path is a WRITE THAT DESTROYS one of them, and it is
 * the last place the loss is still visible: after this, the file on disk looks
 * exactly like a site that only ever had one of the two rows.
 *
 * `transform` refuses a duplicate slug with a reason, so reaching here means a
 * path collided some other way. Fail loudly rather than silently keeping the
 * last writer, which is what happened before the guard existed.
 */
const write = (relative: string, body: string): void => {
  if (written.includes(relative)) {
    process.stderr.write(
      `\ncontent:transform FAILED: two entries both write ${relative}. ` +
        "Nothing has been written; this is a bug in the transform.\n",
    );
    process.exit(1);
  }
  written.push(relative);
  if (dry) return;
  const file = path.join(contentRoot, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
};

for (const one of results)
  for (const entry of one.result.entries)
    write(entry.file, `${toFrontMatter(entry.frontMatter)}\n${entry.body}\n`);

const registries = results[0]?.result;
if (registries !== undefined) {
  const json = (rows: readonly unknown[]): string =>
    `${JSON.stringify(rows, null, 2)}\n`;
  // Only the terms a transformed entry can actually reference. A registry row
  // for a term no entry uses is legal — WordPress keeps empty terms and
  // publishes their archives — so they are all written.
  write("categories.json", json(registries.categories));
  write("tags.json", json(registries.tags));
  write("authors.json", json(registries.authors));
}

// ---------------------------------------------------------------------------
// Account for every row.
// ---------------------------------------------------------------------------

process.stdout.write(
  `\ncontent:transform — ${path.relative(repositoryRoot, captureDirectory)} → ` +
    `${path.relative(repositoryRoot, contentRoot)}/\n\n` +
    `  source origin   ${postArtifact?.origin ?? pageArtifact?.origin ?? "unknown"}\n` +
    `  locale          ${locale}\n` +
    `  captured        ${capturedAt}\n\n`,
);

let unaccounted = 0;
const allExcluded: Excluded[] = [];

for (const one of results) {
  const declared = one.artifact.declaredTotal;
  const held = (one.artifact.entries ?? []).length;
  const made = one.result.entries.length;
  const skipped = one.result.excluded.length;
  allExcluded.push(...one.result.excluded);

  process.stdout.write(
    `  ${one.kind.toUpperCase()}\n` +
      `    the source declares   ${declared ?? "?"}\n` +
      `    the capture holds     ${held}\n` +
      `    became entries        ${made}\n` +
      `    excluded, with reason ${skipped}\n`,
  );
  if (made + skipped !== held) {
    unaccounted += held - made - skipped;
    process.stdout.write(
      `    !! ${held - made - skipped} row(s) UNACCOUNTED FOR\n`,
    );
  }
  if (declared !== null && declared !== undefined && declared !== held)
    process.stdout.write(
      `    !! the source declares ${declared} and the capture holds ${held} — ` +
        `re-capture before trusting this\n`,
    );
  process.stdout.write("\n");
}

process.stdout.write(
  `  REGISTRIES\n` +
    `    categories            ${registries?.categories.length ?? 0}\n` +
    `    tags                  ${registries?.tags.length ?? 0}\n` +
    `    authors               ${registries?.authors.length ?? 0}\n\n`,
);

// The registries are built from ONE capture and `transform` runs once per post
// type, so the same refused term arrives twice. De-duplicated on the source
// identity, never on the slug — the slug is the field that failed.
const registryExcluded = [
  ...new Map(
    results
      .flatMap((one) => one.result.registryExcluded)
      .map((row) => [`${row.kind}#${row.id}`, row]),
  ).values(),
];

const decodedSlugs = [
  ...new Map(
    results
      .flatMap((one) => one.result.decodedSlugs)
      .map((row) => [`${row.kind}#${row.raw}`, row]),
  ).values(),
];

if (decodedSlugs.length > 0) {
  process.stdout.write(
    `  PERCENT-DECODED SLUGS (${decodedSlugs.length})\n` +
      "    WordPress percent-encodes a non-ASCII slug on the way into the\n" +
      "    database. These are stored decoded, which is the same URL.\n",
  );
  for (const one of decodedSlugs)
    process.stdout.write(`    ${one.kind}: ${one.raw}\n      -> ${one.slug}\n`);
  process.stdout.write("\n");
}

if (registryExcluded.length > 0) {
  process.stdout.write(
    `  REGISTRY ROWS EXCLUDED (${registryExcluded.length})\n` +
      "    A term or author with no row here is a reference no entry can\n" +
      "    resolve. Every post that named one is an issue below.\n",
  );
  for (const one of registryExcluded)
    process.stdout.write(
      `    ${one.kind}/${one.slug || one.id}\n` +
        `      reason: ${one.reason}\n      ${one.detail}\n`,
    );
  process.stdout.write("\n");
}

if (allExcluded.length > 0) {
  process.stdout.write(`  EXCLUDED (${allExcluded.length})\n`);
  for (const one of allExcluded)
    process.stdout.write(
      `    ${one.kind}/${one.slug || one.id}\n` +
        `      reason: ${one.reason}\n      ${one.detail}\n`,
    );
  process.stdout.write("\n");
}

const issues = results.flatMap((one) => one.result.issues);
if (issues.length > 0) {
  process.stdout.write(`  ISSUES (${issues.length})\n`);
  for (const issue of issues)
    process.stdout.write(`    [${issue.code}] ${issue.message}\n`);
  process.stdout.write("\n");
}

process.stdout.write(
  dry
    ? `  --dry: ${written.length} file(s) would be written, none were.\n\n`
    : `  ${written.length} file(s) written.\n\n` +
        "  Next: `pnpm content` to validate, `pnpm media capture` to bring the\n" +
        "  media library local, then `pnpm build`.\n\n",
);

// An unaccounted row is a row that entered the transform and left no trace —
// neither an entry nor an exclusion. That is the failure this whole command is
// shaped to make impossible, so it is the one that fails the command.
if (unaccounted !== 0) {
  process.stderr.write(
    `${unaccounted} captured row(s) produced neither an entry nor an exclusion.\n`,
  );
  process.exit(1);
}
