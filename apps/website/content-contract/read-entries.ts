// Entry reader — the input side of cross-entry validation.
//
// The cross-entry rules in `src/content-model/cross-entry.ts` are pure and
// take entries as arguments. This module reads the real entry files and
// yields the identity fields those rules need: `slug`, `locale`, `cluster`,
// plus `parent` for pages and `author` / `categories` / `tags` for posts —
// and `source.system`, so a production build can refuse sample content.
//
// Full front-matter validation is Astro's job: `astro check` / `astro build`
// parse every entry against its collection schema. This reader deliberately
// does not duplicate it; every field it does read is parsed with the same
// schema primitives the content model uses, so a value it cannot understand
// is REJECTED and reported rather than normalised.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { z } from "astro/zod";

import { migration } from "../../../migration.config.ts";
import { entryIdentityIssues } from "../src/content-model/ownership.ts";
import {
  provenanceOfEntity,
  sourceIdentityIssues,
  typeVocabulary,
  type Provenance,
  type SourceClaimant,
} from "../src/content-model/provenance.ts";
import { clusterKey, localeCode, slug } from "../src/content-model/shared.ts";
import {
  validateClusters,
  validatePageParents,
  validateTaxonomyReferences,
  type TaxonomyRegistries,
  type ValidationIssue,
} from "../src/content-model/cross-entry.ts";

/** An entry as the cross-entry rules see it. */
export interface LoadedEntry {
  collection: string;
  /**
   * The file it came from, relative to `content/`.
   *
   * Carried so a collision can NAME both sides. A report that says "duplicate
   * identity" without saying which two files leaves the reader grepping, and
   * everything this contract catches is by nature hard to see.
   */
  file?: string;
  slug: string;
  locale: string;
  cluster: string;
  /** `source.system` — `wordpress`, `authored` or `sample`. */
  sourceSystem?: string;
  /** `source.sourceId` — the WordPress primary key, for a captured entry. */
  sourceId?: string;
  parent?: string;
  categories?: string[];
  author?: string;
  tags?: string[];
}

export interface ContentTreeResult {
  entries: LoadedEntry[];
  /** Entry files that could not be read into an identity — reported, not thrown. */
  problems: string[];
  issues: ValidationIssue[];
}

interface EntrySetSource {
  readonly collection: string;
  /** Storage path relative to the content root — mirrors `src/content.config.ts`. */
  readonly dir: string;
  readonly extra: "pageHierarchy" | "postTaxonomy";
}

/**
 * Every directory of entries this content tree is allowed to have.
 *
 * The two core sets, plus one per configured custom post type. Built from
 * `migration.config.ts` rather than written out, so a type added there is
 * validated here without a second edit — and, more importantly, so that
 * REMOVING a profile leaves its directory unclaimed and therefore reported.
 */
const ENTRY_SETS: readonly EntrySetSource[] = [
  { collection: "pages", dir: "pages", extra: "pageHierarchy" },
  { collection: "posts", dir: "posts", extra: "postTaxonomy" },
  ...migration.postTypes.map((profile) => ({
    collection: profile.collection,
    dir: profile.collection,
    // A custom type carries no page hierarchy and no post taxonomy fields; its
    // identity is the shared shape and nothing more.
    extra: "none" as const,
  })),
];

/**
 * Entry directories that no collection claims.
 *
 * ## The hole this closes
 *
 * Delete a custom type's profile and its `content/<collection>/` directory
 * stays behind, full of entries. Nothing defines a collection for it any more,
 * so `getCollection` never yields those entries, so they never enter the
 * deployment manifest's `intended` list — and `content:integrity` reports zero
 * findings, because the join has nothing on either side.
 *
 * That is the same failure the integrity gate was built to end, one level
 * upstream: a gate cannot miss content it was never shown. Measured — renaming
 * one profile left three entries orphaned and the whole ladder green.
 *
 * So the FILESYSTEM is the authority here. This walks `content/` and reports
 * any directory holding entry files that no set in `ENTRY_SETS` claims.
 */
/**
 * Registry files at the content root that no collection claims.
 *
 * The same hole as `unclaimedEntryDirectories`, in the shape the taxonomy
 * model uses: a custom taxonomy's terms live in `content/<collection>.json`,
 * a FILE, and a directory walk cannot see one. Delete a taxonomy profile and
 * its registry stays behind — nothing loads it, so its terms never reach the
 * intended inventory, so `content:integrity` reports nothing.
 *
 * Measured: renaming one taxonomy's collection left four terms orphaned and
 * the whole ladder green, exactly as removing a post-type profile once did.
 */
