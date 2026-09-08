// Identity and ownership — the invariants, and the collisions they catch.
//
// Four defects in this kit turned out to be one shape: a valid source entity
// disappeared or overwrote another BEFORE any downstream gate could see it.
// This suite states the invariant once and exercises it at each boundary that
// can observe a collision.
//
//     Identity uniqueness must be checked at the earliest boundary that can
//     observe the complete set of competing entities.
//
// The four invariants, written as helpers rather than repeated by hand:
//
//     for every collection: identity -> exactly one source entity
//     for every collection name: -> exactly one owner
//     for every route: -> exactly one claimant
//     for every output: -> exactly one claimant
import process from "node:process";

import {
  collectionOwnershipIssues,
  entryIdentityIssues,
  soleClaimant,
  CORE_COLLECTIONS,
} from "../../../apps/website/src/content-model/ownership.ts";
import {
  checkContentIntegrity,
  findingsOfKind,
  type EmittedRoute,
  type IntendedContent,
} from "../../../apps/website/src/deployment/content-integrity.ts";
import {
  entryId,
  rowId,
} from "../../../apps/website/src/deployment/content-identity.ts";
import { duplicatePaths } from "../../../apps/website/src/deployment/route-inventory.ts";
import {
  resolveSiteRoutes,
  type CustomEntryData,
  type EntryLike,
  type PageEntryData,
  type PostEntryData,
  type TaxonomyTermRow,
} from "../../../apps/website/src/routing/resolver.ts";
import type { Provenance } from "../../../apps/website/src/content-model/provenance.ts";
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

function threw(run: () => unknown): string {
  try {
    run();
  } catch (cause) {
    return (cause as Error).message;
  }
  return "";
}

// ---------------------------------------------------------------------------
// The reusable invariants. Four lines each, because the property is small and
// the value is in applying the SAME one everywhere rather than writing three
// slightly different deduplication checks in three files — which is exactly
// how the defects below got in.

/** identity -> exactly one source entity. */
const oneEntityPerIdentity = (
  entries: readonly { collection: string; slug: string; locale: string }[],
): boolean => entryIdentityIssues(entries).length === 0;

/** route -> exactly one claimant. */
const oneClaimantPerRoute = (paths: readonly string[]): boolean =>
  duplicatePaths(
    paths.map((path) => ({
      path,
      file: "",
      kind: "page" as const,
      origin: "page" as const,
      source: "",
    })),
  ).length === 0;

/** output -> exactly one claimant. */
const oneClaimantPerOutput = (files: readonly string[]): boolean =>
  soleClaimant(
    files.map((file) => ({ key: file, by: file })),
    "entry-identity-contested",
    () => "",
  ).length === 0;

// ---------------------------------------------------------------------------
const TYPE: PostTypeProfile = {
  name: "product",
  collection: "products",
  restBase: "product",
  permalink: "/products/%postname%/",
  published: true,
  archive: { kind: "none" },
  taxonomies: { attached: [], archives: false },
};

