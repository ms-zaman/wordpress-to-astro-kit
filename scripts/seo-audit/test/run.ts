// The SEO audit's own suite.
//
// Two halves, the same shape as the accessibility audit's.
//
// UNIT half: the head model and the readers, over literal inputs. This is
// where BOTH halves of the origin-dependent rules are exercised — whichever
// half is not the project's current state would never execute in a real run
// and would rot unnoticed until a domain landed.
//
// MUTATION half: a small, internally consistent synthetic build in a temporary
// directory, proved to pass, then broken in exactly one way per case and
// proved to fail AND to name the thing that broke.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  META_DESCRIPTION_MAX,
  META_DESCRIPTION_MIN,
  TITLE_MAX,
  canonicalUrl,
  ogLocale,
  socialTags,
} from "../../../apps/website/src/rendering/head-model.ts";
import {
  SITE_NAME,
  absoluteUrl,
} from "../../../apps/website/src/rendering/site-identity.ts";
import { auditSeo } from "../audit.ts";
import { bySeverity, sortFindings, type Finding } from "../finding.ts";
import {
  canonicalsOf,
  checkCanonical,
  checkTitle,
  decodeAttribute,
  headOf,
  metaTags,
  pagePath,
  structuredDataOf,
  titleOf,
} from "../rules.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (cause) {
    failures.push(`${name} — ${(cause as Error).message}`);
    console.log(`  ✗ ${name}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected)
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}

const ORIGIN = "https://example.test";

const headInput = (overrides: Record<string, unknown> = {}) => ({
  title: "A page title",
  description: "A description of the page, long enough to be a real one.",
  locale: "en-US",
  pathname: "/some/page",
  ...overrides,
});

/**
 * The same input, stating that there is NO origin.
 *
 * "No origin" has to be something an input SAYS rather than something it gets
 * by omission, because a default parameter hands an explicit `undefined`
 * straight back to the default. Every case below that tests the pre-origin
 * contract says it — otherwise those branches stop running on the day they
 * start mattering.
 */
const noOrigin = (overrides: Record<string, unknown> = {}) =>
  headInput({ ...overrides, origin: undefined });

const tagValue = (
  tags: readonly { key: string; content: string }[],
  key: string,
) => tags.find((tag) => tag.key === key)?.content;

// ---------------------------------------------------------------------------
console.log("\nThe origin seam");

check("a relative path cannot become absolute without an origin", () => {
  equal(absoluteUrl("/a", undefined), undefined, "no origin");
  equal(absoluteUrl("/a", ORIGIN), `${ORIGIN}/a`, "with origin");
  equal(absoluteUrl("a", ORIGIN), `${ORIGIN}/a`, "missing leading slash");
  equal(absoluteUrl("/a", `${ORIGIN}/`), `${ORIGIN}/a`, "trailing slash");
});

check("a value that is already absolute is never rewritten", () => {
  equal(
    absoluteUrl("https://cdn.example/x.png", ORIGIN),
    "https://cdn.example/x.png",
    "https",
  );
  equal(
    absoluteUrl("//cdn.example/x.png", undefined),
    "//cdn.example/x.png",
    "protocol-relative",
  );
});

// ---------------------------------------------------------------------------
console.log("\nThe head model");

check(
  "og:locale is the underscored form, and a bare language passes through",
  () => {
    equal(ogLocale("en-US"), "en_US", "region");
    equal(ogLocale("pt-br"), "pt_BR", "lowercase region");
    equal(ogLocale("en"), "en", "no region");
  },
);

check("the unconditional social tags are emitted with no origin", () => {
  const tags = socialTags(headInput());
  for (const key of [
    "og:title",
    "og:type",
    "og:site_name",
    "og:locale",
    "og:description",
    "twitter:card",
    "twitter:title",
  ])
    assert(tagValue(tags, key) !== undefined, `${key} is missing`);
  equal(tagValue(tags, "og:site_name"), SITE_NAME, "site name");
  equal(tagValue(tags, "og:type"), "website", "default type");
});

check("og:url waits for an origin, and arrives with one", () => {
  equal(tagValue(socialTags(noOrigin()), "og:url"), undefined, "no origin");
  equal(
    tagValue(socialTags(headInput({ origin: ORIGIN })), "og:url"),
    `${ORIGIN}/some/page`,
    "with origin",
  );
});

check(
  "a relative og:image waits for an origin; an absolute one does not",
  () => {
    const relative = { url: "/media/card.png", alt: "Card" };
    equal(
      tagValue(socialTags(noOrigin({ ogImage: relative })), "og:image"),
      undefined,
      "relative, no origin",
    );
    equal(
      tagValue(
        socialTags(headInput({ ogImage: relative, origin: ORIGIN })),
        "og:image",
      ),
      `${ORIGIN}/media/card.png`,
      "relative, with origin",
    );
    equal(
      tagValue(
        socialTags(noOrigin({ ogImage: { url: "https://cdn.example/c.png" } })),
        "og:image",
      ),
      "https://cdn.example/c.png",
      "absolute, no origin",
    );
  },
);

check("the card type follows the image rather than being fixed", () => {
  equal(
    tagValue(socialTags(headInput()), "twitter:card"),
    "summary",
    "no image",
  );
  equal(
    tagValue(
      socialTags(headInput({ ogImage: { url: "https://cdn.example/c.png" } })),
      "twitter:card",
    ),
    "summary_large_image",
    "with image",
  );
});

check("a page with no description emits no description tags", () => {
  const tags = socialTags(headInput({ description: undefined }));
  equal(tagValue(tags, "og:description"), undefined, "og:description");
  equal(
    tagValue(tags, "twitter:description"),
    undefined,
    "twitter:description",
  );
  assert(tagValue(tags, "og:title") !== undefined, "og:title still emitted");
});

check("the tag order is stable, so two builds diff cleanly", () => {
  const first = socialTags(headInput({ origin: ORIGIN })).map((tag) => tag.key);
  const second = socialTags(headInput({ origin: ORIGIN })).map(
    (tag) => tag.key,
  );
  equal(first.join(","), second.join(","), "order");
});

// ---------------------------------------------------------------------------
console.log("\nCanonicals — both directions of the origin rule");

check("no canonical is emitted while no origin is decided", () => {
  equal(canonicalUrl(noOrigin()), undefined, "self-referencing");
  equal(
    canonicalUrl(noOrigin({ canonical: "https://example.com/elsewhere" })),
    undefined,
    "an absolute row value is NOT passed through",
  );
});

check("with an origin, a canonical is emitted and row values win", () => {
  equal(
    canonicalUrl(headInput({ origin: ORIGIN })),
    `${ORIGIN}/some/page`,
    "self",
  );
  equal(
    canonicalUrl(headInput({ origin: ORIGIN, canonical: "/other" })),
    `${ORIGIN}/other`,
    "relative row value",
  );
});

check("WITH AN ORIGIN: a canonical on somebody else's host is reported", () => {
  // The clause that is easy to omit. `https://example.com/x` is absolute, so a
  // rule that only checked absoluteness passed a real instruction to crawlers
  // to index a domain nobody owns.
  const page = (canonical: string) => ({
    file: "index.html",
    html: `<head><link rel="canonical" href="${canonical}"></head>`,
    css: "",
  });
  equal(
    checkCanonical([page(`${ORIGIN}/`)], ORIGIN).length,
    0,
    "our own origin",
  );
  const foreign = checkCanonical([page("https://example.com/")], ORIGIN);
  equal(foreign.length, 1, "a foreign canonical");
  assert(foreign[0]!.id.includes("foreign"), foreign[0]!.detail);
});

