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

import {
  authorSchema,
  categorySchema,
  tagSchema,
} from "../src/content-model/registries.ts";
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

const readJson = (relativePath: string): unknown =>
  JSON.parse(readFileSync(path.join(contentRoot, relativePath), "utf8"));

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

const categories = validateRegistry("categories.json", categorySchema);
assertUnique(
  "categories.json",
  "slug",
  categories.map((row) => row.slug),
);
console.log(`  categories:     ${categories.length} rows`);

const tags = validateRegistry("tags.json", tagSchema);
assertUnique(
  "tags.json",
  "slug",
  tags.map((row) => row.slug),
);
console.log(`  tags:           ${tags.length} rows`);

const seoOverrides = validateRegistry("seo/overrides.json", seoOverrideSchema);
assertUnique(
  "seo/overrides.json",
  "path+locale",
  seoOverrides.map((row) => `${String(row.path)}@${String(row.locale)}`),
);
console.log(`  seo overrides:  ${seoOverrides.length} rows`);

try {
  const redirects = parseRedirectMap(readJson("redirects.json"));
  console.log(
    `  redirects:      ${redirects.rules.length} rule(s), ${redirects.splats.length} splat(s)`,
  );
} catch (error) {
  note(`redirects.json: ${(error as Error).message}`);
}

const tree = validateContentTree(contentRoot, {
  authors: authors.map((row) => row.slug as string),
  categories: categories.map((row) => row.slug as string),
  tags: tags.map((row) => row.slug as string),
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
