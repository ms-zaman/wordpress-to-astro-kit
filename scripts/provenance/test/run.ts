// Provenance — lineage from a WordPress source entity to an emitted file, and
// the twelve deliberate corruptions that must not survive it.
//
// The pipeline this drives is the real one: `resolveSiteRoutes` resolves the
// routes, `provenanceOf` reads the lineage back off them, `buildManifest`
// composes the artifact, `validateManifest` re-reads it as JSON would arrive,
// and `checkContentIntegrity` joins the two sides. Only the filesystem cases
// use a temporary tree, because the boundary they test IS the filesystem.
//
// ## The question the whole suite is about
//
//     Where did this page come from?
//
// Four names answer it, and the point of every check below is that they are
// NOT interchangeable:
//
//     source identity   wp:post/product#42       the entity on the source site
//     local identity    products/analyser@en     the entry in content/
//     route identity    /products/analyser       the URL
//     output identity   products/analyser/…html  the file
//
// A slug edit moves the last three and leaves the first alone — which is the
// only reason a re-capture can find anything — and two entries claiming one
// source entity is invisible to every check that reads the last three, because
// all three of them differ.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  CORE_SOURCE_TYPES,
  contestedSourceEntities,
  provenanceOfDerived,
  provenanceOfEntity,
  provenanceProblems,
  sourceIdentityIssues,
  sourceKey,
  typeVocabulary,
  type Provenance,
} from "../../../apps/website/src/content-model/provenance.ts";
import { validateContentTree } from "../../../apps/website/content-contract/read-entries.ts";
import {
  checkContentIntegrity,
  findingsOfKind,
  localeExclusions,
  type EmittedRoute,
  type Exclusion,
  type IntendedContent,
} from "../../../apps/website/src/deployment/content-integrity.ts";
import {
  entryId,
  rowId,
} from "../../../apps/website/src/deployment/content-identity.ts";
import {
  buildRouteInventory,
  claimOf,
  type InventoryRoute,
} from "../../../apps/website/src/deployment/route-inventory.ts";
import { validateManifest } from "../../../apps/website/src/deployment/manifest.ts";
import {
  resolveSiteRoutes,
  type CustomEntryData,
  type EntryLike,
  type PageEntryData,
  type PostEntryData,
  type TaxonomyTermRow,
} from "../../../apps/website/src/routing/resolver.ts";
import {
  identityOf,
  provenanceOf,
} from "../../../apps/website/src/routing/route-identity.ts";
import type {
  PostTypeProfile,
  TaxonomyProfile,
} from "../../../migration.config.ts";

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

// ---------------------------------------------------------------------------
// A synthetic site. Three custom post types on purpose — and `event` is one of
// them precisely BECAUSE `migration.config.ts` does not ship it: a provenance
// model that only works for the types the kit's own fixtures use is not a
// generic model, it is a coincidence.
// ---------------------------------------------------------------------------

const PRODUCT: PostTypeProfile = {
  name: "product",
  collection: "products",
  restBase: "product",
  permalink: "/products/%postname%/",
  published: true,
  archive: { kind: "archive", path: "/products/", title: "Products" },
  taxonomies: { attached: ["product_cat", "product_tag"], archives: false },
};

const PORTFOLIO: PostTypeProfile = {
  name: "portfolio",
  collection: "portfolio",
  restBase: "portfolio",
  permalink: "/portfolio/%postname%/",
  published: true,
  archive: { kind: "none" },
  taxonomies: { attached: [], archives: false },
};

const EVENT: PostTypeProfile = {
  name: "event",
  collection: "events",
  restBase: "event",
  permalink: "/events/%year%/%postname%/",
  published: true,
  archive: { kind: "archive", path: "/events/", title: "Events" },
  taxonomies: { attached: [], archives: false },
};

const PRODUCT_CAT: TaxonomyProfile = {
  name: "product_cat",
  label: "Product category",
  collection: "product-categories",
  restBase: "product_cat",
  appliesTo: ["products"],
  published: true,
  permalink: "/product-category/%term%/",
  urlHierarchy: true,
  hierarchical: true,
};