const TAX: TaxonomyProfile = {
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

type Entry = EntryLike<CustomEntryData> & { data: CustomEntryData };
const entry = (slug: string, locale = "en"): Entry => ({
  data: {
    slug,
    title: slug,
    locale,
    updatedAt: "2026-01-15",
    publishedAt: "2026-01-10",
  } as CustomEntryData,
  body: "",
});

const resolve = (
  postTypes: readonly PostTypeProfile[],
  custom: Record<string, readonly Entry[]>,
  taxonomies: readonly TaxonomyProfile[] = [],
  terms: Record<string, readonly TaxonomyTermRow[]> = {},
) =>
  resolveSiteRoutes<EntryLike<PostEntryData>, EntryLike<PageEntryData>, Entry>({
    posts: [],
    pages: [],
    authors: [],
    categories: [],
    tags: [],
    custom,
    postTypes,
    taxonomies,
    terms,
    locale: "en",
  });

console.log("\nInvariant 1 — identity maps to exactly one source entity");

check("TWO FILES, ONE IDENTITY, IS A NAMED FAILURE", () => {
  // The fourth defect, and the one that motivated this mission: two `en` pages
  // with slug `home`, one of them the configured front page. The build
  // succeeded, the second file silently rendered at `/`, and every gate agreed
  // with itself.
  const issues = entryIdentityIssues([
    { collection: "pages", slug: "home", locale: "en", file: "pages/home.md" },
    {
      collection: "pages",
      slug: "home",
      locale: "en",
      file: "pages/home-copy.md",
    },
  ]);
  equal(issues.length, 1, "one issue");
  assert(issues[0]!.message.includes("pages/home@en"), "names the identity");
  assert(issues[0]!.message.includes("home-copy.md"), "and BOTH files");
  assert(issues[0]!.message.includes("home.md"), "not just the loser");
});

check("the same slug in two LOCALES is two identities", () => {
  // A translation cluster shares one untranslated slug by design. If this were
  // a collision the kit could not model translations at all.
  assert(
    oneEntityPerIdentity([
      { collection: "pages", slug: "about", locale: "en" },
      { collection: "pages", slug: "about", locale: "pt-BR" },
      { collection: "pages", slug: "about", locale: "zh-Hans" },
    ]),
    "three locales, three identities",
  );
});

check("A REGIONAL LOCALE DOES NOT COLLAPSE INTO ITS LANGUAGE", () => {
  // `en` and `en-GB` are different entities. A normalisation that dropped the
  // region — the old `/^[a-z]{2}$/` shape of this kit — would merge them.
  assert(
    oneEntityPerIdentity([
      { collection: "pages", slug: "about", locale: "en" },
      { collection: "pages", slug: "about", locale: "en-GB" },
    ]),
    "distinct",
  );
  assert(
    entryId("pages", "about", "en") !== entryId("pages", "about", "en-GB"),
    "and their identities differ",
  );
});

check("the same slug in two COLLECTIONS is two identities", () => {
  assert(
    oneEntityPerIdentity([
      { collection: "posts", slug: "analyser", locale: "en" },
      { collection: "products", slug: "analyser", locale: "en" },
      { collection: "portfolio", slug: "analyser", locale: "en" },
    ]),
    "three collections, three identities",
  );
});

check("the same term slug in two TAXONOMIES is two identities", () => {
  // WordPress has allowed this since 4.1, so it is not a collision to detect —
  // it is a distinction to preserve.
  assert(
    rowId("product-categories", "laptops") !== rowId("product-tags", "laptops"),
    "distinct",
  );
});

console.log("\nInvariant 2 — a collection has exactly one owner");

check("A POST TYPE AND A TAXONOMY CANNOT SHARE A COLLECTION", () => {
  // Measured before this check: pointing a taxonomy at a post type's
  // collection failed only by ACCIDENT, with an ENOENT looking for a registry
  // file. Had that file existed, `content.config.ts`'s object spread would
  // have replaced the post type's entries without a word.
  const issues = collectionOwnershipIssues({
    postTypes: [TYPE],
    taxonomies: [{ ...TAX, collection: "products" }],
  });
  equal(issues.length, 1, "one issue");
  assert(
    issues[0]!.message.includes('postTypes["product"]'),
    "names one owner",
  );
  assert(
    issues[0]!.message.includes('taxonomies["product_cat"]'),
    "and the other",
  );
  assert(issues[0]!.message.includes("object spread"), "and why it matters");
});

check("a custom collection cannot take a core one's name", () => {
  for (const core of CORE_COLLECTIONS) {
    const issues = collectionOwnershipIssues({
      postTypes: [{ ...TYPE, collection: core }],
      taxonomies: [],
    });
    equal(issues.length, 1, `"${core}" is defended`);
  }
});

check("two post types cannot share a collection", () => {
  const issues = collectionOwnershipIssues({
    postTypes: [TYPE, { ...TYPE, name: "portfolio" }],
    taxonomies: [],
  });
  equal(issues.length, 1, "reported");
});

check("the kit's own configuration owns each collection once", () => {
  // The invariant applied to the shipped config, so a fixture added later
  // cannot quietly contest something.
  equal(
    collectionOwnershipIssues({
      postTypes: [
        TYPE,
        { ...TYPE, name: "portfolio", collection: "portfolio" },
      ],
      taxonomies: [TAX],
    }).length,
    0,
    "no contest",
  );
});

console.log("\nInvariant 3 — a route has exactly one claimant");

check("A CPT AND A TAXONOMY CANNOT CLAIM ONE ROUTE", () => {
  const message = threw(() =>
    resolve(
      [{ ...TYPE, permalink: "/x/%postname%/" }],
      { products: [entry("laptops")] },
      [
        {
          ...TAX,
          permalink: "/x/%term%/",
          urlHierarchy: false,
          hierarchical: false,
        },
      ],
      { "product-categories": [{ slug: "laptops", name: { en: "Laptops" } }] },
    ),
  );
  assert(message.includes("Two routes claim"), `reported: ${message}`);
});

check("two CPTs cannot claim one route", () => {
  const message = threw(() =>
    resolve(
      [
        { ...TYPE, name: "a", collection: "aa", permalink: "/x/%postname%/" },
        { ...TYPE, name: "b", collection: "bb", permalink: "/x/%postname%/" },
      ],
      { aa: [entry("one")], bb: [entry("one")] },
    ),
  );
  assert(message.includes("Two routes claim"), `reported: ${message}`);
});

check("TWO TAXONOMIES CANNOT CLAIM ONE ROUTE", () => {
  const message = threw(() =>
    resolve(
      [TYPE],
      {},
      [
        {
          ...TAX,
          name: "a",
          collection: "ta",
          permalink: "/t/%term%/",
          urlHierarchy: false,
          hierarchical: false,
        },
        {
          ...TAX,
          name: "b",
          collection: "tb",
          permalink: "/t/%term%/",
          urlHierarchy: false,
          hierarchical: false,
        },
      ],
      {
        ta: [{ slug: "shoes", name: { en: "Shoes" } }],
        tb: [{ slug: "shoes", name: { en: "Shoes" } }],
      },
    ),
  );
  assert(message.includes("Two routes claim"), `reported: ${message}`);
});

check("a CPT cannot claim the posts index", () => {
  const message = threw(() =>
    resolve([{ ...TYPE, permalink: "/blog/%postname%/" }], {
      products: [entry("")],
    }),
  );
  assert(message.length > 0, "something refuses it");
});

check("the invariant holds for a healthy route table", () => {
  const table = resolve([TYPE], { products: [entry("a"), entry("b")] });
  assert(
    oneClaimantPerRoute(table.routes.map((route) => route.path)),
    "no duplicate paths",
  );
});

console.log("\nInvariant 4 — an output has exactly one claimant");

check("duplicate output paths are detected", () => {
  assert(
    !oneClaimantPerOutput(["a/index.html", "a/index.html"]),
    "a repeated file is a contest",
  );
  assert(
    oneClaimantPerOutput(["a/index.html", "b/index.html"]),
    "distinct files are not",
  );
});

check("TWO ROUTES NORMALISING TO ONE FILE ARE DETECTED", () => {
  // `/about` and `/about/` are one page on disk. The route key normalises the
  // trailing slash, so this is caught as a route collision rather than
  // producing two inventory rows pointing at one file.
  assert(!oneClaimantPerRoute(["/about", "/about/"]), "reported");
});

console.log("\nDefence in depth — the gate no longer deduplicates");

/** Provenance for a fixture: enough to be valid, never the thing under test. */
const authored = (local: string, locale?: string): Provenance => ({
  local,
  origin: "authored",
  collection: local.split("/")[0]!,
  ...(locale === undefined ? {} : { locale }),
});

const baseIntended: IntendedContent[] = [
  {
    id: "pages/home@en",
    expectedRoute: "/",
    provenance: authored("pages/home@en", "en"),
  },
  {
    id: "products/analyser@en",
    expectedRoute: "/products/analyser/",
    provenance: authored("products/analyser@en", "en"),
  },
];
const baseEmitted: EmittedRoute[] = [
  { path: "/", file: "index.html", origin: "static", entry: "pages/home@en" },
  {
    path: "/products/analyser",
    file: "products/analyser/index.html",
    origin: "custom",
    entry: "products/analyser@en",
  },
];
const baseFiles = new Set(baseEmitted.map((route) => route.file));

check("TWO INTENDED ENTRIES WITH ONE IDENTITY ARE REPORTED", () => {
  // This gate joins through a Map and a Set, and both deduplicate. Before this
  // check, two intended entries with one identity collapsed to one key,
  // matched the one emitted route, and reported ZERO findings.
  const report = checkContentIntegrity({
    intended: [
      ...baseIntended,
      {
        id: "pages/home@en",
        expectedRoute: "/",
        provenance: authored("pages/home@en", "en"),
      },
    ],
    emitted: baseEmitted,
    exclusions: [],
    filesInDist: baseFiles,
  });
  const found = findingsOfKind(report.findings, "IDENTITY_CONTESTED");
  equal(found.length, 1, "one finding");
  equal(found[0]!.subject, "pages/home@en", "named");
  assert(found[0]!.detail.includes("2 intended"), "and counted");
});

check("ONE ENTITY PUBLISHED AT TWO PATHS IS REPORTED", () => {
  const report = checkContentIntegrity({
    intended: baseIntended,
    emitted: [
      ...baseEmitted,
      {
        path: "/shop/analyser",
        file: "shop/analyser/index.html",
        origin: "custom",
        entry: "products/analyser@en",
      },
    ],
    exclusions: [],
    filesInDist: new Set([...baseFiles, "shop/analyser/index.html"]),
  });
  const found = findingsOfKind(report.findings, "IDENTITY_CONTESTED");
  equal(found.length, 1, "one finding");
  assert(found[0]!.detail.includes("2 paths"), `counted: ${found[0]!.detail}`);
});

check("a paginated listing spanning several paths is NOT a contest", () => {
  // The distinction that makes the check above usable: an archive
  // legitimately spans pages and shares one identity.
  const report = checkContentIntegrity({
    intended: [
      {
        id: "product-categories/laptops",
        provenance: authored("product-categories/laptops"),
      },
    ],
    emitted: [
      {
        path: "/product-category/laptops",
        file: "product-category/laptops/index.html",
        origin: "taxonomy-archive",
        entry: "product-categories/laptops",
      },
      {
        path: "/product-category/laptops/page/2",
        file: "product-category/laptops/page/2/index.html",
        origin: "pagination",
        entry: "product-categories/laptops",
      },
    ],
    exclusions: [],
    filesInDist: new Set([
      "product-category/laptops/index.html",
      "product-category/laptops/page/2/index.html",
    ]),
  });
  equal(report.findings.length, 0, "no findings");
});

check("the healthy case still reports nothing", () => {
  const report = checkContentIntegrity({
    intended: baseIntended,
    emitted: baseEmitted,
    exclusions: [],
    filesInDist: baseFiles,
  });
  equal(report.findings.length, 0, "clean");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nIdentity suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Identity suite OK\n");
