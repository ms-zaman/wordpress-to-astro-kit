// Rendering contract tests — the parts of the site that surround the
// components and can be executed without a build: the URL model, the route
// table, the manifest, the head, the sitemap, the launch switch, the forms
// layer, the search matcher, the media seam, and the review map's coverage
// of the route inventory. `build-audit.ts` is the other half and reads
// `dist/`.
//
// Node 24 baseline, no test runner. Invoke with `pnpm render`.
import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildContentIndex } from "../src/content-index/adapters.ts";
import { paginate, pageHref } from "../src/content-index/pagination.ts";
import { relatedContent } from "../src/content-index/related.ts";
import { buildManifest, validateManifest } from "../src/deployment/manifest.ts";
import {
  parseRedirectMap,
  redirectFindings,
  toNetlifyRedirects,
} from "../src/deployment/redirects.ts";
import {
  buildRouteInventory,
  duplicatePaths,
} from "../src/deployment/route-inventory.ts";
import {
  robotsDirective,
  siteEnvironment,
  sitemapIncludes,
} from "../src/deployment/site-environment.ts";
import { formDefinitions } from "../src/forms/definitions.ts";
import { routingViolations, transportFor } from "../src/forms/routing.ts";
import { prepareBody } from "../src/rendering/body.ts";
import {
  breadcrumbListJsonLd,
  canonicalUrl,
  socialTags,
} from "../src/rendering/head-model.ts";
import {
  collectMediaRefs,
  deferBodyImages,
  inlineEmojiImages,
  mediaSrcset,
  mediaUrl,
  rewriteMediaHtml,
} from "../src/rendering/media.ts";
import {
  firstProseParagraph,
  postSummary,
  readingTime,
  textOf,
} from "../src/rendering/post-view.ts";
import {
  publishableCandidates,
  serializeSitemap,
  sitemapCandidates,
} from "../src/rendering/sitemap-model.ts";
import { registryViolations } from "../src/review/decision-registry.ts";
import { coverageGaps } from "../src/review/review-map.ts";
import { signoffStatus } from "../src/release/signoff.ts";
import {
  expandPattern,
  isPaginationPath,
  paginatedPath,
  permalinkProblems,
} from "../src/routing/permalink.ts";
import { resolveSiteRoutes, routeParam } from "../src/routing/resolver.ts";
import { routeKey, sitePath } from "../src/routing/url-shape.ts";
import { buildSearchIndex } from "../src/search/search-document.ts";
import { search } from "../src/search/search-query.ts";
import { validateContentTree } from "../content-contract/read-entries.ts";

let passed = 0;
const failures: string[] = [];

const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

const throws = (fn: () => unknown, pattern: RegExp): boolean => {
  try {
    fn();
    return false;
  } catch (error) {
    return pattern.test((error as Error).message);
  }
};

// ---------------------------------------------------------------------------
console.log("\nURL shape and permalinks");
check("sitePath adds one trailing slash", sitePath("/blog") === "/blog/");
check(
  "sitePath leaves a file alone",
  sitePath("/sitemap.xml") === "/sitemap.xml",
);
check(
  "sitePath keeps a query after the slash",
  sitePath("/search?q=a") === "/search/?q=a",
);
check(
  "routeKey strips the slash",
  routeKey("/blog/") === "/blog" && routeKey("/") === "/",
);
check(
  "the configured permalinks are usable",
  permalinkProblems().length === 0,
  permalinkProblems().join("; "),
);
check(
  "expandPattern: WordPress 'day and name'",
  expandPattern("/%year%/%monthnum%/%day%/%postname%/", {
    year: "2026",
    monthnum: "01",
    day: "15",
    postname: "hello",
  }) === "/2026/01/15/hello/",
);
check(
  "expandPattern throws on a token nobody supplied",
  throws(
    () => expandPattern("/%category%/%postname%/", { postname: "x" }),
    /%category%/,
  ),
);
check(
  "paginatedPath: page 1 is the archive's own URL",
  paginatedPath("/blog/", 1) === "/blog/",
);
check(
  "paginatedPath: page 2 is under the segment",
  paginatedPath("/blog", 2) === "/blog/page/2/",
);
check(
  "isPaginationPath",
  isPaginationPath("/blog/page/2") && !isPaginationPath("/blog/"),
);