// ---------------------------------------------------------------------------
console.log("\nThe readers");

check("the head reader stops at </head>", () => {
  const html =
    '<head><meta name="a" content="1"></head><body><meta name="b" content="2"></body>';
  assert(metaTags(html).has("a"), "head tag read");
  assert(!metaTags(html).has("b"), "a body tag is not a head tag");
  equal(headOf("<html>no head close"), "", "no </head> means no head");
});

check("attribute entities are decoded before anything is measured", () => {
  equal(decodeAttribute("it&#39;s &amp; more"), "it's & more", "decode");
  const html = '<head><meta name="description" content="it&#39;s here"></head>';
  equal(
    metaTags(html).get("description"),
    "it's here",
    "length is measured on the decoded text",
  );
});

check("the title reader trims and handles absence", () => {
  equal(titleOf("<head><title>  Spaced  </title></head>"), "Spaced", "trimmed");
  equal(titleOf("<head></head>"), undefined, "absent");
});

check("canonical and ld+json readers find every occurrence", () => {
  const html =
    '<head><link rel="canonical" href="https://a.test/1"><link rel="canonical" href="https://a.test/2"></head>' +
    '<body><script type="application/ld+json">{"a":1}</script></body>';
  equal(canonicalsOf(html).length, 2, "two canonicals");
  equal(structuredDataOf(html).length, 1, "one block");
});

