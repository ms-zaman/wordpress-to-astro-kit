// site-map-audit suite.
//
// Everything here runs with no network and no build. The crawl is the one part
// that cannot be tested that way — it is a client for somebody else's server —
// and it is deliberately thin: seeds, waves, and a skip list. The parts that
// DECIDE are pure, and they are what is tested.
//
// The three halves:
//
//   1. The comparison key and the family classifier, over permalink
//      structures a real WordPress site might use. This is where a kit for
//      "any WordPress site" earns the claim.
//   2. The diff, over synthetic inventories. Every classification, and the two
//      cases that must never collapse: a redirect into a 404, and a redirect
//      stub read as a page.
//   3. The integrity findings, which refuse to report a gap count over a
//      capture that a rate limit truncated.
import process from "node:process";

import {
  diffInventories,
  integrityFindings,
  type LiveRecord,
  type RetiredFamilies,
} from "../diff.ts";
import type { LocalRecord } from "../local.ts";
import { readSitemap, sitemapsInRobots } from "../sitemaps.ts";
import { skipReason } from "../crawl.ts";
import {
  classifyFamily,
  comparisonKey,
  patternToRegExp,
  INFRASTRUCTURE_FAMILIES,
} from "../urls.ts";

let passed = 0;
const failures: string[] = [];