// ---------------------------------------------------------------------------
console.log("\nThe route table");
type Post = {
  data: {
    slug: string;
    title: string;
    locale: string;
    publishedAt: string;
    updatedAt: string;
    author: string;
    categories: string[];
    tags?: string[];
  };
  body?: string;
};
type Page = {
  data: {
    slug: string;
    title: string;
    locale: string;
    updatedAt: string;
    parent?: string;
  };
  body?: string;
};
const post = (
  slug: string,
  day: number,
  categories = ["news"],
  tags: string[] = [],
): Post => ({
  data: {
    slug,
    title: slug,
    locale: "en",
    publishedAt: `2026-01-${String(day).padStart(2, "0")}`,
    updatedAt: `2026-01-${String(day).padStart(2, "0")}`,
    author: "jane-doe",
    categories,
    tags,
  },
  body: `<p>${slug} body</p>`,
});
const page = (slug: string, parent?: string): Page => ({
  data: { slug, title: slug, locale: "en", updatedAt: "2026-01-01", parent },
  body: `<p>${slug}</p>`,
});
const posts = Array.from({ length: 11 }, (_, i) =>
  post(
    `post-${i + 1}`,
    i + 1,
    i % 2 ? ["news"] : ["uncategorized"],
    i === 0 ? ["sample"] : [],
  ),
);
const sources = {
  posts,
  pages: [page("home"), page("about"), page("team", "about"), page("blog")],
  authors: [{ slug: "jane-doe", name: "Jane Doe", nicename: "jane" }],
  categories: [
    { slug: "news", name: { en: "News" } },
    { slug: "uncategorized", name: { en: "Uncategorized" } },
  ],
  tags: [{ slug: "sample", name: { en: "Sample" } }],
  locale: "en",
};
const table = resolveSiteRoutes(sources);
const paths = table.routes.map((route) => route.path);
check(
  "the front page is the configured page",
  table.frontPage?.kind === "page" &&
    table.frontPage.entry.data.slug === "home",
);
check(
  "the front page is not also published at /home/",
  !paths.includes("/home/"),
);
check("a post at its permalink", paths.includes("/post-1/"));
check("a child page under its parent", paths.includes("/about/team/"));
check("the posts index at postsIndex", paths.includes("/blog/"));
check(
  "the posts page supplies the listing's title",
  table.routes.find((r) => r.kind === "archive" && r.archive === "posts")
    ?.title === "blog",
);
check(
  "the posts page is not rendered as a page",
  !table.routes.some((r) => r.kind === "page" && r.entry.data.slug === "blog"),
);
check(
  "eleven posts at ten a page make a page two",
  paths.includes("/blog/page/2/") && !paths.includes("/blog/page/3/"),
);
check("a category archive", paths.includes("/category/news/"));
check("a tag archive", paths.includes("/tag/sample/"));
check("an author archive at the nicename", paths.includes("/author/jane/"));
check("posts are newest first", table.posts[0]?.data.slug === "post-11");
check(
  "hrefOf answers for a post and a page",
  table.hrefOf("post", "post-1") === "/post-1/" &&
    table.hrefOf("page", "home") === "/",
);
check(
  "routeParam strips both slashes",
  routeParam("/category/news/") === "category/news",
);
check(
  "two entries claiming one path throw by name",
  throws(
    () =>
      resolveSiteRoutes({
        ...sources,
        pages: [...sources.pages, page("post-1")],
      }),
    /Two routes claim \/post-1\//,
  ),
);
check(
  "an unknown parent throws by name",
  throws(
    () => resolveSiteRoutes({ ...sources, pages: [page("lost", "nowhere")] }),
    /names parent "nowhere"/,
  ),
);