export function unclaimedRegistryFiles(contentRoot: string): ValidationIssue[] {
  const claimed = new Set([
    // The kit's own registries and data files.
    "authors.json",
    "categories.json",
    "tags.json",
    "redirects.json",
    ...migration.taxonomies.map((profile) => `${profile.collection}.json`),
  ]);
  const unclaimed: ValidationIssue[] = [];
  let names: string[];
  try {
    names = readdirSync(contentRoot);
  } catch {
    return [];
  }
  for (const name of names) {
    if (!name.endsWith(".json") || claimed.has(name)) continue;
    const file = path.join(contentRoot, name);
    if (!statSync(file).isFile()) continue;
    unclaimed.push({
      code: "registry-file-unclaimed",
      message:
        `content/${name} is a registry no collection claims. Nothing loads it, ` +
        `so nothing can report its rows missing either — not the build, not the ` +
        `manifest, not content:integrity. Add a profile for it to ` +
        `\`taxonomies\` in migration.config.ts, or delete the file.`,
    });
  }
  return unclaimed;
}

export function unclaimedEntryDirectories(
  contentRoot: string,
): ValidationIssue[] {
  const claimed = new Set(ENTRY_SETS.map((set) => set.dir));
  const unclaimed: ValidationIssue[] = [];
  let names: string[];
  try {
    names = readdirSync(contentRoot);
  } catch {
    return [];
  }
  for (const name of names) {
    if (claimed.has(name)) continue;
    const directory = path.join(contentRoot, name);
    if (!statSync(directory).isDirectory()) continue;
    const files = listEntryFiles(directory);
    if (files.length === 0) continue;
    unclaimed.push({
      code: "entry-directory-unclaimed",
      message:
        `content/${name}/ holds ${files.length} entr${files.length === 1 ? "y" : "ies"} ` +
        `and no collection claims it. Nothing loads them, so nothing can report ` +
        `them missing either — not the build, not the manifest, not ` +
        `content:integrity. Add a profile for it to \`postTypes\` in ` +
        `migration.config.ts, or delete the directory.`,
    });
  }
  return unclaimed;
}

/** Collection → WordPress type, for this configuration. */
const vocabulary = typeVocabulary(migration);

const identityShape = {
  slug,
  locale: localeCode,
  cluster: clusterKey,
  sourceSystem: z.enum(["wordpress", "authored", "sample"]).optional(),
  sourceId: z.string().min(1).optional(),
};

const IDENTITY_KEYS = ["slug", "locale", "cluster"] as const;
const ARRAY_KEYS = new Set<string>(["categories", "tags"]);

const EXTRAS = {
  pageHierarchy: {
    keys: ["parent"] as const,
    schema: z.strictObject({ ...identityShape, parent: slug.optional() }),
  },
  postTaxonomy: {
    keys: ["author", "categories", "tags"] as const,
    schema: z.strictObject({
      ...identityShape,
      author: slug,
      categories: z.array(slug).min(1),
      tags: z.array(z.string().min(1)).default([]),
    }),
  },
  /** A custom post type: the shared identity and nothing more. */
  none: {
    keys: [] as const,
    schema: z.strictObject({ ...identityShape }),
  },
} as const;

const keysFor = (set: EntrySetSource): readonly string[] => [
  ...IDENTITY_KEYS,
  ...EXTRAS[set.extra].keys,
];

/** Trailing `# comment` on an unquoted scalar is not part of the value. */
const stripComment = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return trimmed;
  const comment = trimmed.search(/\s#/);
  return comment === -1 ? trimmed : trimmed.slice(0, comment);
};