check("a dist file resolves to the path it was built for", () => {
  equal(pagePath("index.html"), "/", "root");
  equal(pagePath("404.html"), "/404", "the not-found page");
  equal(pagePath("blog/hello/index.html"), "/blog/hello", "nested");
});

// ---------------------------------------------------------------------------
console.log(
  "\nThe title budget — yours is an error, the content's is a warning",
);

const longTitle = "x".repeat(TITLE_MAX + 1);
const titlePage = (file: string) => ({
  file,
  html: `<head><title>${longTitle}</title></head>`,
  css: "",
});

check("an over-budget title on a static route is an ERROR", () => {
  // `/`, `/404` and `/search` are titled by a template in this repository, so
  // the budget is a rule you can simply follow.
  const found = checkTitle(
    [titlePage("index.html")],
    new Map([["index.html", "static"]]),
  );
  equal(found.length, 1, "findings");
  equal(found[0]!.severity, "error", "severity");
});

check("an over-budget title on a CONTENT route is a warning", () => {
  // In the project this kit came from, 175 of 278 titles carried from the live
  // site were over this budget. They are the articles' search identity, and
  // shortening one is an editorial act — a decision to record, not a gate to
  // satisfy.
  const found = checkTitle(
    [titlePage("blog/a-post/index.html")],
    new Map([["blog/a-post/index.html", "post"]]),
  );
  equal(found.length, 1, "findings");
  equal(found[0]!.severity, "warning", "severity");
  assert(found[0]!.detail.includes("editorial decision"), found[0]!.detail);
});

check("with no manifest every page is treated as yours", () => {
  // The strict direction, and what an arbitrary directory gets.
  const found = checkTitle([titlePage("blog/a-post/index.html")]);
  equal(found[0]!.severity, "error", "severity");
});

check("two pages sharing a title is an error whatever generated them", () => {
  // The duplicate rule has teeth on every route: two pages with one title are
  // two pages a search engine has to choose between.
  const found = checkTitle(
    [titlePage("blog/a/index.html"), titlePage("blog/b/index.html")],
    new Map([
      ["blog/a/index.html", "post"],
      ["blog/b/index.html", "post"],
    ]),
  );
  const duplicate = found.find((finding) => finding.id.includes("duplicate:"));
  assert(duplicate !== undefined, "expected a duplicate finding");
  equal(duplicate!.severity, "error", "severity");
});

// ---------------------------------------------------------------------------
console.log("\nThe synthetic build — mutation cases against a real directory");

const created: string[] = [];

/**
 * One synthetic page.
 *
 * It carries a canonical on `ORIGIN` because the fixture models a project that
 * has decided its origin. `null` means "no canonical", NOT `undefined`: a
 * default parameter treats an explicit `undefined` as absent and hands back
 * the default, which is the same trap `checkCanonical` documents.
 */