// ---------------------------------------------------------------------------
console.log("\nRoute inventory and manifest");
const resolved = table.routes.map((route) => ({
  path: route.path,
  kind: route.kind,
  page: route.kind === "archive" ? route.page.page : undefined,
}));
const inventory = buildRouteInventory({
  resolved,
  redirects: [{ from: "/old-post" }],
});
check("no duplicate paths", duplicatePaths(inventory).length === 0);
check(
  "the inventory holds the static routes",
  inventory.some((r) => r.path === "/") &&
    inventory.some((r) => r.path === "/search"),
);
check(
  "pagination is its own origin",
  inventory.find((r) => r.path === "/blog/page/2")?.origin === "pagination",
);
check(
  "a redirect is in the inventory",
  inventory.find((r) => r.path === "/old-post")?.kind === "redirect",
);
const manifest = buildManifest({
  resolved,
  collections: [{ name: "posts", entries: 11, routed: 11 }],
});
check(
  "the manifest validates",
  validateManifest(manifest).length === 0,
  validateManifest(manifest)
    .map((p) => p.at)
    .join(", "),
);
check(
  "the manifest records the preview environment",
  manifest.build.environment === "preview",
);
check(
  "a route colliding with a static path fails the manifest",
  throws(
    () =>
      buildManifest({
        resolved: [{ path: "/search/", kind: "page" }],
        collections: [],
      }),
    /claimed by more than one route/,
  ),
);
const gaps = coverageGaps(inventory);
check(
  "the review map covers every route",
  gaps.undocumented.length === 0,
  gaps.undocumented.join(", "),
);
check(
  "every review-map row covers something",
  gaps.unused.length === 0,
  gaps.unused.join(", "),
);

// ---------------------------------------------------------------------------
console.log("\nRedirects");
const map = parseRedirectMap({
  rules: [
    { from: "/old-post/", to: "/post-1/", status: 301, family: "renamed" },
    { from: "/gone", to: "/nowhere", status: 301, family: "renamed" },
    { from: "/self", to: "/self/", status: 301, family: "renamed" },
  ],
  splats: [{ prefix: "/fr", status: 302, family: "language" }],
});
const published = new Set(
  inventory.filter((r) => r.kind === "page").map((r) => r.path),
);
const findings = redirectFindings(map, published);
check(
  "a redirect to a published page has no finding",
  !findings.some((f) => f.rule.from === "/old-post"),
);
check(
  "a redirect to nowhere is found",
  findings.some(
    (f) => f.rule.from === "/gone" && f.problem === "target-not-published",
  ),
);
check(
  "a self redirect is found",
  findings.some(
    (f) => f.rule.from === "/self" && f.problem === "self-redirect",
  ),
);
check("targets take the site's URL shape", map.rules[0]?.to === "/post-1/");
check(
  "_redirects lists rules before splats",
  /old-post.*\n[\s\S]*\/fr\/\* \/:splat 302/.test(toNetlifyRedirects(map)),
);
check(
  "a splat cannot be the root",
  throws(
    () =>
      parseRedirectMap({
        rules: [],
        splats: [{ prefix: "/", status: 301, family: "x" }],
      }),
    /cannot be the root/,
  ),
);

// ---------------------------------------------------------------------------
console.log("\nThe launch switch");
check("unset is preview", siteEnvironment({}) === "preview");
check(
  "production is production",
  siteEnvironment({ WPK_SITE_ENV: "production" }) === "production",
);
check(
  "a typo throws",
  throws(
    () => siteEnvironment({ WPK_SITE_ENV: "prod" }),
    /must be "preview" or "production"/,
  ),
);
check(
  "a preview page is noindex",
  robotsDirective("/post-1/", "preview") === "noindex",
);
check(
  "a production page is indexable",
  robotsDirective("/post-1/", "production") ===
    "index, follow, max-image-preview:large",
);
check(
  "search is never indexed",
  robotsDirective("/search/", "production") === "noindex",
);
check(
  "a sitemap lists nothing in preview",
  !sitemapIncludes("/post-1", "preview"),
);
check(
  "a sitemap skips pagination in production",
  !sitemapIncludes("/blog/page/2", "production") &&
    sitemapIncludes("/blog", "production"),
);

// ---------------------------------------------------------------------------
console.log("\nThe head");
const noOrigin = socialTags({
  title: "T",
  locale: "en",
  pathname: "/x/",
  origin: undefined,
});
check("no origin, no og:url", !noOrigin.some((tag) => tag.key === "og:url"));
const withOrigin = socialTags({
  title: "T",
  locale: "en-US",
  pathname: "/x/",
  origin: "https://example.com",
});
check(
  "an origin makes og:url absolute",
  withOrigin.find((tag) => tag.key === "og:url")?.content ===
    "https://example.com/x/",
);
check(
  "og:locale is xx_XX",
  withOrigin.find((tag) => tag.key === "og:locale")?.content === "en_US",
);
check(
  "no canonical without an origin",
  canonicalUrl({
    title: "T",
    locale: "en",
    pathname: "/x/",
    canonical: "https://a.example/x/",
    origin: undefined,
  }) === undefined,
);
check(
  "a canonical with an origin",
  canonicalUrl({
    title: "T",
    locale: "en",
    pathname: "/x/",
    origin: "https://example.com",
  }) === "https://example.com/x/",
);
check(
  "breadcrumbs need an origin and hrefs",
  breadcrumbListJsonLd(
    [{ label: "Home", href: "/" }, { label: "X" }],
    undefined,
  ) === undefined &&
    breadcrumbListJsonLd(
      [{ label: "Home", href: "/" }, { label: "X" }],
      "https://example.com",
    ) !== undefined,
);

