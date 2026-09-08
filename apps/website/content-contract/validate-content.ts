// Real-content validation.
//
// Astro validates entry front matter against the collection schemas during
// `astro check` / `astro build`. What it cannot do per-entry is checked here
// against the actual repository content: registry files parse against their
// schemas (they are data, not entries); the cross-entry rules — translation
// clusters, page hierarchy, post ↔ registry references; the site identity and
// the redirect table parse; and, with `--production`, that no sample content
// remains.
//
// Invoke with `pnpm content:validate`. Node 24 baseline, no dependency.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { authorSchema } from "../src/content-model/registries.ts";
import { allTaxonomies } from "../src/routing/taxonomies.ts";
import { taxonomyTermSchema } from "../src/content-model/taxonomy-term.ts";
import { migration } from "../../../migration.config.ts";
import { collectionOwnershipIssues } from "../src/content-model/ownership.ts";
import { seoOverrideSchema } from "../src/content-model/seo-override.ts";
import { localeRegistry } from "../src/content-model/shared.ts";
import { parseRedirectMap } from "../src/deployment/redirects.ts";
import { site } from "../src/rendering/site-identity.ts";
import { sampleEntries, validateContentTree } from "./read-entries.ts";

const contentRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../content",
);
const production = process.argv.includes("--production");

const problems: string[] = [];
const note = (message: string) => problems.push(message);

/**
 * Read one registry file.
 *
 * A missing or unparseable file is a PROBLEM, not an exception. The list of
 * files to read is derived from `migration.config.ts` — every configured
 * taxonomy expects a registry — so the first person to remove a sample
 * taxonomy in the wrong order got an ENOENT stack trace from `node:fs` naming
 * an absolute path, with nothing to say which config field asked for it.
 */
const MISSING = Symbol("missing");

const readJson = (relativePath: string): unknown => {
  let raw: string;
  try {
    raw = readFileSync(path.join(contentRoot, relativePath), "utf8");
  } catch {
    note(
      `${relativePath}: no such file. Something in migration.config.ts asks ` +
        "for this registry — a taxonomy in `taxonomies`, or a custom type in " +
        "`postTypes`. Remove the configuration or add the file.",
    );
    return MISSING;
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    note(`${relativePath}: is not valid JSON — ${(cause as Error).message}`);
    return MISSING;
  }
};

const validateRegistry = (
  relativePath: string,
  schema: {
    safeParse: (data: unknown) => {
      success: boolean;
      error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
    };
  },
): Array<Record<string, unknown>> => {
  const rows = readJson(relativePath);
  if (rows === MISSING) return [];
  if (!Array.isArray(rows)) {
    note(`${relativePath}: expected an array of registry rows.`);
    return [];
  }
  rows.forEach((row, index) => {
    const result = schema.safeParse(row);
    if (!result.success)
      for (const issue of result.error?.issues ?? [])
        note(
          `${relativePath}[${index}].${issue.path.join(".")}: ${issue.message}`,
        );
  });
  return rows as Array<Record<string, unknown>>;
};

const assertUnique = (
  relativePath: string,
  field: string,
  values: unknown[],
) => {
  const seen = new Set<string>();
  for (const value of values) {
    const key = String(value);
    if (seen.has(key)) note(`${relativePath}: duplicate ${field} "${key}".`);
    seen.add(key);
  }
};

console.log(
  `Validating repository content at ${path.relative(process.cwd(), contentRoot)}\n`,
);

// Configuration first. Every collection must have exactly one owner, and this
// is checked before a single file is read: `content.config.ts` composes its
// collections with an object spread, so a contested collection means one whole
// content set has already stopped existing by the time anything loads it.
//
// Fatal immediately rather than collected: every check below assumes it knows
// which directory belongs to which collection. Measured — with a taxonomy
// pointed at a post type's collection, this file crashed with an ENOENT
// looking for a registry that was never supposed to exist, and the reader got
// a stack trace instead of the one sentence that explains it.
const ownership = collectionOwnershipIssues({
  postTypes: migration.postTypes,
  taxonomies: migration.taxonomies,
});
if (ownership.length > 0) {
  console.error(
    `\nContent configuration FAILED (${ownership.length} problem(s)):`,
  );
  for (const issue of ownership)
    console.error(`  - [${issue.code}] ${issue.message}`);
  process.exit(1);
}