const page = (
  title: string,
  description: string,
  extras = "",
  canonical: string | null = `${ORIGIN}/`,
): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
  (canonical === null ? "" : `<link rel="canonical" href="${canonical}">`) +
  `<meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<meta name="description" content="${description}">` +
  `<meta property="og:title" content="${title}">` +
  `<meta property="og:type" content="website">` +
  `<meta property="og:site_name" content="Synthetic">` +
  `<meta property="og:locale" content="en">` +
  `<meta property="og:description" content="${description}">` +
  `<meta name="twitter:card" content="summary">` +
  `<meta name="twitter:title" content="${title}">` +
  `<meta name="robots" content="noindex">` +
  `${extras}<title>${title}</title></head>` +
  `<body><main id="main"><h1>${title}</h1></main></body></html>`;

const HOME_DESCRIPTION =
  "The home page of a synthetic build, described in enough words to clear the floor.";
const BLOG_DESCRIPTION =
  "A blog listing in a synthetic build, described in enough words to clear the floor.";
const BLOG_EXTRAS =
  '<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"A post"}</script>';

function writeSyntheticBuild(): string {
  const root = mkdtempSync(path.join(tmpdir(), "seo-audit-"));
  created.push(root);
  mkdirSync(path.join(root, "blog"), { recursive: true });
  writeFileSync(
    path.join(root, "index.html"),
    page("Synthetic home", HOME_DESCRIPTION),
  );
  writeFileSync(
    path.join(root, "blog/index.html"),
    page("Synthetic blog", BLOG_DESCRIPTION, BLOG_EXTRAS, `${ORIGIN}/blog/`),
  );
  return root;
}

const errorsSay = (
  result: { findings: readonly Finding[] },
  text: string,
): boolean =>
  bySeverity(result.findings, "error").some(
    (finding) => finding.detail.includes(text) || finding.id.includes(text),
  );

/** Apply one mutation to a fresh build and audit it. */
function mutate(
  file: string,
  edit: (html: string) => string,
  // `null` means "audit with no origin". Not `undefined` — a default parameter
  // hands an explicit `undefined` straight back to the default.
  origin: string | null = ORIGIN,
) {
  const root = writeSyntheticBuild();
  const original =
    file === "index.html"
      ? page("Synthetic home", HOME_DESCRIPTION)
      : page(
          "Synthetic blog",
          BLOG_DESCRIPTION,
          BLOG_EXTRAS,
          `${ORIGIN}/blog/`,
        );
  writeFileSync(path.join(root, file), edit(original));
  return auditSeo(root, { origin: origin ?? undefined });
}

check("the unmutated synthetic build passes", () => {
  const result = auditSeo(writeSyntheticBuild(), { origin: ORIGIN });
  const errors = bySeverity(result.findings, "error");
  equal(errors.length, 0, `errors: ${errors.map((f) => f.id).join(", ")}`);
  equal(result.counts.pages, 2, "pages");
  equal(result.counts.structuredDataBlocks, 1, "ld+json blocks");
});

check("MUTATION: a missing title fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace(/<title>.*?<\/title>/, ""),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "no <title>"), "names the defect");
});

check("MUTATION: two pages sharing a title fails the audit", () => {
  const result = mutate("blog/index.html", (html) =>
    html.replace(/Synthetic blog/g, "Synthetic home"),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "share the title"), "names the collision");
});

check("MUTATION: a missing description fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace(/<meta name="description"[^>]*>/, ""),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, 'no <meta name="description">'), "names the defect");
});

check("MUTATION: a description over and under budget both fail", () => {
  const long = mutate("index.html", (html) =>
    html.replace(HOME_DESCRIPTION, "y".repeat(META_DESCRIPTION_MAX + 1)),
  );
  assert(errorsSay(long, "will cut it"), "too long");
  const short = mutate("index.html", (html) =>
    html.replace(HOME_DESCRIPTION, "y".repeat(META_DESCRIPTION_MIN - 1)),
  );
  assert(errorsSay(short, "write its own snippet"), "too short");
});

