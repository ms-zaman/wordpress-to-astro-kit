// Reading the metadata a source page publishes about itself.
//
// The defect this covers, measured by comparing a migrated site against its
// source: all 33 published entries had a hand-written `<meta name="description">`
// and the migration had lost every one, because SEO plugins keep them in
// postmeta and do not expose them over REST — `?_fields=meta` returned
// `{"footnotes":""}` on a site running Rank Math.
import process from "node:process";

import { decodeEntities, readSourceHead } from "../head.ts";

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

const page = (head: string, body = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

console.log("\nWhat a source page says about itself");

check("title, description, canonical and og:image are read", () => {
  const found = readSourceHead(
    page(
      `<title>Is FAQ Schema Essential? - Storeware</title>` +
        `<meta name="description" content="Discover why FAQ schema matters."/>` +
        `<link rel="canonical" href="https://s.example/x/"/>` +
        `<meta property="og:image" content="https://s.example/a.jpg"/>`,
    ),
  );
  equal(found.title, "Is FAQ Schema Essential? - Storeware", "title");
  equal(found.description, "Discover why FAQ schema matters.", "description");
  equal(found.canonical, "https://s.example/x/", "canonical");
  equal(found.ogImage, "https://s.example/a.jpg", "og:image");
});

check("ATTRIBUTE ORDER DOES NOT MATTER", () => {
  // Plugins and WordPress versions emit these both ways round, and a pattern
  // that assumed one order would read a site correctly and the next site not
  // at all.
  const found = readSourceHead(
    page(
      `<meta content="Content first." name="description">` +
        `<meta content="https://s.example/b.png" property="og:image">` +
        `<link href="https://s.example/y/" rel="canonical">`,
    ),
  );
  equal(found.description, "Content first.", "description");
  equal(found.ogImage, "https://s.example/b.png", "og:image");
  equal(found.canonical, "https://s.example/y/", "canonical");
});

check("ENTITIES ARE DECODED, BECAUSE A DESCRIPTION IS TEXT", () => {
  const found = readSourceHead(
    page(
      `<meta name="description" content="Schema &amp; AEO &#8211; why it&#039;s useful"/>`,
    ),
  );
  equal(found.description, "Schema & AEO – why it's useful", "decoded");
  equal(decodeEntities("&lt;b&gt;"), "<b>", "decodeEntities");
});

check("ONLY THE HEAD IS READ", () => {
  // A `<meta>` in the body is not this page's own metadata, and migrated
  // WordPress bodies do carry markup that looks like one.
  const found = readSourceHead(
    page(
      `<meta name="description" content="The real one."/>`,
      `<meta name="description" content="NOT THIS ONE">`,
    ),
  );
  equal(found.description, "The real one.", "the head's");
});

check("WORDPRESS'S DEFAULT ROBOTS IS NOT AN OVERRIDE", () => {
  // `index, follow` is what every page says unless somebody changed it.
  // Recording it would put a row in the override table for every page, saying
  // nothing, and a table of nothing is one nobody reads.
  const ordinary = readSourceHead(
    page(`<meta name="robots" content="index, follow, max-snippet:-1"/>`),
  );
  assert(ordinary.robots === undefined, "no robots row");

  const hidden = readSourceHead(
    page(`<meta name="robots" content="follow, noindex"/>`),
  );
  equal(hidden.robots?.noindex, true, "noindex is recorded");
  equal(hidden.robots?.nofollow, false, "and nofollow is not invented");
});

check(
  "og:description is the fallback, and twitter:image after og:image",
  () => {
    const found = readSourceHead(
      page(
        `<meta property="og:description" content="Only the open-graph one."/>` +
          `<meta name="twitter:image" content="https://s.example/t.png"/>`,
      ),
    );
    equal(found.description, "Only the open-graph one.", "description");
    equal(found.ogImage, "https://s.example/t.png", "image");
  },
);

check("A PAGE THAT SAYS NOTHING YIELDS NOTHING", () => {
  // The route then keeps the title and description the kit derives, which is
  // the correct outcome — not a gap to fill with a guess.
  const found = readSourceHead(page(`<meta charset="utf-8">`));
  equal(Object.keys(found).length, 0, "no fields");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nSEO capture suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("SEO capture suite OK\n");