// The site identity and the locale registry are parsed at module load; the
// imports having succeeded is the assertion. Report them for visibility.
console.log(
  `  site:           "${site.name}" — origin ${site.origin ?? "not decided"}`,
);
console.log(
  `  locale registry: ${localeRegistry.locales.length} locale(s), default "${localeRegistry.defaultLocale}"`,
);

const authors = validateRegistry("authors.json", authorSchema);
assertUnique(
  "authors.json",
  "slug",
  authors.map((row) => row.slug),
);
assertUnique(
  "authors.json",
  "nicename",
  authors.map((row) => row.nicename ?? row.slug),
);
console.log(`  authors:        ${authors.length} rows`);

// ---------------------------------------------------------------------------
// Every taxonomy registry, core and configured, through ONE loop.
//
// WordPress's `category` and `post_tag` used to be validated by hand here while
// configured taxonomies had a profile-driven loop of their own — so core
// categories got a duplicate-slug check and nothing else. They had no `parent`
// field to check, which is exactly the gap: a WordPress category IS
// hierarchical (measured — see src/routing/taxonomies.ts), and the kit could
// not represent one.
//
// Read from the FILE, and not only through Astro. Measured: adding a second
// term with slug `laptops` to one registry produced a green build in which
// Astro's `file()` loader had keyed the rows by slug and silently kept ONE of
// them. The route for the first was gone, the manifest listed one term,
// intended and emitted agreed, and `content:integrity` reported nothing.
//
// That is the shape this kit has met repeatedly: a loader assigning identity
// from content, and content that legitimately repeats. The filesystem is the
// only authority that sees both rows.
const termsByCollection = new Map<string, string[]>();
for (const taxonomy of allTaxonomies()) {
  const file = `${taxonomy.collection}.json`;
  const terms = validateRegistry(file, taxonomyTermSchema);
  assertUnique(
    file,
    "slug",
    terms.map((row) => row.slug),
  );
  const slugs = new Set(terms.map((row) => String(row.slug)));
  termsByCollection.set(taxonomy.collection, [...slugs]);
  for (const row of terms) {
    if (row.parent === undefined) continue;
    if (!taxonomy.hierarchical)
      note(
        `${file}: term "${String(row.slug)}" names a parent, but taxonomy ` +
          `"${taxonomy.name}" is not hierarchical.`,
      );
    else if (!slugs.has(String(row.parent)))
      note(
        `${file}: term "${String(row.slug)}" names parent ` +
          `"${String(row.parent)}", which is not a term in this registry.`,
      );
    else if (String(row.parent) === String(row.slug))
      note(`${file}: term "${String(row.slug)}" is its own parent.`);
  }
  console.log(
    `  ${`${taxonomy.name}:`.padEnd(15)} ${terms.length} term(s)` +
      `${taxonomy.builtIn ? " (WordPress's own)" : ""}` +
      `${taxonomy.published ? "" : " (stored only)"}`,
  );
}

const categories = termsByCollection.get("categories") ?? [];
const tags = termsByCollection.get("tags") ?? [];

const seoOverrides = validateRegistry("seo/overrides.json", seoOverrideSchema);
assertUnique(
  "seo/overrides.json",
  "path+locale",
  seoOverrides.map((row) => `${String(row.path)}@${String(row.locale)}`),
);
console.log(`  seo overrides:  ${seoOverrides.length} rows`);

const redirectData = readJson("redirects.json");
if (redirectData !== MISSING)
  try {
    const redirects = parseRedirectMap(redirectData);
    console.log(
      `  redirects:      ${redirects.rules.length} rule(s), ${redirects.splats.length} splat(s)`,
    );
  } catch (error) {
    note(`redirects.json: ${(error as Error).message}`);
  }

const tree = validateContentTree(contentRoot, {
  authors: authors.map((row) => row.slug as string),
  categories,
  tags,
});

for (const problem of tree.problems) note(problem);

const clusters = new Set(tree.entries.map((entry) => entry.cluster));
console.log(
  `  entries:        ${tree.entries.length} across ${clusters.size} cluster(s)`,
);

for (const issue of tree.issues) note(`[${issue.code}] ${issue.message}`);

const samples = sampleEntries(contentRoot);
console.log(`  sample content: ${samples.length} item(s)`);
if (production && samples.length > 0)
  note(
    `production: ${samples.length} sample item(s) remain — ${samples.slice(0, 5).join(", ")}${samples.length > 5 ? ", …" : ""}. Sample content never ships.`,
  );

if (problems.length > 0) {
  console.error(`\nContent validation FAILED (${problems.length} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log("\nContent validation OK\n");