check("MUTATION: a description that is the title again fails", () => {
  const result = mutate("index.html", (html) =>
    html.replace(new RegExp(HOME_DESCRIPTION, "g"), "Synthetic home"),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "the title again"), "names the defect");
});

check("MUTATION: two pages sharing a description fails the audit", () => {
  const result = mutate("blog/index.html", (html) =>
    html.replace(new RegExp(BLOG_DESCRIPTION, "g"), HOME_DESCRIPTION),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "share one description"), "names the collision");
});

check("MUTATION: a missing social tag fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace(/<meta property="og:type"[^>]*>/, ""),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "no og:type"), "names the tag");
});

check("MUTATION: og:title drifting from <title> fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace(
      '<meta property="og:title" content="Synthetic home">',
      '<meta property="og:title" content="Something else">',
    ),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "og:title and <title> disagree"), "names the drift");
});

check("MUTATION: og:description drifting from the description fails", () => {
  const result = mutate("index.html", (html) =>
    html.replace(
      `<meta property="og:description" content="${HOME_DESCRIPTION}">`,
      '<meta property="og:description" content="A different description entirely, long enough to pass the floor.">',
    ),
  );
  equal(result.ok, false, "ok");
  assert(
    errorsSay(result, "og:description and the meta description disagree"),
    "names the drift",
  );
});

check("MUTATION: a large-image card with no image fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace('content="summary"', 'content="summary_large_image"'),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "carries no og:image"), "names the defect");
});

check("MUTATION: a relative og:url fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace(
      "<title>",
      '<meta property="og:url" content="/index.html"><title>',
    ),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "must be an absolute URL"), "names the defect");
});

check("MUTATION: a canonical emitted with NO origin fails the audit", () => {
  // The pre-origin contract, which no longer arrives by omission. Replaces the
  // fixture's canonical rather than adding one: a second would trip the
  // `multiple` rule first and never reach the rule under test.
  const result = mutate(
    "index.html",
    (html) =>
      html.replace(
        /<link rel="canonical"[^>]*>/,
        '<link rel="canonical" href="https://example.com/">',
      ),
    null,
  );
  equal(result.ok, false, "ok");
  assert(
    errorsSay(result, "no production origin has been decided"),
    "the reason",
  );
});

check("MUTATION: two canonicals on one page fails, with an origin", () => {
  const result = mutate("index.html", (html) =>
    html.replace(
      "<title>",
      `<link rel="canonical" href="${ORIGIN}/"><link rel="canonical" href="${ORIGIN}/x"><title>`,
    ),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "canonical links on one page"), "names the defect");
});

check("WITH AN ORIGIN: every production page must carry a canonical", () => {
  const bare = writeSyntheticBuild();
  writeFileSync(
    path.join(bare, "index.html"),
    page("Synthetic home", HOME_DESCRIPTION, "", null),
  );
  writeFileSync(
    path.join(bare, "blog/index.html"),
    page("Synthetic blog", BLOG_DESCRIPTION, "", null),
  );
  const result = auditSeo(bare, { origin: ORIGIN });
  equal(
    result.ok,
    false,
    "a build with no canonicals fails once an origin exists",
  );
  assert(errorsSay(result, "emits no canonical"), "names the defect");
});

check("WITH AN ORIGIN: a relative canonical fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace(
      /<link rel="canonical"[^>]*>/,
      '<link rel="canonical" href="/">',
    ),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "a canonical must be absolute"), "names the defect");
});

check("MUTATION: a page that stops being noindex fails a preview build", () => {
  const result = mutate("index.html", (html) =>
    html.replace(
      '<meta name="robots" content="noindex">',
      '<meta name="robots" content="index,follow">',
    ),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, 'expects "noindex"'), "names the rule");
});