const unquote = (value: string): string => {
  const trimmed = stripComment(value);
  const quoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")));
  return quoted ? trimmed.slice(1, -1) : trimmed;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;
const NESTED_KEY = /^[ \t]+([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;
const SEQUENCE_ITEM = /^[ \t]*-[ \t]+(.*)$/;

/**
 * Pull the wanted top-level front-matter fields out of a Markdown entry, plus
 * `source.system` from the one nested mapping the rules care about. Returns
 * null when the file has no front-matter block at all.
 */
const extractFrontmatterFields = (
  source: string,
  wanted: readonly string[],
): Record<string, unknown> | null => {
  const block = FRONTMATTER.exec(source);
  if (!block) return null;

  const wantedKeys = new Set(wanted);
  const fields: Record<string, unknown> = {};
  let currentKey: string | null = null;

  for (const line of block[1].split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const item = SEQUENCE_ITEM.exec(line);
    if (item && currentKey !== null && Array.isArray(fields[currentKey])) {
      (fields[currentKey] as string[]).push(unquote(item[1]));
      continue;
    }

    const keyed = TOP_LEVEL_KEY.exec(line);
    if (!keyed) {
      const nested = NESTED_KEY.exec(line);
      if (nested && currentKey === "source") {
        if (nested[1] === "system") fields.sourceSystem = unquote(nested[2]);
        // The source id is read HERE, at the filesystem, and not only through
        // the collection loader — because the invariant it feeds (one source
        // entity, one local identity) can only be checked by something that
        // sees every competing file, and a loader has already picked a winner.
        if (nested[1] === "sourceId") fields.sourceId = unquote(nested[2]);
      }
      continue;
    }

    const [, key, rawValue] = keyed;
    currentKey = key;
    if (!wantedKeys.has(key)) continue;

    const value = rawValue.trim();
    if (!ARRAY_KEYS.has(key)) {
      fields[key] = unquote(value);
      continue;
    }

    if (value === "") {
      fields[key] = [];
    } else if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      fields[key] =
        inner === "" ? [] : inner.split(",").map((member) => unquote(member));
    } else {
      fields[key] = unquote(value);
    }
  }

  return fields;
};

/** Entry files, recursively, excluding the boundary READMEs. */
const listEntryFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...listEntryFiles(full));
    else if (item.name.endsWith(".md") && item.name !== "README.md")
      files.push(full);
  }
  return files.sort();
};

/** Read every entry in a content tree. Unreadable entries are collected as problems. */
export function readEntries(contentRoot: string): {
  entries: LoadedEntry[];
  problems: string[];
} {
  const entries: LoadedEntry[] = [];
  const problems: string[] = [];

  for (const set of ENTRY_SETS) {
    for (const file of listEntryFiles(path.join(contentRoot, set.dir))) {
      const label = path.relative(contentRoot, file);
      const raw = readFileSync(file, "utf8");
      const extracted = extractFrontmatterFields(raw, keysFor(set));
      if (extracted === null) {
        problems.push(`${label}: no \`---\` front-matter block.`);
        continue;
      }
      const result = EXTRAS[set.extra].schema.safeParse(extracted);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const at = issue.path.length > 0 ? issue.path.join(".") : "(entry)";
          problems.push(`${label}.${at}: ${issue.message}`);
        }
        continue;
      }
      entries.push({ collection: set.collection, file: label, ...result.data });
    }
  }

  return { entries, problems };
}

/** Registry rows that declare a `source.system`. */
const registrySources = (
  contentRoot: string,
  relative: string,
): { label: string; system?: string }[] => {
  const file = path.join(contentRoot, relative);
  if (!existsSync(file)) return [];
  const rows = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => ({
    label: `${relative}[${index}]`,
    system: (row as { source?: { system?: string } })?.source?.system,
  }));
};

/**
 * Everything in a content tree that carries `source.system: "sample"` —
 * entries and registry rows alike. A production build fails while this is
 * not empty: the kit's sample content must never ship as a site.
 */
export function sampleEntries(contentRoot: string): string[] {
  const labels: string[] = [];
  for (const entry of readEntries(contentRoot).entries)
    if (entry.sourceSystem === "sample")
      labels.push(`${entry.collection}/${entry.slug}`);
  // The configured taxonomy registries are in this list because they are
  // content like any other: leaving them out meant a term marked
  // `system: "sample"` would have shipped in a production build, which is the
  // one thing this function exists to stop.
  for (const relative of [
    "authors.json",
    "categories.json",
    "tags.json",
    "seo/overrides.json",
    ...migration.taxonomies.map((profile) => `${profile.collection}.json`),
  ])
    for (const row of registrySources(contentRoot, relative))
      if (row.system === "sample") labels.push(row.label);
  const navigation = path.join(contentRoot, "navigation");
  if (existsSync(navigation))
    for (const name of readdirSync(navigation).sort()) {
      if (!name.endsWith(".json")) continue;
      const menu = JSON.parse(
        readFileSync(path.join(navigation, name), "utf8"),
      ) as { source?: { system?: string } };
      if (menu?.source?.system === "sample") labels.push(`navigation/${name}`);
    }
  return labels;
}

/**
 * Run the cross-entry rules against a content tree. The seam both callers
 * cross: `validate-content.ts` passes the repository content root, the
 * contract runner passes fixture tree roots.
 */