// ---------------------------------------------------------------------------
console.log("\nThe sitemap");
const sitemapSources = [
  { path: "/", kind: "page" },
  { path: "/search/", kind: "static" },
  { path: "/post-1/", kind: "post", lastModified: "2026-01-01" },
  { path: "/blog/page/2/", kind: "archive" },
];
const previewRows = publishableCandidates(
  sitemapCandidates(sitemapSources, { locale: "en", environment: "preview" }),
);
check("preview publishes no rows", previewRows.length === 0);
const productionRows = publishableCandidates(
  sitemapCandidates(sitemapSources, {
    locale: "en",
    environment: "production",
  }),
);
check(
  "production publishes the indexable, non-paginated pages",
  productionRows.map((r) => r.path).join(",") === "/,/post-1",
);
check(
  "no origin serialises an empty urlset",
  !serializeSitemap(productionRows, undefined).includes("<loc>"),
);
check(
  "an origin serialises absolute locs with lastmod",
  serializeSitemap(productionRows, "https://example.com").includes(
    "<loc>https://example.com/post-1/</loc><lastmod>2026-01-01</lastmod>",
  ),
);

// ---------------------------------------------------------------------------
console.log("\nForms, decisions, sign-off");
check(
  "every form has one route",
  routingViolations().length === 0,
  routingViolations().join("; "),
);
check(
  "a form is undecided without its variable",
  transportFor("contact", {}).kind === "undecided",
);
check(
  "a form is wired by its variable",
  transportFor("contact", {
    WPK_FORM_ENDPOINT_CONTACT: "https://example.com/f",
  }).kind === "http-post",
);
check(
  "a non-https endpoint throws",
  throws(
    () => transportFor("contact", { WPK_FORM_ENDPOINT_CONTACT: "http://x" }),
    /absolute https/,
  ),
);
check(
  "the sample form defines the four fields",
  formDefinitions[0]?.fields.length === 4,
);
check(
  "an empty registry has no violations",
  registryViolations([]).length === 0,
);
check(
  "a pending decision without an impact is a violation",
  registryViolations([
    {
      id: "D-001-1",
      title: "?",
      status: "pending",
      owner: "design",
      recordedBy: 1,
    },
  ]).length === 1,
);
check(
  "no sign-off means not signed",
  signoffStatus({ commit: "a".repeat(40), digest: "x", isAncestor: () => "no" })
    .signed === false,
);

// ---------------------------------------------------------------------------
console.log("\nSearch and the content index");
const index = buildContentIndex({
  posts,
  pages: sources.pages,
  hrefOf: table.hrefOf,
});
check("the index carries every routed post and page", index.length === 11 + 4);
const searchIndex = buildSearchIndex(index, { locale: "en" });
check("a prefix matches", search(searchIndex, "post-1").length >= 1);
check(
  "terms are ANDed",
  search(searchIndex, "post-1 nothing-here").length === 0,
);
check("an empty query returns nothing", search(searchIndex, "  ").length === 0);
const related = relatedContent(
  index.find((e) => e.slug === "post-2")!,
  index,
);
check(
  "related posts share a category",
  related.length > 0 &&
    related.every((m) => m.sharedCategories.includes("news")),
);
const pageTwo = paginate(posts, { page: 2, pageSize: 10 });
check(
  "paginate: page two holds the eleventh post",
  pageTwo.items.length === 1 && pageTwo.hasPrevious && !pageTwo.hasNext,
);
check(
  "pageHref throws outside the listing",
  throws(() => pageHref("/blog/", 3, 2), /no URL for page 3/),
);