const check = (name: string, assertion: () => void): void => {
  try {
    assertion();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (thrown) {
    failures.push(`${name} — ${(thrown as Error).message}`);
    console.log(`  ✗ ${name}`);
  }
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const equal = (actual: unknown, expected: unknown, label: string): void =>
  assert(
    actual === expected,
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );

const ORIGIN = "https://example.com";

/** WordPress's default structure with a static front page and a posts page. */
const DEFAULT_PERMALINKS = {
  post: "/%postname%/",
  page: "/%pagename%/",
  category: "/category/%slug%/",
  tag: "/tag/%slug%/",
  author: "/author/%nicename%/",
  postsIndex: "/blog/",
  paginationSegment: "page",
  frontPage: "home",
  postsPerPage: 10,
} as const;

/** "Day and name", posts under a prefix, a translation plugin running. */
const DATED_PERMALINKS = {
  ...DEFAULT_PERMALINKS,
  post: "/blog/%year%/%monthnum%/%day%/%postname%/",
  category: "/topics/%slug%/",
} as const;

// ---------------------------------------------------------------------------
console.log("\nThe comparison key");

check("a key is path plus query, with the fragment dropped", () => {
  equal(comparisonKey(`${ORIGIN}/about#team`, ORIGIN), "/about/", "fragment");
  equal(comparisonKey(`${ORIGIN}/?s=hello`, ORIGIN), "/?s=hello", "query kept");
});

check("THREE SPELLINGS OF ONE NON-LATIN URL ARE ONE KEY", () => {
  // A percent-encoded octet and its character are the same URL, and the hex
  // digits are case-insensitive. WordPress's sitemap serves the lower-case
  // form, `new URL().pathname` produces the upper-case one, and this build
  // emits the character. Before this, that was three keys — so every non-Latin
  // URL was reported as a gap AND as an extra by the same run.
  const key = comparisonKey(`${ORIGIN}/tag/翻訳/`, ORIGIN);
  equal(key, "/tag/翻訳/", "the decoded form is the key");
  equal(
    comparisonKey(`${ORIGIN}/tag/%e7%bf%bb%e8%a8%b3/`, ORIGIN),
    key,
    "lower-case percent-encoding",
  );
  equal(
    comparisonKey(`${ORIGIN}/tag/%E7%BF%BB%E8%A8%B3/`, ORIGIN),
    key,
    "upper-case percent-encoding",
  );
});

check("an escape that would change the PATH SHAPE is left encoded", () => {
  // %2F is a slash IN A NAME, not a separator. Decoding it would turn one
  // segment into two and make two different URLs look like one.
  equal(comparisonKey(`${ORIGIN}/a%2Fb/`, ORIGIN), "/a%2Fb/", "encoded slash");
});

check("A MALFORMED ESCAPE IS LEFT ALONE, NEVER THROWN ON", () => {
  // ja.wordpress.org publishes href="%s" — an unfilled printf template.
  equal(comparisonKey(`${ORIGIN}/x%s/`, ORIGIN), "/x%s/", "kept as it stands");
});

check(
  "a trailing slash is added to an extension-less path, and only there",
  () => {
    // WordPress 301s the slashless form and Astro's directory output serves
    // both, so this one normalisation cannot change identity. A file path is
    // left alone: `/robots.txt/` is not `/robots.txt`.
    equal(comparisonKey(`${ORIGIN}/about`, ORIGIN), "/about/", "page");
    equal(comparisonKey(`${ORIGIN}/robots.txt`, ORIGIN), "/robots.txt", "file");
  },
);

check("A QUERY STRING IS NEVER COLLAPSED ONTO ITS PATH", () => {
  // The key's subject matter is difference. `/?s=hello` is a search results
  // page, not the front page, and a key that merged them would hide it.
  assert(
    comparisonKey(`${ORIGIN}/?s=hello`, ORIGIN) !==
      comparisonKey(`${ORIGIN}/`, ORIGIN),
    "a search and the front page must not share a key",
  );
});

check("another origin and a non-http scheme are outside the universe", () => {
  equal(comparisonKey("https://other.test/x", ORIGIN), null, "other origin");
  equal(comparisonKey("mailto:a@b.c", ORIGIN), null, "mailto");
  equal(comparisonKey("tel:+100", ORIGIN), null, "tel");
});

// ---------------------------------------------------------------------------
console.log("\nPermalink patterns become the classifier");

check("a pattern's tokens become the right matchers", () => {
  const post = patternToRegExp("/blog/%year%/%monthnum%/%day%/%postname%/");
  assert(post.test("/blog/2026/03/17/hello/"), "a dated post matches");
  assert(!post.test("/blog/26/3/17/hello/"), "a two-digit year does not");
});

check("%pagename% matches a HIERARCHY, and %postname% does not", () => {
  // WordPress expands `%pagename%` to a page's whole ancestry, so `/about/team/`
  // is one page. A classifier that matched one segment would call it unknown.
  assert(patternToRegExp("/%pagename%/").test("/about/team/"), "nested page");
  assert(!patternToRegExp("/%postname%/").test("/a/b/"), "post is one segment");
});

console.log("\nFamilies, on WordPress's default structure");

const asDefault = (key: string) =>
  classifyFamily(key, {
    permalinks: DEFAULT_PERMALINKS,
    languagePrefixes: [],
  });

check("the front page, the posts index and the archives", () => {
  equal(asDefault("/"), "front-page", "front page");
  equal(asDefault("/blog/"), "posts-index", "posts index");
  equal(asDefault("/category/news/"), "category", "category");
  equal(asDefault("/tag/sample/"), "tag", "tag");
  equal(asDefault("/author/jane/"), "author", "author");
});

check("pagination is its own family, at the configured segment", () => {
  equal(asDefault("/blog/page/2/"), "pagination", "posts index page 2");
  equal(asDefault("/category/news/page/3/"), "pagination", "category page 3");
});

check("A BARE POST AND A BARE PAGE PATTERN ARE THE SAME REGEX", () => {
  // `/%postname%/` and `/%pagename%/` cannot be told apart from a URL, and
  // answering "post" would be a guess presented as a measurement. The audit
  // says `entry` and lets the diff resolve it against the build.
  equal(asDefault("/hello-world/"), "entry", "ambiguous single segment");
});

check("A PREFIX RESOLVES THE AMBIGUITY, because it is more specific", () => {
  const dated = (key: string) =>
    classifyFamily(key, {
      permalinks: DATED_PERMALINKS,
      languagePrefixes: [],
    });
  equal(dated("/blog/2026/03/17/hello/"), "post", "a dated post is a post");
  equal(dated("/about/"), "page", "a bare path is then only a page");
  equal(dated("/topics/news/"), "category", "a renamed category base");
});

console.log(
  "\nFamilies WordPress serves whether or not anybody configured them",
);

check("date archives, at the root and under the posts prefix", () => {
  // Hundreds of these exist on any site with a few years of posts, and no
  // sitemap lists them. Left as `unknown` they would bury every real finding.
  equal(asDefault("/2026/"), "date-archive", "year");
  equal(asDefault("/2026/03/"), "date-archive", "month");
  equal(
    asDefault("/blog/2026/03/17/"),
    "date-archive",
    "day, under the prefix",
  );
});

check("the WordPress runtime, uploads, feeds and sitemaps", () => {
  equal(asDefault("/wp-json/wp/v2/posts"), "wp-internal", "REST");
  equal(asDefault("/wp-admin/"), "wp-internal", "admin");
  equal(asDefault("/wp-content/uploads/2026/03/x.png"), "media", "an upload");
  equal(asDefault("/feed/"), "feed", "the site feed");
  equal(asDefault("/hello-world/feed/"), "feed", "a per-page feed alias");
  equal(asDefault("/wp-sitemap.xml"), "sitemap", "a sitemap");
});

check(
  "a universal is recognised BEFORE a permalink pattern swallows it",
  () => {
    // `/%postname%/` matches `/feed/` perfectly well. Ordering is the only thing
    // that stops the site feed being reported as a missing post.
    assert(
      patternToRegExp("/%postname%/").test("/feed/"),
      "the pattern matches",
    );
    equal(asDefault("/feed/"), "feed", "and the universal still wins");
  },
);

check(
  "a language prefix is `translated`, and its absence means nothing",
  () => {
    const withFrench = (key: string) =>
      classifyFamily(key, {
        permalinks: DEFAULT_PERMALINKS,
        languagePrefixes: ["fr", "de"],
      });
    equal(withFrench("/fr/a-propos/"), "translated", "a translated page");
    equal(withFrench("/fr/"), "translated", "the language root");
    // Two letters is not a language. Only the CONFIGURED prefixes are, so an
    // unlisted one classifies as whatever its shape says: `/it/` is an ambiguous
    // single segment, and `/it/chi-siamo/` is a page hierarchy, because
    // `%pagename%` matches slashes and `%postname%` does not.
    equal(withFrench("/it/"), "entry", "an unconfigured two-letter root");
    equal(withFrench("/it/chi-siamo/"), "page", "and a path below it");
  },
);

check("a search and a tracked link are told apart from a page", () => {
  equal(asDefault("/?s=hiring"), "search", "search");
  equal(asDefault("/hello/?fbclid=123"), "query-variant", "a shared link");
});

// ---------------------------------------------------------------------------
console.log("\nThe diff");

const liveRecord = (
  key: string,
  over: Partial<LiveRecord> = {},
): LiveRecord => ({
  url: `${ORIGIN}${key}`,
  key,
  sources: ["sitemap:/wp-sitemap.xml"],
  status: 200,
  ...over,
});

const localRecord = (
  key: string,
  over: Partial<LocalRecord> = {},
): LocalRecord => ({
  key,
  file: key === "/" ? "index.html" : `${key.slice(1)}index.html`,
  redirect: false,
  ...over,
});

const only = (rows: readonly { classification: string }[], kind: string) =>
  rows.filter((row) => row.classification === kind);

check("a URL both sides publish is a MATCH", () => {
  const diff = diffInventories(
    [liveRecord("/about/")],
    [localRecord("/about/")],
  );
  equal(diff.counts.MATCH, 1, "matches");
  equal(diff.counts.GAP, 0, "gaps");
});

check("a URL only live publishes is a GAP", () => {
  const diff = diffInventories(
    [liveRecord("/pricing/")],
    [localRecord("/about/")],
  );
  equal(diff.counts.GAP, 1, "gaps");
  assert(
    only(diff.rows, "GAP")[0]!.reason.includes("no fourth answer"),
    "the reason names the rule",
  );
});

check("a URL only this build publishes is LOCAL_ONLY, never a gap", () => {
  const diff = diffInventories([], [localRecord("/new-page/")]);
  equal(diff.counts.LOCAL_ONLY, 1, "local only");
  equal(diff.counts.GAP, 0, "gaps");
});

check("a redirect rule accounts for a retired URL", () => {
  const diff = diffInventories(
    [liveRecord("/old-url/")],
    [localRecord("/new-url/")],
    {
      redirects: { rules: [{ from: "/old-url", to: "/new-url" }], splats: [] },
    },
  );
  equal(diff.counts.REDIRECT, 1, "redirects");
  equal(diff.counts.GAP, 0, "gaps");
});

check("A REDIRECT INTO A 404 IS STILL A GAP", () => {
  // The failure this check exists for: a rule pointing at a route the build
  // does not generate turns a 404 into a chain that ends in a 404, and it
  // reads as handled in every report.
  const diff = diffInventories(
    [liveRecord("/old-url/")],
    [localRecord("/about/")],
    { redirects: { rules: [{ from: "/old-url", to: "/gone/" }], splats: [] } },
  );
  equal(diff.counts.GAP, 1, "gaps");
  assert(
    only(diff.rows, "GAP")[0]!.reason.includes("publishes nothing there"),
    "the reason says the target is missing",
  );
});

check("an absolute redirect target is not checked against dist", () => {
  // It points off this site, so this build has nothing to publish for it.
  const diff = diffInventories(
    [liveRecord("/shop/")],
    [localRecord("/about/")],
    {
      redirects: {
        rules: [{ from: "/shop", to: "https://shop.example.com/" }],
        splats: [],
      },
    },
  );
  equal(diff.counts.REDIRECT, 1, "redirects");
});

check("a splat covers everything under its prefix", () => {
  const diff = diffInventories(
    [liveRecord("/fr/"), liveRecord("/fr/a-propos/")],
    [localRecord("/about/")],
    { redirects: { rules: [], splats: [{ prefix: "/fr" }] } },
  );
  equal(diff.counts.REDIRECT, 2, "redirects");
  assert(
    only(diff.rows, "REDIRECT")[0]!.reason.includes("only a host can honour"),
    "the reason says a splat needs a host",
  );
});

check("A REDIRECT STUB IS NOT A PAGE THIS BUILD PUBLISHES", () => {
  // Astro materialises a redirect as an HTML file. Counting it as a page would
  // report every retired URL as a MATCH, which is the opposite of the truth.
  const diff = diffInventories(
    [liveRecord("/old-url/")],
    [localRecord("/old-url/", { redirect: true })],
  );
  equal(diff.counts.MATCH, 0, "no match");
  equal(diff.counts.GAP, 1, "it is still unaccounted for");
  equal(diff.counts.LOCAL_ONLY, 0, "and it is not a local-only page either");
});

check("a ruled family is RETIRED, and the ruling reaches the report", () => {
  const retired: RetiredFamilies = new Map([
    ["tag", "ADR-0009: tag archives are not carried; no page links to one"],
  ]);
  const diff = diffInventories([liveRecord("/tag/x/")], [], { retired });
  equal(diff.counts.RETIRED, 1, "retired");
  assert(
    only(diff.rows, "RETIRED")[0]!.reason.includes("ADR-0009"),
    "the ruling",
  );
});

check("NOTHING IS RETIRED BY DEFAULT", () => {
  // "We are not carrying the tag archives" is a decision with an owner and a
  // cost in rankings, not a default the tool makes for you.
  const diff = diffInventories([liveRecord("/tag/x/")], []);
  equal(diff.counts.RETIRED, 0, "retired");
  equal(diff.counts.GAP, 1, "it is a gap until somebody rules");
});

check("WordPress's own surfaces are INFRASTRUCTURE, not gaps", () => {
  const diff = diffInventories(
    [liveRecord("/wp-json/wp/v2/posts"), liveRecord("/feed/")],
    [],
  );
  equal(diff.counts.INFRASTRUCTURE, 2, "infrastructure");
  equal(diff.counts.GAP, 0, "gaps");
});

check("A TRANSLATED PAGE IS A GAP, NOT INFRASTRUCTURE", () => {
  // It is content somebody wrote. Whether to carry it is a decision, so it
  // stays a gap until a project makes one.
  assert(
    !INFRASTRUCTURE_FAMILIES.has("translated"),
    "translated must not be infrastructure",
  );
  const diff = diffInventories([liveRecord("/fr/a-propos/")], [], {
    languagePrefixes: ["fr"],
  });
  equal(diff.counts.GAP, 1, "gaps");
});

check("every key on either side produces exactly one row", () => {
  // Totality. A URL that fell out of the classifier is a URL nobody had to
  // account for, which is the failure the whole tool is written against.
  const live = ["/", "/about/", "/tag/x/", "/feed/", "/old/"].map((key) =>
    liveRecord(key),
  );
  const local = ["/", "/about/", "/new/"].map((key) => localRecord(key));
  const diff = diffInventories(live, local, {
    redirects: { rules: [{ from: "/old", to: "/new/" }], splats: [] },
  });
  const total = Object.values(diff.counts).reduce((sum, n) => sum + n, 0);
  equal(total, diff.rows.length, "counts sum to the rows");
  equal(diff.rows.length, 6, "five live keys plus one local-only");
});

check("rows come back sorted, so two runs read the same", () => {
  const diff = diffInventories(
    [liveRecord("/z/"), liveRecord("/a/"), liveRecord("/m/")],
    [],
  );
  equal(diff.rows.map((row) => row.key).join(" "), "/a/ /m/ /z/", "order");
});

// ---------------------------------------------------------------------------
console.log("\nIntegrity — refusing to report a count over a bad capture");

check("an empty inventory is not a site", () => {
  const diff = diffInventories([], [localRecord("/")]);
  const findings = integrityFindings([], [localRecord("/")], diff);
  assert(
    findings.some((finding) => finding.includes("not a site")),
    findings.join(" | "),
  );
});

check(
  "A 403 OR 429 IS REPORTED AS RATE LIMITING, NOT AS THE SITE'S SHAPE",
  () => {
    // The firewall case. A crawl taken through a block returns a smaller site
    // that looks entirely plausible, and a gap count computed from it is worse
    // than no count because it looks like a measurement.
    const live = [liveRecord("/a/", { status: 403 }), liveRecord("/b/")];
    const diff = diffInventories(live, [localRecord("/b/")]);
    const findings = integrityFindings(live, [localRecord("/b/")], diff);
    const message = findings.join(" | ");
    assert(message.includes("rate limiting"), message);
    assert(message.includes("retrying deepens it"), message);
  },
);

check("a request that never completed is not a 404", () => {
  const live = [liveRecord("/a/", { status: 0 })];
  const findings = integrityFindings(
    live,
    [localRecord("/")],
    diffInventories(live, []),
  );
  assert(
    findings.some((finding) => finding.includes("never completed")),
    findings.join(" | "),
  );
});

check("a discovered URL nobody fetched is reported", () => {
  const live = [liveRecord("/a/", { status: undefined })];
  const findings = integrityFindings(
    live,
    [localRecord("/")],
    diffInventories(live, []),
  );
  assert(
    findings.some((finding) => finding.includes("never fetched")),
    findings.join(" | "),
  );
});

check("a clean capture produces no integrity findings", () => {
  const live = [liveRecord("/"), liveRecord("/about/")];
  const local = [localRecord("/"), localRecord("/about/")];
  equal(
    integrityFindings(live, local, diffInventories(live, local)).length,
    0,
    "findings",
  );
});

// ---------------------------------------------------------------------------
console.log("\nDiscovery and politeness");

check("sitemaps are found in robots.txt, whatever plugin wrote it", () => {
  const robots =
    "User-agent: *\nDisallow: /wp-admin/\n\nSitemap: https://example.com/wp-sitemap.xml\nSitemap: https://example.com/sitemap_index.xml\n";
  equal(sitemapsInRobots(robots).length, 2, "both sitemaps");
  equal(sitemapsInRobots("User-agent: *\n").length, 0, "none advertised");
});

check("an index contributes no page URLs, a urlset does", () => {
  const index =
    '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>';
  const urlset =
    '<?xml version="1.0"?><urlset><url><loc>https://example.com/about/</loc></url></urlset>';
  equal(readSitemap(index).isIndex, true, "index");
  equal(readSitemap(urlset).isIndex, false, "urlset");
  equal(readSitemap(urlset).locations[0], "https://example.com/about/", "loc");
});

check("XML entities in a loc are decoded", () => {
  const xml =
    "<urlset><url><loc>https://example.com/?a=1&amp;b=2</loc></url></urlset>";
  equal(
    readSitemap(xml).locations[0],
    "https://example.com/?a=1&b=2",
    "decoded",
  );
});

check(
  "media, the WordPress runtime and query variants are recorded, not fetched",
  () => {
    // Recorded, because leaving them out would make the site look smaller.
    // Not fetched, because nothing is learned by downloading them.
    equal(
      skipReason("/wp-content/uploads/x.png", []),
      "media-asset",
      "an upload",
    );
    equal(skipReason("/wp-json/wp/v2/posts", []), "wp-runtime", "the REST API");
    equal(skipReason("/hello/?fbclid=1", []), "query-variant", "a shared link");
    equal(skipReason("/hello/feed/", []), "per-page-feed", "a feed alias");
    equal(skipReason("/about/", []), null, "an ordinary page is fetched");
  },
);

check("a language ROOT is fetched and its deep pages are not", () => {
  // How many translated pages exist is worth knowing. Fetching all of them is
  // a second whole site for one decision.
  equal(skipReason("/fr/", ["fr"]), null, "the root");
  equal(skipReason("/fr/a-propos/", ["fr"]), "translated-deep-page", "a page");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nSite-map audit suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Site-map audit suite OK\n");
