// The transform — and the rows that must NOT become entries.
//
// The rule the whole suite is about: every captured row leaves either an entry
// or an exclusion with a reason. A row that produces neither has disappeared,
// and no downstream gate can report an entity it was never shown.
import process from "node:process";

import {
  decodeEntities,
  textOf,
  toFrontMatter,
  transform,
  type CapturedRow,
} from "../transform.ts";

let passed = 0;
const failures: string[] = [];

const check = (name: string, assertion: () => void): void => {
  try {
    assertion();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (cause) {
    failures.push(`${name} — ${(cause as Error).message}`);
    console.log(`  ✗ ${name}`);
  }
};

function assert(condition: boolean, detail: string): void {
  if (!condition) throw new Error(detail);
}
function equal<T>(actual: T, expected: T, detail: string): void {
  if (actual !== expected)
    throw new Error(
      `${detail}: expected ${String(expected)}, got ${String(actual)}`,
    );
}

const CAPTURED_AT = "2026-02-01";

const row = (over: Partial<CapturedRow> = {}): CapturedRow => ({
  id: 101,
  slug: "hello-world",
  status: "publish",
  date: "2026-01-10T09:00:00",
  modified: "2026-01-12T09:00:00",
  title: { rendered: "Hello &amp; welcome" },
  content: { rendered: "<p>Body.</p>", protected: false },
  excerpt: { rendered: "<p>An excerpt.</p>" },
  author: 7,
  categories: [3],
  tags: [9],
  featured_media: 0,
  ...over,
});

const base = {
  capturedAt: CAPTURED_AT,
  categories: [{ id: 3, slug: "news", name: "News &amp; notes" }],
  tags: [{ id: 9, slug: "sample", name: "Sample" }],
  authors: [{ id: 7, slug: "jane", name: "Jane Doe" }],
  media: [
    {
      id: 55,
      sourceUrl: "https://s.example/wp-content/uploads/a.png",
      alt: "A",
    },
  ],
  locale: "en",
};

const run = (rows: CapturedRow[], kind: "post" | "page" = "post") =>
  transform({ kind, rows, ...base });

// ---------------------------------------------------------------------------
console.log("\nThe ordinary row");

check("a published post becomes an entry with resolved references", () => {
  const result = run([row()]);
  equal(result.entries.length, 1, "one entry");
  const entry = result.entries[0]!;
  equal(entry.file, "posts/hello-world.md", "file path");
  const fm = entry.frontMatter;
  equal(fm.slug, "hello-world", "slug");
  equal(fm.title, "Hello & welcome", "title is DECODED");
  equal(fm.cluster, "posts/hello-world", "cluster");
  equal(fm.updatedAt, "2026-01-12", "updatedAt from modified");
  equal(fm.publishedAt, "2026-01-10", "publishedAt from date");
  equal(fm.author, "jane", "author id resolved to a slug");
  equal((fm.categories as string[]).join(","), "news", "category id resolved");
  equal((fm.tags as string[]).join(","), "sample", "tag id resolved");
  equal(entry.body, "<p>Body.</p>", "the body is carried VERBATIM");
});

check("PROVENANCE IS THE WORDPRESS ID, NOT THE SLUG", () => {
  const fm = run([row()]).entries[0]!.frontMatter;
  const source = fm.source as Record<string, string>;
  equal(source.system, "wordpress", "system");
  equal(source.sourceId, "101", "the primary key");
  equal(source.capturedAt, CAPTURED_AT, "and when it was read");
  // A slug edit moves the file and the route; the id does not move.
  const renamed = run([row({ slug: "renamed" })]).entries[0]!;
  equal(renamed.file, "posts/renamed.md", "the file moved");
  equal(
    (renamed.frontMatter.source as Record<string, string>).sourceId,
    "101",
    "the source identity did not",
  );
});

check("a term registry resolves parents from id to slug", () => {
  const result = transform({
    kind: "post",
    rows: [],
    ...base,
    categories: [
      { id: 3, slug: "news", name: "News" },
      { id: 4, slug: "releases", parent: 3, name: "Releases" },
    ],
  });
  const releases = result.categories.find((c) => c.slug === "releases")!;
  equal(releases.parent, "news", "parent is a slug");
  equal(
    (releases.source as Record<string, string>).sourceId,
    "4",
    "and the term keeps its own id",
  );
});

check("an author registry carries nicename, which routes the archive", () => {
  const author = run([row()]).authors[0]!;
  equal(author.slug, "jane", "slug");
  equal(author.nicename, "jane", "nicename — what /author/<x>/ is keyed by");
  equal(author.name, "Jane Doe", "display name");
});

// ---------------------------------------------------------------------------
console.log("\nEvery row leaves a trace");

const traced = (rows: CapturedRow[], kind: "post" | "page" = "post") => {
  const result = run(rows, kind);
  equal(
    result.entries.length + result.excluded.length,
    rows.length,
    "every row produced an entry or an exclusion",
  );
  return result;
};

check("M1: A DRAFT IS EXCLUDED, NOT DROPPED", () => {
  const result = traced([row({ status: "draft" })]);
  equal(result.excluded[0]!.reason, "not-published", "reason");
});

check("M2: AN EMPTY BODY IS EXCLUDED WITH THE PAGE-BUILDER EXPLANATION", () => {
  const result = traced([row({ content: { rendered: "", protected: false } })]);
  equal(result.excluded[0]!.reason, "incomplete", "reason");
  assert(
    result.excluded[0]!.detail.includes("postmeta"),
    "and says where a page builder keeps its document",
  );
});

check("M3: A PASSWORD-PROTECTED BODY IS EXCLUDED BY NAME", () => {
  const result = traced([row({ content: { rendered: "", protected: true } })]);
  equal(result.excluded[0]!.reason, "password-protected", "reason");
});

check("M4: A SLUG THE MODEL CANNOT EXPRESS IS EXCLUDED, NOT MANGLED", () => {
  // The kit's slug alphabet is ASCII kebab-case; WordPress's post_name is not.
  // Transliterating would invent a URL the source never served.
  const result = traced([
    row({ slug: "%d0%bf%d1%80%d0%b8%d0%b2%d0%b5%d1%82" }),
  ]);
  equal(result.excluded[0]!.reason, "unrepresentable-slug", "reason");
  assert(
    result.excluded[0]!.detail.includes("stranger-site-boundaries"),
    "pointing at the documented boundary",
  );
});

check("M5: AN UNRESOLVABLE AUTHOR IS EXCLUDED, NOT INVENTED", () => {
  const result = traced([row({ author: 999 })]);
  equal(result.excluded[0]!.reason, "incomplete", "reason");
  assert(
    result.excluded[0]!.detail.includes("_embed"),
    "and names the fallback that usually resolves it",
  );
});

check("M6: A POST WHOSE CATEGORIES ALL RESOLVE TO NOTHING IS EXCLUDED", () => {
  // WordPress gives every post a category. None resolving means the registry
  // is short, not that the post has none — so this is a broken reference.
  const result = traced([row({ categories: [404] })]);
  equal(result.excluded[0]!.reason, "incomplete", "reason");
});

check("M7: A ROW WITH NO DATE IS EXCLUDED", () => {
  const result = traced([row({ date: undefined, modified: undefined })]);
  equal(result.excluded[0]!.reason, "incomplete", "reason");
});

check("a page with an unknown parent keeps no parent, and says so", () => {
  const result = transform({
    kind: "page",
    rows: [
      {
        ...row({ id: 5, slug: "child", parent: 999 }),
        categories: [],
        tags: [],
      },
    ],
    ...base,
  });
  equal(result.entries.length, 1, "the page still migrates");
  assert(result.entries[0]!.frontMatter.parent === undefined, "with no parent");
  assert(
    result.issues.some((i) => i.code === "page-parent-unknown"),
    "and an issue naming it",
  );
});

check("a page does not carry post-only fields", () => {
  const fm = transform({
    kind: "page",
    rows: [row({ id: 5, slug: "about" })],
    ...base,
  }).entries[0]!.frontMatter;
  assert(fm.categories === undefined, "no categories");
  assert(fm.author === undefined, "no author");
  assert(fm.publishedAt === undefined, "no publishedAt");
});

// ---------------------------------------------------------------------------
console.log("\nText handling");

check("entities are decoded; the body never is", () => {
  equal(decodeEntities("A &amp; B &#8217;s"), "A & B ’s", "decode");
  equal(textOf("<p>Hi <b>there</b>&nbsp;you</p>"), "Hi there you", "textOf");
  // The body is HTML the site renders. Decoding it would change the markup.
  const entry = run([
    row({ content: { rendered: "<p>a &amp; b</p>", protected: false } }),
  ]).entries[0]!;
  equal(entry.body, "<p>a &amp; b</p>", "body untouched");
});

check("front matter quotes what YAML would misread", () => {
  const yaml = toFrontMatter({
    slug: "x",
    title: "Yes: really — 100%",
    updatedAt: "2026-01-01",
    tags: ["a", "b"],
    source: { system: "wordpress", sourceId: "1" },
  });
  assert(yaml.includes('title: "Yes: really — 100%"'), `quoted: ${yaml}`);
  assert(yaml.includes('updatedAt: "2026-01-01"'), "a date is quoted");
  assert(yaml.includes("  - a"), "arrays are sequences");
  assert(yaml.includes("  system: wordpress"), "nested maps are indented");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nTransform suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Transform suite OK\n");