export function validateContentTree(
  contentRoot: string,
  registries?: TaxonomyRegistries,
): ContentTreeResult {
  const { entries, problems } = readEntries(contentRoot);

  const issues = [
    // Identity FIRST, because everything after it assumes the set of entries
    // is the set of entries. A collision here means one of the competing files
    // is already invisible to every check below.
    //
    // COLLECTION ownership is not here on purpose: it is a property of the
    // configuration, not of a content tree, and asserting it inside a
    // tree-shaped check made the contract's own fixture trees fail for a
    // reason that had nothing to do with them. `validate-content.ts` owns it.
    ...entryIdentityIssues(entries),
    // And the provenance form of the same invariant: two entities carrying one
    // WordPress id. Nothing else in the pipeline can see this one — the local
    // identities differ, the routes differ, the output files differ, so slug,
    // route and output uniqueness all pass and one of the two is still not the
    // entity it claims to be.
    //
    // Entries AND registry rows, in one pass, because a source entity is a
    // source entity whichever file it lives in — and because the ids are no
    // longer published in the deployment manifest, this is the authoritative
    // check rather than a duplicate of one.
    ...sourceIdentityIssues(readProvenance(contentRoot).claims),
    ...unclaimedEntryDirectories(contentRoot),
    ...unclaimedRegistryFiles(contentRoot),
    ...validateClusters(entries),
    ...validatePageParents(
      entries
        .filter((entry) => entry.collection === "pages")
        .map((entry) => ({
          slug: entry.slug,
          locale: entry.locale,
          parent: entry.parent,
        })),
    ),
    ...(registries ? validateTaxonomyReferences(entries, registries) : []),
  ];

  return { entries, problems, issues };
}

// ---------------------------------------------------------------------------
// Provenance, read from the content tree.
// ---------------------------------------------------------------------------

/**
 * Every source entity in a content tree, with the local identity it produced.
 *
 * ## Why this is read from `content/` and not from a build artifact
 *
 * `dist/deployment.json` is a ROUTE, so anything in it is published — and the
 * WordPress ids describe the site somebody migrated FROM, which a deployment
 * has no need to serve. So the manifest carries provenance WITHOUT the source
 * entity, and everything that needs the ids reads them from here.
 *
 * That is not a workaround, it is the shorter path. The ids were written into
 * front matter and registry rows by whoever migrated the content; the content
 * tree is where they authoritatively live, and a build artifact would only
 * ever have been a snapshot of this. One fewer file to produce, to keep in
 * step, and to accidentally deploy.
 *
 * The caveat, stated because it is real: a tool that joins this against a
 * `dist/` built from OLDER content is comparing two moments. Every gate in
 * this kit that reads `dist/` has that property; run the build first.
 */
export function readProvenance(contentRoot: string): {
  claims: SourceClaimant[];
  problems: string[];
} {
  const claims: SourceClaimant[] = [];
  const problems: string[] = [];

  const claim = (
    local: string,
    collection: string,
    source: { system: string; sourceId?: string } | undefined,
    by: string,
    locale?: string,
  ): void => {
    const provenance: Provenance | undefined = provenanceOfEntity({
      local,
      collection,
      locale,
      source,
      vocabulary,
    });
    if (provenance !== undefined) claims.push({ provenance, by });
  };

  for (const entry of readEntries(contentRoot).entries)
    claim(
      `${entry.collection}/${entry.slug}@${entry.locale}`,
      entry.collection,
      entry.sourceSystem === undefined
        ? undefined
        : { system: entry.sourceSystem, sourceId: entry.sourceId },
      entry.file ?? `${entry.collection}/${entry.slug}`,
      entry.locale,
    );

  // Registry rows are source entities too — a user, a `category` term, a
  // `post_tag` term, and every custom taxonomy's terms.
  const registries: { file: string; collection: string }[] = [
    { file: "authors.json", collection: "authors" },
    { file: "categories.json", collection: "categories" },
    { file: "tags.json", collection: "tags" },
    ...migration.taxonomies.map((profile) => ({
      file: `${profile.collection}.json`,
      collection: profile.collection,
    })),
  ];

  for (const registry of registries) {
    const file = path.join(contentRoot, registry.file);
    if (!existsSync(file)) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(readFileSync(file, "utf8"));
    } catch (cause) {
      problems.push(`${registry.file}: ${(cause as Error).message}`);
      continue;
    }
    if (!Array.isArray(rows)) {
      problems.push(`${registry.file}: expected an array of registry rows.`);
      continue;
    }
    for (const row of rows as {
      slug?: string;
      source?: { system: string; sourceId?: string };
    }[])
      claim(
        `${registry.collection}/${String(row.slug)}`,
        registry.collection,
        row.source,
        `${registry.file} "${String(row.slug)}"`,
      );
  }

  return { claims, problems };
}