// ---------------------------------------------------------------------------
console.log("\nThe media seam and the body pipeline");
check(
  "a relative upload passes through with no origin",
  mediaUrl("/wp-content/uploads/a.png", undefined) ===
    "/wp-content/uploads/a.png",
);
check(
  "the origin is required, so 'none' is expressible",
  // It reads as a formality and it is not: while `mediaUrl` defaulted its
  // second argument, passing `undefined` selected the CONFIGURED origin, so
  // this assertion and the one above passed only while no live origin was
  // set — and started failing the moment `kit:init` configured one, which is
  // how the defect was found.
  mediaUrl("/wp-content/uploads/a.png", "https://m.example") ===
    "https://m.example/wp-content/uploads/a.png",
);
check(
  "a relative upload takes the configured origin",
  mediaUrl("/wp-content/uploads/a.png", "https://media.example") ===
    "https://media.example/wp-content/uploads/a.png",
);
check(
  "a non-upload reference is untouched",
  mediaUrl("https://elsewhere.example/x.png", "https://media.example") ===
    "https://elsewhere.example/x.png",
);
check(
  "rewriteMediaHtml rewrites src, srcset and url()",
  rewriteMediaHtml(
    '<img src="/wp-content/uploads/a.png" srcset="/wp-content/uploads/a-300.png 300w, /wp-content/uploads/a.png 800w"><div style="background:url(/wp-content/uploads/b.png)"></div>',
    "https://m.example",
  ) ===
    '<img src="https://m.example/wp-content/uploads/a.png" srcset="https://m.example/wp-content/uploads/a-300.png 300w, https://m.example/wp-content/uploads/a.png 800w"><div style="background:url(https://m.example/wp-content/uploads/b.png)"></div>',
);
check(
  "collectMediaRefs de-duplicates",
  collectMediaRefs(
    '<img src="/wp-content/uploads/a.png"><a href="/wp-content/uploads/a.png">',
  ).length === 1,
);
check(
  "mediaSrcset needs two candidates",
  mediaSrcset({ url: "/wp-content/uploads/a.png", width: 800 }, undefined) ===
    undefined &&
    mediaSrcset(
      {
        url: "/wp-content/uploads/a.png",
        width: 800,
        variants: [{ url: "/wp-content/uploads/a-300.png", width: 300 }],
      },
      undefined,
    ) === "/wp-content/uploads/a-300.png 300w, /wp-content/uploads/a.png 800w",
);
check(
  "deferBodyImages leaves a declared loading alone",
  deferBodyImages('<img src="a" loading="eager">') ===
    '<img src="a" loading="eager" decoding="async">',
);
check(
  "inlineEmojiImages restores the character",
  inlineEmojiImages(
    '<img class="emoji" src="https://s.w.org/images/core/emoji/15/svg/26a1.svg" alt="⚡">',
  ) === "⚡",
);
check(
  "prepareBody demotes a body h1",
  prepareBody("<h1 class=x>T</h1>").startsWith("<h2 class=x>T</h2>"),
);

// ---------------------------------------------------------------------------
console.log("\nThe post view model");
check(
  "textOf strips tags and decodes entities",
  textOf("<p>A &amp; B&nbsp;C</p>") === "A & B C",
);
check(
  "firstProseParagraph reads the first <p>",
  firstProseParagraph("<h2>H</h2><p>First <em>one</em>.</p><p>Second.</p>") ===
    "First one.",
);
check(
  "firstProseParagraph skips markdown headings",
  firstProseParagraph("# H\n\n- item\n\nA *line* of [text](/x).") ===
    "A line of text.",
);
check(
  "postSummary prefers the excerpt",
  postSummary({ excerpt: "<b>Short</b>" }, "<p>Long body</p>", 160) === "Short",
);
check(
  "readingTime never reports zero minutes for prose",
  readingTime("<p>one two three</p>").minutes === 1,
);

// ---------------------------------------------------------------------------
console.log("\nThe repository's own content");
const contentRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../content",
);
const tree = validateContentTree(contentRoot, {
  authors: ["jane-doe"],
  categories: ["uncategorized", "news"],
  tags: ["sample"],
});
check(
  "the content tree reads cleanly",
  tree.problems.length === 0,
  tree.problems.join("; "),
);
check(
  "the content tree has no cross-entry issues",
  tree.issues.length === 0,
  tree.issues.map((i) => i.code).join(", "),
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nRendering contract FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Rendering contract OK\n");