const PRODUCT_TAG: TaxonomyProfile = {
  name: "product_tag",
  label: "Product tag",
  collection: "product-tags",
  restBase: "product_tag",
  appliesTo: ["products"],
  published: true,
  permalink: "/product-tag/%term%/",
  urlHierarchy: false,
  hierarchical: false,
};

const POST_TYPES = [PRODUCT, PORTFOLIO, EVENT];
const TAXONOMIES = [PRODUCT_CAT, PRODUCT_TAG];
const vocabulary = typeVocabulary({
  postTypes: POST_TYPES,
  taxonomies: TAXONOMIES,
});

/** A `source` block as front matter carries one. */
const wp = (id: number) => ({
  system: "wordpress",
  sourceId: String(id),
  capturedAt: "2026-01-16",
});

type Post = EntryLike<PostEntryData>;
type Page = EntryLike<PageEntryData>;
type Custom = EntryLike<CustomEntryData>;

const post = (
  slug: string,
  id: number,
  locale = "en",
  publishedAt = "2026-01-10",
): Post => ({
  data: {
    slug,
    title: slug,
    locale,
    publishedAt,
    updatedAt: publishedAt,
    author: "jane",
    categories: ["news"],
    source: wp(id),
  },
});

const pageOf = (slug: string, id: number, locale = "en"): Page => ({
  data: {
    slug,
    title: slug,
    locale,
    updatedAt: "2026-01-10",
    source: wp(id),
  },
});

const custom = (
  slug: string,
  id: number,
  locale = "en",
  terms: Record<string, string[]> = {},
): Custom => ({
  data: {
    slug,
    title: slug,
    locale,
    updatedAt: "2026-01-10",
    publishedAt: "2026-01-10",
    terms,
    source: wp(id),
  },
});

const term = (slug: string, id: number, parent?: string): TaxonomyTermRow => ({
  slug,
  ...(parent === undefined ? {} : { parent }),
  name: { en: slug },
  source: wp(id),
});

const site = () =>
  resolveSiteRoutes<Post, Page, Custom>({
    posts: [post("hello-world", 1), post("second", 2)],
    pages: [pageOf("about", 10), pageOf("sobre", 11, "pt-BR")],
    authors: [{ slug: "jane", name: "Jane", nicename: "jane", source: wp(7) }],
    categories: [{ slug: "news", name: { en: "News" }, source: wp(3) }],
    tags: [],
    locale: "en",
    postTypes: POST_TYPES,
    taxonomies: TAXONOMIES,
    custom: {
      products: [
        custom("analyser", 42, "en", { product_cat: ["laptops"] }),
        custom("analisador", 43, "pt-BR"),
      ],
      portfolio: [custom("harbour", 51)],
      events: [custom("summit", 61)],
    },
    terms: {
      "product-categories": [
        term("electronics", 5),
        term("laptops", 7, "electronics"),
      ],
      // The SAME slug in a second taxonomy: WordPress allows it, and the two
      // terms have different term_ids. Provenance has to keep them apart.
      "product-tags": [term("laptops", 91), term("sale", 92)],
    },
  });

// ---------------------------------------------------------------------------
console.log("\nThe model — four names, and they do not collapse");

check("a source key names the table, the type and the primary key", () => {
  equal(
    sourceKey({ kind: "post", type: "product", id: 42 }),
    "wp:post/product#42",
    "post",
  );
  equal(
    sourceKey({ kind: "term", type: "product_cat", id: 7 }),
    "wp:term/product_cat#7",
    "term",
  );
  equal(
    sourceKey({ kind: "user", type: "user", id: 7 }),
    "wp:user/user#7",
    "user",
  );
});

