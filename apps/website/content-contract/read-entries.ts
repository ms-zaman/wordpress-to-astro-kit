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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { z } from "astro/zod";

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
  slug: string;
  locale: string;
  cluster: string;
  /** `source.system` — `wordpress`, `authored` or `sample`. */
  sourceSystem?: string;
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

const ENTRY_SETS: readonly EntrySetSource[] = [
  { collection: "pages", dir: "pages", extra: "pageHierarchy" },
  { collection: "posts", dir: "posts", extra: "postTaxonomy" },
];

const identityShape = {
  slug,
  locale: localeCode,
  cluster: clusterKey,
  sourceSystem: z.enum(["wordpress", "authored", "sample"]).optional(),
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
      if (nested && currentKey === "source" && nested[1] === "system")
        fields.sourceSystem = unquote(nested[2]);
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
      entries.push({ collection: set.collection, ...result.data });
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
  for (const relative of [
    "authors.json",
    "categories.json",
    "tags.json",
    "seo/overrides.json",
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