check(
  "A PRODUCTION BUILD EXPECTS THE OPPOSITE, and that half is tested too",
  () => {
    // The other side of the launch switch. A preview-shaped assertion run
    // against a production build would pass every page for the wrong reason.
    const root = writeSyntheticBuild();
    const result = auditSeo(root, {
      origin: ORIGIN,
      environment: "production",
    });
    assert(
      result.findings.some((finding) => finding.check === "robots"),
      "a noindex page in a production build is reported",
    );
  },
);

check("MUTATION: malformed structured data fails the audit", () => {
  const result = mutate("blog/index.html", (html) =>
    html.replace('"headline":"A post"}', '"headline":"A post"'),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "not valid JSON"), "names the defect");
});

check(
  "MUTATION: structured data with the wrong context or no type fails",
  () => {
    const context = mutate("blog/index.html", (html) =>
      html.replace('"https://schema.org"', '"http://schema.org"'),
    );
    assert(errorsSay(context, "rather than"), "context");
    const type = mutate("blog/index.html", (html) =>
      html.replace('"@type":"BlogPosting",', ""),
    );
    assert(errorsSay(type, "carries no @type"), "type");
  },
);

check("a @graph of typed nodes is a typed block", () => {
  // The other correct way a block says what it is, and the shape every
  // WordPress SEO plugin emits. A rule that knew only the first form reported
  // it as typeless.
  const result = mutate("blog/index.html", (html) =>
    html.replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      '<script type="application/ld+json">' +
        JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "Organization", name: "Synthetic" },
            { "@type": "WebSite", name: "Synthetic" },
          ],
        }) +
        "</script>",
    ),
  );
  assert(!errorsSay(result, "carries no @type"), "a typed graph is typed");
});

check("MUTATION: a @graph whose nodes are untyped still fails", () => {
  const result = mutate("blog/index.html", (html) =>
    html.replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      '<script type="application/ld+json">' +
        JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [{ name: "Synthetic" }],
        }) +
        "</script>",
    ),
  );
  assert(errorsSay(result, "carries no @type"), "an untyped node is untyped");
});

check("MUTATION: a document losing its lang attribute fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace('<html lang="en">', "<html>"),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "no lang attribute"), "names the defect");
});

check("MUTATION: a document losing its viewport fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace(/<meta name="viewport"[^>]*>/, ""),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "desktop width"), "names the consequence");
});

check("a keywords tag is a warning and does not fail the run", () => {
  const result = mutate("index.html", (html) =>
    html.replace("<title>", '<meta name="keywords" content="a,b"><title>'),
  );
  equal(result.ok, true, "still ok");
  equal(bySeverity(result.findings, "warning").length, 1, "one warning");
});

check(
  "each mutation is isolated — a fresh build still passes after them all",
  () => {
    equal(
      auditSeo(writeSyntheticBuild(), { origin: ORIGIN }).ok,
      true,
      "unaffected",
    );
  },
);

check("findings sort stably, so two runs print identically", () => {
  const findings = [
    {
      check: "head",
      severity: "error",
      at: "b.html",
      detail: "d",
      id: "head|b|x",
    },
    {
      check: "title",
      severity: "error",
      at: "a.html",
      detail: "d",
      id: "title|a|x",
    },
  ] as Finding[];
  equal(sortFindings(findings)[0]!.check, "title", "title sorts before head");
});

// ---------------------------------------------------------------------------
console.log("\nThe real build, when one is present");

check("the real build has no SEO errors", () => {
  let result;
  try {
    result = auditSeo(path.resolve(process.cwd(), "apps/website/dist"));
  } catch {
    console.log("    (no build present — skipped)");
    return;
  }
  const errors = bySeverity(result.findings, "error");
  equal(
    errors.length,
    0,
    `errors: ${errors.map((finding) => finding.id).join(", ")}`,
  );
});

for (const root of created) rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("\nSEO audit suite FAILED:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("SEO audit suite OK");