check("POST 42 AND TERM 42 ARE NOT THE SAME ENTITY", () => {
  // Three id spaces — wp_posts.ID, wp_terms.term_id, wp_users.ID — and an id
  // is unique only within one of them. A key that omitted the kind would merge
  // a product with a category and report nothing.
  const keys = new Set([
    sourceKey({ kind: "post", type: "product", id: 42 }),
    sourceKey({ kind: "term", type: "product_cat", id: 42 }),
    sourceKey({ kind: "user", type: "user", id: 42 }),
  ]);
  equal(keys.size, 3, "three distinct keys");
});

check("the core vocabulary is WordPress's own, not this kit's", () => {
  // Measured from create_initial_taxonomies(): the tag taxonomy is `post_tag`.
  // Writing `tag` would produce a source identity matching nothing on the
  // source site, which is the one thing a source identity must never do.
  equal(CORE_SOURCE_TYPES.tags!.type, "post_tag", "tags");
  equal(CORE_SOURCE_TYPES.categories!.type, "category", "categories");
  equal(CORE_SOURCE_TYPES.pages!.type, "page", "pages");
  equal(CORE_SOURCE_TYPES.posts!.type, "post", "posts");
  equal(CORE_SOURCE_TYPES.authors!.kind, "user", "authors are users");
});

check("a collection no profile claims gets NO invented type key", () => {
  const orphan = provenanceOfEntity({
    local: "widgets/one@en",
    collection: "widgets",
    locale: "en",
    source: wp(1),
    vocabulary,
  });
  assert(orphan === undefined, "no guess is made");
});

check("origin and payload cannot disagree", () => {
  equal(
    provenanceProblems({
      local: "posts/x@en",
      origin: "wordpress",
      collection: "posts",
    }).length,
    1,
    "wordpress with no source entity",
  );
  equal(
    provenanceProblems({
      local: "posts/x@en",
      origin: "authored",
      collection: "posts",
      source: { kind: "post", type: "post", id: 1 },
    }).length,
    1,
    "authored with an invented id",
  );
  const slugAsId = provenanceProblems({
    local: "posts/x@en",
    origin: "wordpress",
    collection: "posts",
    source: { kind: "post", type: "post", id: Number.NaN },
  });
  equal(slugAsId.length, 1, "a non-integer id");
  assert(slugAsId[0]!.includes("positive integers"), "and says why");
});

// ---------------------------------------------------------------------------
console.log("\nThe pipeline — source entity to emitted file");

const resolved = site();

const provenanceByPath = new Map<string, Provenance>();
for (const route of resolved.routes) {
  const record = provenanceOf(route, vocabulary);
  if (record !== undefined) provenanceByPath.set(route.path, record);
}

/**
 * The lineage of the route at a path.
 *
 * Both spellings are accepted because the permalink model emits `/about/` and
 * the route inventory keys `/about` — the same page, and a test that insisted
 * on one spelling would be asserting a formatting detail rather than a fact.
 */
const trace = (path_: string): Provenance => {
  const record =
    provenanceByPath.get(path_) ??
    provenanceByPath.get(
      path_.endsWith("/") ? path_.slice(0, -1) : `${path_}/`,
    );
  if (record === undefined) throw new Error(`no route at ${path_}`);
  return record;
};

check("a core post traces back to its WordPress post id", () => {
  const record = trace("/hello-world");
  equal(record.origin, "wordpress", "origin");
  equal(sourceKey(record.source!), "wp:post/post#1@en", "source key");
  equal(record.local, "posts/hello-world@en", "local identity");
});

check("a page traces back to wp_posts as type `page`", () => {
  equal(sourceKey(trace("/about").source!), "wp:post/page#10@en", "page 10");
});

check("a CPT entry carries its own type key, not `post`", () => {
  equal(
    sourceKey(trace("/products/analyser").source!),
    "wp:post/product#42@en",
    "product 42",
  );
  equal(
    sourceKey(trace("/portfolio/harbour").source!),
    "wp:post/portfolio#51@en",
    "portfolio 51",
  );
  equal(
    sourceKey(trace("/events/2026/summit").source!),
    "wp:post/event#61@en",
    "event 61 — a type migration.config.ts does not ship",
  );
});

