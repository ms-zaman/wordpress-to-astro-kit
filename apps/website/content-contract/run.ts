// Content contract tests. Every fixture under `fixtures/` asserts that the
// schema layer accepts what the model says is valid and REJECTS each
// documented violation class — fail loudly, never normalise silently.
// `fixtures/content-trees/` covers the cross-entry rules end to end through
// the SAME `validateContentTree` seam `validate-content.ts` crosses.
//
// Node 24 baseline, no test runner. Invoke with `pnpm content:contract`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { navigationSchema } from "../src/content-model/navigation.ts";
import { pageSchema } from "../src/content-model/page.ts";
import { postSchema } from "../src/content-model/post.ts";
import {
  authorSchema,
  categorySchema,
  tagSchema,
} from "../src/content-model/registries.ts";
import { seoOverrideSchema } from "../src/content-model/seo-override.ts";
import {
  validateClusters,
  validatePageParents,
  validateTaxonomyReferences,
  type TaxonomyEntry,
  type TaxonomyRegistries,
  type ValidationIssue,
} from "../src/content-model/cross-entry.ts";
import { sampleEntries, validateContentTree } from "./read-entries.ts";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

const readFixture = (group: string, name: string): unknown =>
  JSON.parse(readFileSync(path.join(fixturesDir, group, name), "utf8"));

const listFixtures = (group: string): string[] =>
  readdirSync(path.join(fixturesDir, group))
    .filter((name) => name.endsWith(".json"))
    .sort();

/** Per-entry fixtures map to the schema that owns them, by name prefix. */
const schemaFor = (
  name: string,
): { safeParse: (data: unknown) => { success: boolean } } | undefined => {
  if (name.startsWith("post")) return postSchema;
  if (name.startsWith("page")) return pageSchema;
  if (name.startsWith("author")) return authorSchema;
  if (name.startsWith("category")) return categorySchema;
  if (name.startsWith("tag")) return tagSchema;
  if (name.startsWith("navigation")) return navigationSchema;
  if (name.startsWith("seo-override")) return seoOverrideSchema;
  return undefined;
};

interface CrossFixture {
  kind: "clusters" | "taxonomy" | "parents";
  entries?: Array<{
    collection: string;
    slug: string;
    locale: string;
    cluster: string;
  }>;
  pages?: Array<{ slug: string; locale: string; parent?: string }>;
  registries?: TaxonomyRegistries;
}

const EMPTY_REGISTRIES: TaxonomyRegistries = {
  authors: [],
  categories: [],
  tags: [],
};

const runCross = (fixture: CrossFixture): ValidationIssue[] => {
  if (fixture.kind === "clusters")
    return validateClusters(fixture.entries ?? []);
  if (fixture.kind === "parents")
    return validatePageParents(fixture.pages ?? []);
  return validateTaxonomyReferences(
    (fixture.entries ?? []) as unknown as TaxonomyEntry[],
    fixture.registries ?? EMPTY_REGISTRIES,
  );
};

let passed = 0;
const failures: string[] = [];

const record = (ok: boolean, label: string, detail: string) => {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label} — ${detail}`);
    console.log(`  ✗ ${label} — ${detail}`);
  }
};

console.log("\nPer-entry schemas — valid fixtures must be ACCEPTED");
for (const name of listFixtures("valid")) {
  const schema = schemaFor(name);
  if (!schema) {
    failures.push(`${name} — no schema mapped for fixture`);
    continue;
  }
  const result = schema.safeParse(readFixture("valid", name));
  record(result.success, `valid/${name}`, "expected acceptance, got rejection");
}

console.log("\nPer-entry schemas — invalid fixtures must be REJECTED");
for (const name of listFixtures("invalid")) {
  const schema = schemaFor(name);
  if (!schema) {
    failures.push(`${name} — no schema mapped for fixture`);
    continue;
  }
  const result = schema.safeParse(readFixture("invalid", name));
  record(
    !result.success,
    `invalid/${name}`,
    "expected rejection, but the schema ACCEPTED it",
  );
}

console.log("\nCross-entry rules — valid fixtures must produce NO issues");
for (const name of listFixtures("valid-cross")) {
  const issues = runCross(readFixture("valid-cross", name) as CrossFixture);
  record(
    issues.length === 0,
    `valid-cross/${name}`,
    `expected no issues, got: ${issues.map((issue) => issue.code).join(", ")}`,
  );
}

console.log("\nCross-entry rules — invalid fixtures must produce issues");
for (const name of listFixtures("invalid-cross")) {
  const issues = runCross(readFixture("invalid-cross", name) as CrossFixture);
  record(
    issues.length > 0,
    `invalid-cross/${name}`,
    "expected issues, got none",
  );
}

interface TreeExpectation {
  /** Distinct issue codes the tree must produce — order-independent. */
  codes: string[];
  /** Entry files the reader must reject as unreadable. */
  problems: number;
  /** Items carrying `source.system: "sample"`. */
  samples: number;
}

const treeRegistries = (contentRoot: string): TaxonomyRegistries => {
  const slugsIn = (relative: string): string[] => {
    const file = path.join(contentRoot, relative);
    if (!existsSync(file)) return [];
    return (
      JSON.parse(readFileSync(file, "utf8")) as Array<{ slug: string }>
    ).map((row) => row.slug);
  };
  return {
    authors: slugsIn("authors.json"),
    categories: slugsIn("categories.json"),
    tags: slugsIn("tags.json"),
  };
};

console.log("\nContent trees — cross-entry rules over real entry files");
const treesDir = path.join(fixturesDir, "content-trees");
for (const entry of readdirSync(treesDir, { withFileTypes: true }).sort(
  (a, b) => a.name.localeCompare(b.name),
)) {
  if (!entry.isDirectory()) continue;
  const caseDir = path.join(treesDir, entry.name);
  const contentRoot = path.join(caseDir, "content");
  const expectation = JSON.parse(
    readFileSync(path.join(caseDir, "expected.json"), "utf8"),
  ) as TreeExpectation;

  const result = validateContentTree(contentRoot, treeRegistries(contentRoot));
  const got = [...new Set(result.issues.map((issue) => issue.code))].sort();
  const want = [...new Set(expectation.codes)].sort();
  const samples = sampleEntries(contentRoot).length;

  record(
    got.join("|") === want.join("|") &&
      result.problems.length === expectation.problems &&
      samples === expectation.samples,
    `content-trees/${entry.name}`,
    `expected [${want.join(", ")}] + ${expectation.problems} unreadable + ${expectation.samples} sample, ` +
      `got [${got.join(", ")}] + ${result.problems.length} + ${samples}`,
  );
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nContent contract FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Content contract OK\n");
