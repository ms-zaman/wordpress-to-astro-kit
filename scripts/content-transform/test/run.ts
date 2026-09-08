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
  // Still the rule — but "cannot express" now means what it says. A slug with
  // a space in it is not a URL segment WordPress would have stored, and
  // transliterating would invent a URL the source never served.
  const result = traced([row({ slug: "hello world" })]);
  equal(result.excluded[0]!.reason, "unrepresentable-slug", "reason");
  assert(
    result.excluded[0]!.detail.includes("outside-alphabet"),
    "naming which refusal it was",
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
console.log("\nNon-Latin identity: what WordPress actually stores");

// WordPress percent-encodes a non-ASCII slug on the way into the database —
// `sanitize_title_with_dashes()` calls `utf8_uri_encode()` — so these are the
// spellings REST really serves. Every value below was copied from a live
// capture of ja.wordpress.org and ru.wordpress.org.

check("U1: A PERCENT-ENCODED CJK SLUG BECOMES AN ENTRY, DECODED", () => {
  const result = run([row({ slug: "%e7%bf%bb%e8%a8%b3" })]);
  equal(result.excluded.length, 0, "nothing excluded");
  equal(result.entries.length, 1, "one entry");
  equal(result.entries[0]!.frontMatter.slug, "翻訳", "slug is decoded");
  equal(result.entries[0]!.file, "posts/翻訳.md", "and so is the file name");
  equal(result.entries[0]!.frontMatter.cluster, "posts/翻訳", "cluster too");
});

check("U2: THE DECODE IS REPORTED, NOT PERFORMED QUIETLY", () => {
  const result = run([row({ slug: "%e7%bf%bb%e8%a8%b3" })]);
  const decoded = result.decodedSlugs.find((one) => one.slug === "翻訳");
  assert(decoded !== undefined, "the decode is on the record");
  equal(decoded!.raw, "%e7%bf%bb%e8%a8%b3", "with the source spelling");
});

check("U3: a mixed-script slug keeps both scripts", () => {
  // ja.wordpress.org post 7333: "wordpress-6-6-ベータ-1".
  const result = run([
    row({ slug: "wordpress-6-6-%e3%83%99%e3%83%bc%e3%82%bf-1" }),
  ]);
  equal(
    result.entries[0]!.frontMatter.slug,
    "wordpress-6-6-ベータ-1",
    "Latin, digits and katakana in one slug",
  );
});

check("U4: THE PROLONGED SOUND MARK IS A LETTER", () => {
  // ー (U+30FC) is \p{Lm}, not \p{Lo}. A slug alphabet that forgets it
  // rejects most katakana slugs there are, including U3's.
  const result = run([row({ slug: "%e3%83%a2%e3%83%90%e3%82%a4%e3%83%ab" })]);
  equal(result.entries[0]!.frontMatter.slug, "モバイル", "モバイル");
  const withMark = run([row({ slug: "%e3%83%99%e3%83%bc%e3%82%bf" })]);
  equal(withMark.entries[0]!.frontMatter.slug, "ベータ", "ベータ");
});

check("U5: a Cyrillic slug is lower case and passes", () => {
  // ru.wordpress.org category 3290.
  const result = run([
    row({
      slug: "%d0%be%d0%b1%d1%80%d0%b0%d0%b7%d0%be%d0%b2%d0%b0%d0%bd%d0%b8%d0%b5",
    }),
  ]);
  equal(result.entries[0]!.frontMatter.slug, "образование", "образование");
});

check("U6: a Bengali slug with matras survives", () => {
  // দাম is 3 code points, one of which is a combining mark.
  const result = run([row({ slug: "%e0%a6%a6%e0%a6%be%e0%a6%ae" })]);
  equal(result.entries[0]!.frontMatter.slug, "দাম", "দাম");
});

check("U7: AN UPPERCASE SLUG IS STILL REFUSED, IN ANY SCRIPT", () => {
  // WordPress lower-cases with mb_strtolower before storing, so this did not
  // come from its sanitiser — and the case mapping is locale-dependent.
  for (const slug of ["Hello-World", "Образование"]) {
    const result = run([row({ slug })]);
    equal(result.excluded.length, 1, `${slug} excluded`);
    equal(result.excluded[0]!.reason, "unrepresentable-slug", `${slug} reason`);
  }
});

check("U8: A MALFORMED ESCAPE IS NAMED, NOT THROWN", () => {
  // ja.wordpress.org publishes a body containing href="%s" — an unfilled
  // printf template. decodeURIComponent throws URIError on it.
  const result = run([row({ slug: "%s" })]);
  equal(result.entries.length, 0, "no entry");
  assert(
    result.excluded[0]!.detail.includes("malformed-escape"),
    "named as a malformed escape",
  );
});

check("U9: A SLUG THAT IS NOT NFC IS REFUSED, NEVER NORMALISED", () => {
  // Measured on macOS (APFS): a file written under an NFD name is found under
  // its NFC spelling. On Linux they are two files. A content tree holding both
  // is one entry on a laptop and two in CI, and nothing reports it.
  const nfd = "가나".normalize("NFD");
  assert(nfd !== "가나".normalize("NFC"), "the fixture really is decomposed");
  const result = run([row({ slug: nfd })]);
  equal(result.entries.length, 0, "no entry");
  assert(result.excluded[0]!.detail.includes("not-nfc"), "named as not-NFC");
});

check(
  "U10: A REFUSED TERM IS RECORDED, AND SO IS EVERY POST THAT NAMED IT",
  () => {
    // The defect this replaces: `if (!SLUG.test(term.slug)) continue`. Seven
    // tags left ja.wordpress.org's registry without a record, and nine posts
    // kept referring to them.
    const result = transform({
      kind: "post",
      rows: [row({ tags: [9, 12] })],
      ...base,
      tags: [
        { id: 9, slug: "sample", name: "Sample" },
        { id: 12, slug: "Not A Slug", name: "Refused" },
      ],
    });
    const refused = result.registryExcluded.find((one) => one.id === 12);
    assert(refused !== undefined, "the term is on the record");
    equal(refused!.kind, "tags", "as a tag");
    equal(refused!.reason, "unrepresentable-slug", "with the reason");

    equal(result.entries.length, 1, "the post still becomes an entry");
    equal(
      (result.entries[0]!.frontMatter.tags as string[]).length,
      1,
      "carrying only the tag that exists",
    );
    assert(
      result.issues.some((one) => one.message.includes("tag 12")),
      "and the dropped membership is an issue, not a silence",
    );
  },
);

check("U11: a term registry keeps a decoded parent", () => {
  const result = transform({
    kind: "post",
    rows: [row({ categories: [3] })],
    ...base,
    categories: [
      { id: 3, slug: "news", name: "News", parent: 4 },
      { id: 4, slug: "%e7%bf%bb%e8%a8%b3", name: "翻訳" },
    ],
  });
  const child = result.categories.find((one) => one.slug === "news");
  equal(child!.parent, "翻訳", "the parent resolves to its decoded slug");
});

check("U12: AN AUTHOR WITH A REFUSED SLUG EXCLUDES THE POST BY NAME", () => {
  const result = transform({
    kind: "post",
    rows: [row({ author: 8 })],
    ...base,
    authors: [{ id: 8, slug: "Jane Doe", name: "Jane" }],
  });
  equal(result.entries.length, 0, "no entry");
  assert(
    result.excluded[0]!.detail.includes("slug cannot be"),
    "the reason is the author's slug, not a missing author",
  );
  assert(
    result.registryExcluded.some((one) => one.kind === "authors"),
    "and the author is on the record too",
  );
});

check(
  "U13: TWO PAGES WITH ONE SLUG — THE SECOND IS EXCLUDED, NOT WRITTEN OVER",
  () => {
    // WordPress makes a page slug unique among its SIBLINGS. ja.wordpress.org
    // publishes /security/ and /about/security/, and four such pairs in all.
    const result = transform({
      kind: "page",
      rows: [
        row({
          id: 3680,
          slug: "security",
          link: "https://s.example/security/",
        }),
        row({
          id: 4837,
          slug: "security",
          parent: 4826,
          link: "https://s.example/about/security/",
        }),
      ],
      ...base,
    });
    equal(result.entries.length, 1, "one entry, not two files with one name");
    equal(result.excluded.length, 1, "and one exclusion");
    equal(result.excluded[0]!.reason, "duplicate-slug", "reason");
    assert(
      result.excluded[0]!.detail.includes("3680") &&
        result.excluded[0]!.detail.includes("4837"),
      "naming BOTH source rows, so the pair can be found on the source site",
    );
  },
);

check("U14: a row excluded earlier never claims its slug", () => {
  // A draft named `about` must not make the published `about` look like a
  // collision. The claim is registered last, after every other check.
  const result = transform({
    kind: "page",
    rows: [
      row({ id: 1, slug: "about", status: "draft" }),
      row({ id: 2, slug: "about" }),
    ],
    ...base,
  });
  equal(result.entries.length, 1, "the published row becomes an entry");
  equal(result.excluded[0]!.reason, "not-published", "the draft's own reason");
  assert(
    !result.excluded.some((one) => one.reason === "duplicate-slug"),
    "and nothing is called a collision",
  );
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

check("A STRING YAML WOULD COERCE IS QUOTED", () => {
  // Found by a real migration: `sourceId: "1250"` went out unquoted, YAML read
  // it back as a number, and the content model refused the entry — correctly,
  // because a WordPress id is an identifier, not a quantity.
  const yaml = toFrontMatter({
    source: { sourceId: "1250" },
    slug: "no",
    a: "true",
    b: "0755",
    c: "12:30",
    d: "2026-01-01T00:00:00",
  });
  assert(yaml.includes('sourceId: "1250"'), `a numeric id: ${yaml}`);
  assert(yaml.includes('slug: "no"'), "a slug YAML reads as false");
  assert(yaml.includes('a: "true"'), "a boolean-looking string");
  assert(yaml.includes('b: "0755"'), "an octal-looking string");
  assert(yaml.includes('c: "12:30"'), "a sexagesimal-looking string");
  assert(yaml.includes('d: "2026-01-01T00:00:00"'), "a timestamp");
  // And an ordinary word is still plain, so the files stay readable.
  assert(
    toFrontMatter({ slug: "hello-world" }).includes("slug: hello-world"),
    "plain",
  );
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nTransform suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Transform suite OK\n");