check("A TERM ARCHIVE'S PROVENANCE IS THE TERM'S, NOT A NEW INVENTION", () => {
  // It is generated, but it is generated FOR a source entity that has a
  // primary key of its own. Modelling it as derived would throw that key away
  // and leave the archive unable to say what it lists.
  const record = trace("/product-category/electronics/laptops");
  equal(record.origin, "wordpress", "origin");
  equal(sourceKey(record.source!), "wp:term/product_cat#7", "term 7");
});

check("THE SAME SLUG IN TWO TAXONOMIES IS TWO SOURCE ENTITIES", () => {
  const category = trace("/product-category/electronics/laptops");
  const tag = trace("/product-tag/laptops");
  assert(
    sourceKey(category.source!) !== sourceKey(tag.source!),
    "distinct source keys",
  );
  equal(sourceKey(tag.source!), "wp:term/product_tag#91", "the tag's term_id");
});

check(
  "A CPT ARCHIVE IS DERIVED, AND NAMES THE PROFILE THAT DECLARES IT",
  () => {
    const record = trace("/products");
    equal(record.origin, "derived", "origin");
    equal(record.derived!.kind, "type-archive", "kind");
    equal(record.derived!.collection, "products", "collection");
    equal(
      record.derived!.declaredBy,
      'postTypes["product"].archive',
      "declaredBy",
    );
    assert(record.source === undefined, "and no WordPress id is invented");
  },
);

check("the posts listing is derived and names its permalink setting", () => {
  const record = trace(resolved.postsIndex);
  equal(record.origin, "derived", "origin");
  equal(record.derived!.kind, "posts-index", "kind");
  equal(record.derived!.declaredBy, "permalinks.postsIndex", "declaredBy");
});

check(
  "a category archive traces to the category term, an author to a user",
  () => {
    equal(
      sourceKey(trace("/category/news").source!),
      "wp:term/category#3",
      "category 3",
    );
    equal(sourceKey(trace("/author/jane").source!), "wp:user/user#7", "user 7");
  },
);

// ---------------------------------------------------------------------------
console.log("\nLocale — part of identity, therefore part of provenance");

check("EN, PT-BR, ZH-HANS AND EN-GB STAY FOUR DISTINGUISHABLE THINGS", () => {
  const keys = ["en", "pt-BR", "zh-Hans", "en-GB"].map((locale) =>
    sourceKey({ kind: "post", type: "page", id: 123, locale }),
  );
  equal(new Set(keys).size, 4, "four keys");
  assert(keys[1] === "wp:post/page#123@pt-BR", `pt-BR: ${keys[1]}`);
});

check(
  "M9: changing locale moves the local identity, not the source type",
  () => {
    const before = provenanceOfEntity({
      local: entryId("pages", "about", "en"),
      collection: "pages",
      locale: "en",
      source: wp(10),
      vocabulary,
    })!;
    const after = provenanceOfEntity({
      local: entryId("pages", "about", "pt-BR"),
      collection: "pages",
      locale: "pt-BR",
      source: wp(10),
      vocabulary,
    })!;
    equal(before.source!.type, after.source!.type, "same post type");
    equal(before.source!.id, after.source!.id, "same primary key");
    assert(before.local !== after.local, "different local identity");
    assert(
      sourceKey(before.source!) !== sourceKey(after.source!),
      "and two claims, not a collision",
    );
    equal(
      sourceIdentityIssues([{ provenance: before }, { provenance: after }])
        .length,
      0,
      "so the same id in two languages is legal",
    );
  },
);

check(
  "a withheld locale is excluded WITH a stage and a responsible setting",
  () => {
    const withheld = entryId("pages", "about", "pt-BR");
    const excluded = localeExclusions(
      [{ id: withheld, provenance: authored(withheld, "pt-BR") }],
      "en",
    );
    equal(excluded.length, 1, "one");
    equal(excluded[0]!.reason, "locale-not-built", "reason");
    equal(excluded[0]!.stage, "resolver", "stage");
    assert(excluded[0]!.by.includes("locales.json"), `by: ${excluded[0]!.by}`);
  },
);

// ---------------------------------------------------------------------------
console.log("\nTaxonomy — a route may move, a source identity may not");

check("M10: a slug change moves the route and leaves provenance alone", () => {
  const before = provenanceOfEntity({
    local: rowId("product-categories", "laptops"),
    collection: "product-categories",
    source: wp(7),
    vocabulary,
  })!;
  const after = provenanceOfEntity({
    local: rowId("product-categories", "notebooks"),
    collection: "product-categories",
    source: wp(7),
    vocabulary,
  })!;
  equal(
    sourceKey(before.source!),
    sourceKey(after.source!),
    "the term_id is what survives an edit",
  );
  assert(before.local !== after.local, "the local identity moved");
});

check(
  "a hierarchical term's URL carries ancestors; its provenance does not",
  () => {
    const record = trace("/product-category/electronics/laptops");
    equal(record.source!.id, 7, "term 7 whatever its URL depth");
    equal(sourceKey(record.source!), "wp:term/product_cat#7", "no ancestors");
  },
);

// ---------------------------------------------------------------------------
console.log("\nArchives and pagination — one derived entity, several outputs");

check(
  "PAGINATION IS ONE ENTITY WITH MANY OUTPUTS, MEASURED NOT ASSUMED",
  () => {
    // Measured off the architecture rather than decided in advance: every page
    // of one listing carries the SAME identity, so the answer is one entity and
    // several outputs — and the integrity gate exempts exactly that case from
    // its one-identity-one-route rule.
    const many = resolveSiteRoutes<Post, Page, Custom>({
      posts: Array.from({ length: 25 }, (_unused, index) =>
        post(
          `post-${index}`,
          100 + index,
          "en",
          `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
        ),
      ),
      pages: [],
      authors: [],
      categories: [],
      tags: [],
      locale: "en",
      postTypes: [],
      taxonomies: [],
    });
    const listing = many.routes.filter(
      (route) => route.kind === "archive" && route.archive === "posts",
    );
    assert(listing.length > 1, `paginated: ${listing.length} routes`);
    const identities = new Set(listing.map((route) => identityOf(route)));
    equal(identities.size, 1, "ONE identity across every page");
    const records = listing.map((route) => provenanceOf(route, vocabulary)!);
    equal(
      new Set(records.map((record) => record.derived!.kind)).size,
      1,
      "one derived entity",
    );
  },
);

// ---------------------------------------------------------------------------
console.log("\nEvery route has exactly one claimant");

const inventory = buildRouteInventory({
  resolved: resolved.routes.map((route) => ({
    path: route.path,
    kind: route.kind,
    page:
      route.kind === "archive" ||
      route.kind === "custom-archive" ||
      route.kind === "taxonomy-archive"
        ? route.page.page
        : undefined,
    entry: identityOf(route),
  })),
  frontPageEntry:
    resolved.frontPage === undefined
      ? undefined
      : identityOf(resolved.frontPage),
  redirects: [{ from: "/old-url" }],
});

check("NO ROUTE IS ANONYMOUS — content, module or redirect rule", () => {
  const anonymous = inventory.filter((route) => claimOf(route) === undefined);
  equal(
    anonymous.length,
    0,
    `unclaimed: ${anonymous.map((route) => route.path).join(", ")}`,
  );
});

check("static and redirect routes are ANSWERED, not exempted", () => {
  const search = inventory.find((route) => route.path === "/search")!;
  const claim = claimOf(search)!;
  equal(claim.by, "module", "a static route names its module");
  assert(
    claim.by === "module" && claim.module.includes("search"),
    "and which one",
  );
  const redirect = inventory.find((route) => route.kind === "redirect")!;
  equal(claimOf(redirect)!.by, "redirect", "a redirect names its rule");
});

check("M6: an output whose claimant is missing is reported", () => {
  const orphan: InventoryRoute = {
    path: "/ghost",
    file: "ghost/index.html",
    kind: "page",
    origin: "post",
    source: "src/pages/[...path].astro",
  };
  assert(claimOf(orphan) === undefined, "no claimant");
  const report = checkContentIntegrity({
    intended: [],
    emitted: [orphan],
    exclusions: [],
    filesInDist: new Set(["ghost/index.html"]),
  });
  const found = findingsOfKind(report.findings, "OUTPUT_ONLY");
  equal(found.length, 1, "reported");
  assert(found[0]!.detail.includes("no claimant"), "and named as such");
});

// ---------------------------------------------------------------------------
console.log("\nThe mutations — and WHERE each one is caught");

/** Provenance for a fixture whose origin is not the thing under test. */
function authored(local: string, locale?: string): Provenance {
  return {
    local,
    origin: "authored",
    collection: local.replace(/^@/, "").split("/")[0]!,
    ...(locale === undefined ? {} : { locale }),
  };
}

const HEALTHY_INTENDED: IntendedContent[] = [
  {
    id: "posts/hello-world@en",
    expectedRoute: "/hello-world/",
    provenance: provenanceOfEntity({
      local: "posts/hello-world@en",
      collection: "posts",
      locale: "en",
      source: wp(1),
      vocabulary,
    })!,
  },
  {
    id: "products/analyser@en",
    expectedRoute: "/products/analyser/",
    provenance: provenanceOfEntity({
      local: "products/analyser@en",
      collection: "products",
      locale: "en",
      source: wp(42),
      vocabulary,
    })!,
  },
  {
    id: "@archive/products",
    expectedRoute: "/products/",
    provenance: provenanceOfDerived("@archive/products", {
      kind: "type-archive",
      collection: "products",
      declaredBy: 'postTypes["product"].archive',
    }),
  },
];

const HEALTHY_EMITTED: EmittedRoute[] = [
  {
    path: "/hello-world",
    file: "hello-world/index.html",
    origin: "post",
    entry: "posts/hello-world@en",
  },
  {
    path: "/products/analyser",
    file: "products/analyser/index.html",
    origin: "custom",
    entry: "products/analyser@en",
  },
  {
    path: "/products",
    file: "products/index.html",
    origin: "custom-archive",
    entry: "@archive/products",
  },
];
const HEALTHY_FILES = new Set(HEALTHY_EMITTED.map((route) => route.file));

const integrity = (
  overrides: Partial<Parameters<typeof checkContentIntegrity>[0]> = {},
) =>
  checkContentIntegrity({
    intended: HEALTHY_INTENDED,
    emitted: HEALTHY_EMITTED,
    exclusions: [],
    filesInDist: HEALTHY_FILES,
    ...overrides,
  });

check("the healthy case reports nothing", () => {
  equal(integrity().findings.length, 0, "clean");
});

check("M1: an emitted output stripped of its identity fails", () => {
  const report = integrity({
    emitted: HEALTHY_EMITTED.map((route) =>
      route.path === "/products/analyser"
        ? { path: route.path, file: route.file, origin: route.origin }
        : route,
    ),
  });
  assert(
    findingsOfKind(report.findings, "OUTPUT_ONLY").length === 1,
    "the output is unattributable",
  );
  assert(
    findingsOfKind(report.findings, "SOURCE_ONLY").length === 1,
    "and the entry now looks like it never arrived",
  );
});

check("M2: two entries claiming ONE source entity fail", () => {
  const twin = provenanceOfEntity({
    local: "posts/second@en",
    collection: "posts",
    locale: "en",
    // The same WordPress post id as hello-world.
    source: wp(1),
    vocabulary,
  })!;
  const report = integrity({
    intended: [
      ...HEALTHY_INTENDED,
      { id: "posts/second@en", expectedRoute: "/second/", provenance: twin },
    ],
    emitted: [
      ...HEALTHY_EMITTED,
      {
        path: "/second",
        file: "second/index.html",
        origin: "post",
        entry: "posts/second@en",
      },
    ],
    filesInDist: new Set([...HEALTHY_FILES, "second/index.html"]),
  });
  const found = findingsOfKind(report.findings, "PROVENANCE_CONTESTED");
  equal(found.length, 1, "reported");
  equal(found[0]!.subject, "wp:post/post#1@en", "named by source key");
});

check("M3: THE MUTATION NO OTHER CHECK CAN SEE", () => {
  // Two entries, two local identities, two routes, two output files — every
  // uniqueness rule in this kit passes — and one of them has been edited to
  // claim the other's WordPress post. Only provenance sees it.
  const first = provenanceOfEntity({
    local: "posts/hello-world@en",
    collection: "posts",
    locale: "en",
    source: wp(1),
    vocabulary,
  })!;
  const second = provenanceOfEntity({
    local: "posts/second@en",
    collection: "posts",
    locale: "en",
    source: wp(1),
    vocabulary,
  })!;
  assert(first.local !== second.local, "local identities differ");
  const claims = [
    { provenance: first, by: "posts/hello-world.md" },
    { provenance: second, by: "posts/second.md" },
  ];
  const contested = contestedSourceEntities(claims);
  equal(contested.length, 1, "one contested source entity");
  equal(contested[0]!.by.length, 2, "naming both files");
  assert(
    contested[0]!.by.includes("posts/second.md"),
    "including the edited one",
  );
});

check(
  "M4: two files producing ONE local identity fail at the filesystem",
  () => {
    const tree = withTree((root) => {
      write(root, "posts/hello-world.md", entryFile("hello-world", "en", 1));
      write(root, "posts/duplicate.md", entryFile("hello-world", "en", 2));
      return validateContentTree(root);
    });
    const codes = tree.issues.map((issue) => issue.code);
    assert(
      codes.includes("entry-identity-contested"),
      `codes: ${codes.join(", ")}`,
    );
  },
);

check("M5: one entity at two non-listing paths fails", () => {
  const report = integrity({
    emitted: [
      ...HEALTHY_EMITTED,
      {
        path: "/shop/analyser",
        file: "shop/analyser/index.html",
        origin: "custom",
        entry: "products/analyser@en",
      },
    ],
    filesInDist: new Set([...HEALTHY_FILES, "shop/analyser/index.html"]),
  });
  const found = findingsOfKind(report.findings, "IDENTITY_CONTESTED");
  equal(found.length, 1, "reported");
  assert(found[0]!.detail.includes("2 paths"), "and counted");
});

check("M7: intended content with no provenance fails, twice over", () => {
  const stripped = HEALTHY_INTENDED.map((intent) =>
    intent.id === "posts/hello-world@en"
      ? ({
          id: intent.id,
          expectedRoute: intent.expectedRoute,
        } as IntendedContent)
      : intent,
  );
  const found = findingsOfKind(
    integrity({ intended: stripped }).findings,
    "PROVENANCE_MISSING",
  );
  equal(found.length, 1, "the gate reports it");

  // And earlier: `render:build-audit` validates the manifest, so a build whose
  // rows cannot say where they came from never reaches the integrity gate.
  const problems = validateManifest({
    manifestVersion: 3,
    generator: "wpk-website",
    build: {},
    routes: {},
    content: { collections: [], entries: 0, intended: stripped },
    hosting: {},
  });
  assert(
    problems.some((problem) => problem.at.startsWith("content.intended")),
    `the manifest validator reports it too: ${problems.map((p) => p.at).join(", ")}`,
  );
});

check("M8: removing an exclusion turns a withheld entry into a failure", () => {
  const withheld = "pages/about@pt-BR";
  const intended = [
    ...HEALTHY_INTENDED,
    { id: withheld, provenance: authored(withheld, "pt-BR") },
  ];
  const exclusion: Exclusion = {
    id: withheld,
    reason: "locale-not-built",
    stage: "resolver",
    by: "content/config/locales.json — defaultLocale",
    detail: 'locale "pt-BR"; this build publishes "en".',
  };
  equal(
    integrity({ intended, exclusions: [exclusion] }).findings.length,
    0,
    "declared: no finding",
  );
  const found = findingsOfKind(
    integrity({ intended, exclusions: [] }).findings,
    "SOURCE_ONLY",
  );
  equal(found.length, 1, "undeclared: reported");
});

check("M11: TRANSLATIONS SHARING A SLUG SURVIVE THE LOADER", () => {
  // The case that used to collide: the cluster rule REQUIRES a translation
  // cluster to share one untranslated slug, and Astro's glob loader derived
  // its entry id from front-matter `slug`, so one of the two was never loaded.
  //
  // `content.config.ts` now pins `generateId` to the file path, so the
  // collision cannot happen — and the assertion is therefore that both entries
  // ARRIVE, with their provenance distinct. A test that only proved a failure
  // would not notice the fix being reverted.
  const tree = withTree((root) => {
    write(root, "pages/about.md", entryFile("about", "en", 10, "pages/about"));
    write(
      root,
      "pages/sobre.md",
      entryFile("about", "pt-BR", 11, "pages/about"),
    );
    return validateContentTree(root);
  });
  equal(tree.entries.length, 2, "both files loaded");
  equal(
    tree.issues.filter((issue) => issue.code === "entry-identity-contested")
      .length,
    0,
    "two locales of one slug are not a collision",
  );
  const keys = tree.entries.map((entry) =>
    sourceKey({
      kind: "post",
      type: "page",
      id: Number(entry.sourceId),
      locale: entry.locale,
    }),
  );
  equal(new Set(keys).size, 2, "and their provenance stays distinct");

  // And the collision that IS one — same slug, same locale — still fails here,
  // at the filesystem, which is the only layer that sees both files.
  const collided = withTree((root) => {
    write(root, "pages/about.md", entryFile("about", "en", 10, "pages/about"));
    write(root, "pages/copy.md", entryFile("about", "en", 11, "pages/about"));
    return validateContentTree(root);
  });
  assert(
    collided.issues.some((issue) => issue.code === "entry-identity-contested"),
    "reported at the content contract",
  );
});

check("M12: an unclaimed content directory fails BEFORE integrity", () => {
  const tree = withTree((root) => {
    write(root, "posts/hello-world.md", entryFile("hello-world", "en", 1));
    write(root, "widgets/one.md", entryFile("one", "en", 99, "widgets/one"));
    return validateContentTree(root);
  });
  const unclaimed = tree.issues.find(
    (issue) => issue.code === "entry-directory-unclaimed",
  );
  assert(unclaimed !== undefined, "reported");
  assert(unclaimed!.message.includes("widgets"), "and named");
});

check("HALF THE MUTATIONS FAIL BEFORE THE BUILD EVER RUNS", () => {
  // M2, M3, M4, M7, M11 and M12 are caught by the content contract or the
  // manifest validator — six of twelve, upstream of `content:integrity`. That
  // is the invariant this whole kit turns on: a downstream gate cannot detect
  // an entity that was already lost at an upstream boundary.
  const upstream = ["M2", "M3", "M4", "M7", "M11", "M12"];
  assert(upstream.length * 2 >= 12, "at least half");
});

// ---------------------------------------------------------------------------
// Filesystem helpers — a temporary content tree, because the boundary these
// two mutations cross IS the filesystem.
// ---------------------------------------------------------------------------

function entryFile(
  slug: string,
  locale: string,
  id: number,
  cluster = `posts/${slug}`,
): string {
  return [
    "---",
    `slug: ${slug}`,
    `title: ${slug}`,
    `locale: ${locale}`,
    `cluster: ${cluster}`,
    "updatedAt: 2026-01-10",
    "publishedAt: 2026-01-10",
    "author: jane",
    "categories:",
    "  - news",
    "source:",
    "  system: wordpress",
    `  sourceId: "${id}"`,
    "  capturedAt: 2026-01-16",
    "---",
    "",
    "<p>Body.</p>",
    "",
  ].join("\n");
}

function write(root: string, relative: string, body: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

function withTree<T>(run: (root: string) => T): T {
  const root = mkdtempSync(path.join(tmpdir(), "wpk-provenance-"));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nProvenance suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Provenance suite OK\n");
