// Custom taxonomies — the suite.
//
// The rules under test are WordPress's, measured on 2026-09-08 from core
// (`wp-includes/taxonomy.php`, the REST controllers) and confirmed against a
// live install. Each block says which measurement it encodes, because the
// whole point is that none of this was inferred from a naming convention.
//
// The profiles are synthetic. `product_cat` and `product_tag` are the two most
// ordinary shapes — one hierarchical in both senses, one flat in both — and
// naming them is naming a shape, not a vendor.
import process from "node:process";

import {
  TAXONOMY_TOKENS,
  taxonomyProblems,
  taxonomyProfileProblems,
  termPath,
} from "../../../apps/website/src/routing/permalink.ts";
import {
  resolveSiteRoutes,
  type CustomEntryData,
  type EntryLike,
  type PageEntryData,
  type PostEntryData,
  type TaxonomyTermRow,
} from "../../../apps/website/src/routing/resolver.ts";
import { identityOf } from "../../../apps/website/src/routing/route-identity.ts";
import { rowId } from "../../../apps/website/src/deployment/content-identity.ts";
import {
  classifyTaxonomies,
  taxonomiesOfCapability,
} from "../../custom-types/capability.ts";
import { termDescription } from "../../../apps/website/src/rendering/archive-description.ts";
import { META_DESCRIPTION_MIN } from "../../../apps/website/src/rendering/head-model.ts";
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
const TYPE: PostTypeProfile = {
  name: "product",
  collection: "products",
  restBase: "product",
  permalink: "/products/%postname%/",
  published: true,
  archive: { kind: "none" },
  taxonomies: { attached: [], archives: false },
};

const taxonomy = (
  overrides: Partial<TaxonomyProfile> = {},
): TaxonomyProfile => ({
  name: "product_cat",
  label: "Product category",
  collection: "product-categories",
  restBase: "product_cat",
  appliesTo: ["products"],
  published: true,
  permalink: "/product-category/%term%/",
  urlHierarchy: true,
  hierarchical: true,
  ...overrides,
});

const term = (slug: string, parent?: string, name = slug): TaxonomyTermRow => ({
  slug,
  ...(parent === undefined ? {} : { parent }),
  name: { en: name },
});

type Entry = EntryLike<CustomEntryData> & { data: CustomEntryData };

const entry = (slug: string, terms: Record<string, string[]> = {}): Entry => ({
  data: {
    slug,
    title: slug,
    locale: "en",
    updatedAt: "2026-01-15",
    publishedAt: "2026-01-10",
    terms,
  } as CustomEntryData,
  body: "",
});

const resolve = (
  taxonomies: readonly TaxonomyProfile[],
  terms: Record<string, readonly TaxonomyTermRow[]>,
  custom: Record<string, readonly Entry[]> = {},
  postTypes: readonly PostTypeProfile[] = [TYPE],
  locale = "en",
) =>
  resolveSiteRoutes<EntryLike<PostEntryData>, EntryLike<PageEntryData>, Entry>({
    posts: [],
    pages: [],
    authors: [],
    categories: [],
    tags: [],
    custom,
    postTypes,
    terms,
    taxonomies,
    locale,
  });

const termRoutes = <T extends { kind: string }>(routes: readonly T[]) =>
  routes.filter((route) => route.kind === "taxonomy-archive");

console.log("\nPermalinks: one token, because WordPress expands one");

check("A TAXONOMY PATTERN TAKES %term% AND NOTHING ELSE", () => {
  // Measured: `get_term_link()` builds `<base>/%<taxonomy>%` and replaces that
  // single token with either the slug or the ancestor path.
  equal(TAXONOMY_TOKENS.length, 1, "one token");
  equal(TAXONOMY_TOKENS[0], "term", "and it is %term%");
  equal(taxonomyProblems(taxonomy()).length, 0, "the ordinary profile is fine");
});

check("A %parent% TOKEN IS REFUSED, AND POINTS AT THE RIGHT KNOB", () => {
  // Plausible, and wrong. Ancestors are a FLAG in WordPress, not a token, and
  // inventing one would let a profile describe a URL shape core cannot make.
  const problems = taxonomyProblems(
    taxonomy({ permalink: "/product-category/%parent%/%term%/" }),
  );
  equal(problems.length, 1, "one problem");
  assert(problems[0]!.includes("%parent%"), "names the token");
  assert(
    problems[0]!.includes("urlHierarchy"),
    `and names the flag instead: ${problems[0]}`,
  );
});

check("a pattern with no %term% is refused", () => {
  assert(
    taxonomyProblems(taxonomy({ permalink: "/product-category/" })).some(
      (one) => one.includes("%term%"),
    ),
    "every term would share one URL",
  );
});

check("THE URL PREFIX IS NOT THE TAXONOMY NAME", () => {
  // Measured on a live install: the taxonomy `doc_category` serves its terms at
  // `/docs-category/`. REST reports no rewrite at all, so the prefix can only
  // be configuration — this asserts the kit uses the configured one verbatim.
  equal(
    termPath(taxonomy({ permalink: "/anything-at-all/%term%/" }), "shoes"),
    "/anything-at-all/shoes/",
    "the configured prefix, used as written",
  );
});

console.log("\nHierarchy is two questions, not one");

check("URL HIERARCHY IS SEPARATE FROM DATA HIERARCHY", () => {
  // The measurement that matters most here. `get_term_link()` includes
  // ancestors only when `rewrite['hierarchical']` is true, and
  // `register_taxonomy` sets that independently of `hierarchical`. A kit that
  // conflated them would publish `/c/electronics/laptops/` for a site serving
  // `/c/laptops/`, or the reverse.
  const withPath = taxonomy({ urlHierarchy: true });
  const flatPath = taxonomy({ urlHierarchy: false });
  equal(
    termPath(withPath, "laptops", ["electronics"]),
    "/product-category/electronics/laptops/",
    "ancestors in the URL",
  );
  equal(
    termPath(flatPath, "laptops", ["electronics"]),
    "/product-category/laptops/",
    "same data, flat URL",
  );
});

check("urlHierarchy without hierarchical is refused", () => {
  // A URL shape describing a hierarchy the data does not have.
  assert(
    taxonomyProblems(
      taxonomy({ urlHierarchy: true, hierarchical: false }),
    ).some((one) => one.includes("urlHierarchy")),
    "reported",
  );
});

check("A PARENT ON A FLAT TAXONOMY IS AN ERROR", () => {
  // WordPress refuses it too — `rest_taxonomy_not_hierarchical`. Ignoring it
  // silently would file a term somewhere the source did not.
  const message = threw(() =>
    resolve([taxonomy({ hierarchical: false, urlHierarchy: false })], {
      "product-categories": [term("laptops", "electronics")],
    }),
  );
  assert(message.includes("not hierarchical"), `by name: ${message}`);
});

check("root, child and grandchild each get their own path", () => {
  const table = resolve([taxonomy()], {
    "product-categories": [
      term("electronics"),
      term("laptops", "electronics"),
      term("gaming", "laptops"),
    ],
  });
  const paths = termRoutes(table.routes).map((route) => route.path);
  assert(paths.includes("/product-category/electronics/"), "root");
  assert(paths.includes("/product-category/electronics/laptops/"), "child");
  assert(
    paths.includes("/product-category/electronics/laptops/gaming/"),
    `grandchild: ${JSON.stringify(paths)}`,
  );
});

check("SIBLINGS UNDER DIFFERENT PARENTS DO NOT COLLIDE", () => {
  // Note the slugs. WordPress does NOT allow two `laptops` in one taxonomy —
  // `wp_unique_term_slug()` appends a parent suffix or a number — so the real
  // shape of this case is two distinct slugs under two parents, and what has
  // to hold is that their PATHS stay distinct.
  const table = resolve([taxonomy()], {
    "product-categories": [
      term("electronics"),
      term("furniture"),
      term("laptops", "electronics"),
      term("laptops-furniture", "furniture"),
    ],
  });
  const paths = termRoutes(table.routes).map((route) => route.path);
  assert(paths.includes("/product-category/electronics/laptops/"), "one");
  assert(
    paths.includes("/product-category/furniture/laptops-furniture/"),
    "and the other, under its own parent",
  );
  equal(new Set(paths).size, paths.length, "no duplicates");
});

check("TWO TERMS WITH ONE SLUG IN ONE TAXONOMY IS AN ERROR", () => {
  // Measured: `wp_unique_term_slug()` refuses a slug that already exists in the
  // same taxonomy. Two here would share one URL, so the kit refuses it rather
  // than inventing a disambiguation WordPress does not have.
  const message = threw(() =>
    resolve([taxonomy()], {
      "product-categories": [
        term("electronics"),
        term("furniture"),
        term("laptops", "electronics"),
        term("laptops", "furniture"),
      ],
    }),
  );
  assert(message.includes("two terms with slug"), `reported: ${message}`);
  assert(message.includes("wp_unique_term_slug"), "citing the rule");
});

check("an unknown parent is an error, not a silent root", () => {
  const message = threw(() =>
    resolve([taxonomy()], {
      "product-categories": [term("laptops", "nowhere")],
    }),
  );
  assert(message.includes("not a term of that taxonomy"), `named: ${message}`);
});

check("a parent cycle is an error", () => {
  const message = threw(() =>
    resolve([taxonomy()], {
      "product-categories": [term("a", "b"), term("b", "a")],
    }),
  );
  assert(message.includes("loops through"), `named: ${message}`);
});

console.log("\nA flat taxonomy is flat");

check("A NON-HIERARCHICAL TAXONOMY PRODUCES FLAT TERM ROUTES", () => {
  const flat = taxonomy({
    name: "product_tag",
    label: "Product tag",
    collection: "product-tags",
    permalink: "/product-tag/%term%/",
    hierarchical: false,
    urlHierarchy: false,
  });
  const table = resolve([flat], {
    "product-tags": [term("featured"), term("sale")],
  });
  const paths = termRoutes(table.routes)
    .map((route) => route.path)
    .sort();
  equal(paths.length, 2, "two");
  equal(paths[0], "/product-tag/featured/", "first");
  equal(paths[1], "/product-tag/sale/", "second");
});

console.log("\nIdentity: the taxonomy namespaces the slug");

check("THE SAME SLUG IN TWO TAXONOMIES IS TWO IDENTITIES", () => {
  // Measured: duplicates ACROSS taxonomies have been allowed since WordPress
  // 4.1. So `laptops` can be both a category and a tag, and the identity has
  // to survive that — the collection is the namespace.
  const cat = rowId("product-categories", "laptops");
  const tag = rowId("product-tags", "laptops");
  assert(cat !== tag, "distinct identities");
  equal(cat, "product-categories/laptops", "the category");
  equal(tag, "product-tags/laptops", "the tag");
});

check("a routed term's identity is its registry row", () => {
  const table = resolve([taxonomy()], {
    "product-categories": [term("electronics")],
  });
  equal(
    identityOf(termRoutes(table.routes)[0]!),
    "product-categories/electronics",
    "identity",
  );
});

check("BOTH TAXONOMIES' `laptops` ROUTE, AT DIFFERENT PATHS", () => {
  const flat = taxonomy({
    name: "product_tag",
    label: "Product tag",
    collection: "product-tags",
    permalink: "/product-tag/%term%/",
    hierarchical: false,
    urlHierarchy: false,
  });
  const table = resolve([taxonomy(), flat], {
    "product-categories": [term("electronics"), term("laptops", "electronics")],
    "product-tags": [term("laptops")],
  });
  const paths = termRoutes(table.routes).map((route) => route.path);
  assert(paths.includes("/product-category/electronics/laptops/"), "the term");
  assert(paths.includes("/product-tag/laptops/"), "and the tag");
  equal(new Set(paths).size, paths.length, "no collision");
});

console.log("\nThe taxonomy → post type relationship");

check("ONE TAXONOMY OVER TWO COLLECTIONS LISTS BOTH", () => {
  // WordPress attaches one taxonomy to any number of types — measured on a
  // live install, two custom taxonomies shared one custom type. Silently
  // picking one collection would drop half of every archive.
  const second: PostTypeProfile = {
    ...TYPE,
    name: "bundle",
    collection: "bundles",
    permalink: "/bundles/%postname%/",
  };
  const table = resolve(
    [taxonomy({ appliesTo: ["products", "bundles"] })],
    { "product-categories": [term("featured")] },
    {
      products: [entry("a", { product_cat: ["featured"] })],
      bundles: [entry("b", { product_cat: ["featured"] })],
    },
    [TYPE, second],
  );
  const archive = termRoutes(table.routes)[0]!;
  equal(archive.page.total, 2, "entries from both collections");
  equal(archive.collections.length, 2, "and the route says where from");
});

check("A TAXONOMY FILING AN UNPUBLISHED TYPE IS REFUSED", () => {
  const problems = taxonomyProfileProblems(
    [taxonomy()],
    [{ ...TYPE, published: false }],
  );
  assert(
    problems.some((one) => one.includes("would list pages that do not exist")),
    "reported",
  );
});

check("appliesTo naming a collection nobody declares is refused", () => {
  const problems = taxonomyProfileProblems(
    [taxonomy({ appliesTo: ["widgets"] })],
    [TYPE],
  );
  assert(
    problems.some((one) => one.includes('"widgets"')),
    "named",
  );
});

check("a core taxonomy cannot be reconfigured here", () => {
  const problems = taxonomyProfileProblems(
    [taxonomy({ name: "category" })],
    [TYPE],
  );
  assert(
    problems.some((one) => one.includes("core taxonomies")),
    "reported",
  );
});

check("two taxonomies cannot share one registry", () => {
  const problems = taxonomyProfileProblems(
    [taxonomy(), taxonomy({ name: "product_tag" })],
    [TYPE],
  );
  assert(
    problems.some((one) => one.includes("both use")),
    "reported",
  );
});

console.log("\nArchive behaviour is declared, never assumed");

check("A STORED-ONLY TAXONOMY PRODUCES NO ROUTES", () => {
  const table = resolve([taxonomy({ published: false })], {
    "product-categories": [term("electronics")],
  });
  equal(termRoutes(table.routes).length, 0, "no term archives");
  equal(table.terms["product-categories"]?.length, 0, "and nothing routed");
});

check("an unsupported profile stops the build before any route exists", () => {
  const message = threw(() =>
    resolve([taxonomy({ permalink: "/c/%parent%/" })], {
      "product-categories": [term("electronics")],
    }),
  );
  assert(message.includes("taxonomies are not usable"), "it throws");
  assert(message.includes("%parent%"), `naming the token: ${message}`);
});

console.log("\nDiscovery: an unconfigured taxonomy is a decision waiting");

const restTax = (
  name: string,
  types: string[],
  hierarchical = true,
): {
  name: string;
  label: string;
  restBase: string;
  types: string[];
  hierarchical: boolean;
} => ({
  name,
  label: name,
  restBase: name,
  types,
  hierarchical,
});

check("REST-DISCOVERED WITH NO PROFILE IS `unconfigured`", () => {
  const rows = classifyTaxonomies(
    [
      restTax("category", ["post"]),
      restTax("nav_menu", ["nav_menu_item"], false),
      restTax("product_cat", ["product"]),
    ],
    [],
    [TYPE],
  );
  equal(taxonomiesOfCapability(rows, "unconfigured").length, 1, "one");
  equal(
    taxonomiesOfCapability(rows, "unconfigured")[0]!.taxonomy.name,
    "product_cat",
    "named",
  );
  equal(taxonomiesOfCapability(rows, "core").length, 1, "core is core");
  equal(
    taxonomiesOfCapability(rows, "internal").length,
    1,
    "menus are not content",
  );
});

check("configured and stored-only are distinguished", () => {
  const rows = classifyTaxonomies(
    [restTax("product_cat", ["product"]), restTax("product_tag", ["product"])],
    [
      taxonomy(),
      taxonomy({ name: "product_tag", collection: "t", published: false }),
    ],
    [TYPE],
  );
  equal(taxonomiesOfCapability(rows, "configured").length, 1, "one configured");
  equal(taxonomiesOfCapability(rows, "withheld").length, 1, "one stored only");
});

check("A CONFIGURED TAXONOMY ON AN UNPUBLISHED TYPE IS FLAGGED", () => {
  // The quieter failure: the profile looks complete and every archive is empty.
  const rows = classifyTaxonomies(
    [restTax("product_cat", ["product", "bundle"])],
    [taxonomy()],
    [TYPE],
  );
  equal(rows[0]!.capability, "configured", "configured");
  equal(
    rows[0]!.unroutableTypes.length,
    1,
    "one type has no published profile",
  );
  equal(rows[0]!.unroutableTypes[0], "bundle", "named");
});

console.log("\nTerm descriptions clear the SEO floor");

check("A SHORT TERM DESCRIPTION FALLS BACK RATHER THAN SHIPPING", () => {
  // Measured on this kit's own fixtures: a 44-character description against a
  // floor of 50, which `seo:audit` failed. A migrated description is whatever
  // somebody typed into WordPress; padding it would be writing copy.
  const short = "Portable computers, filed under electronics.";
  assert(short.length < META_DESCRIPTION_MIN, "the fixture really is short");
  const chosen = termDescription(short, {
    title: "Laptops",
    siteName: "Example Site",
    taxonomyLabel: "Product category",
  });
  assert(chosen !== short, "it is not used");
  assert(chosen.length >= META_DESCRIPTION_MIN, "and the fallback clears it");
});

check("a long enough description is kept verbatim", () => {
  const own =
    "Portable computers, chargers and the bags they travel in, filed under electronics.";
  equal(
    termDescription(own, { title: "T", siteName: "S", taxonomyLabel: "L" }),
    own,
    "the page's own words win",
  );
});

check("TWO TAXONOMIES' SAME-NAMED TERMS GET DIFFERENT DESCRIPTIONS", () => {
  // WordPress allows one term name in two taxonomies, and without the label
  // both archives wrote one sentence — a duplicate `seo:audit` failed on.
  const asCategory = termDescription(undefined, {
    title: "Laptops",
    siteName: "S",
    taxonomyLabel: "Product category",
  });
  const asTag = termDescription(undefined, {
    title: "Laptops",
    siteName: "S",
    taxonomyLabel: "Product tag",
  });
  assert(asCategory !== asTag, "distinct");
});

console.log("\nLocale");

check("A TERM CARRIES A NAME PER LOCALE, NOT ONE ROW PER LOCALE", () => {
  // The same shape as `categories.json`. A term is one thing named in each
  // language, so locale filtering cannot make a term disappear — which is what
  // keeps them all in the intended inventory.
  const rows: TaxonomyTermRow[] = [
    {
      slug: "electronics",
      name: { en: "Electronics", "pt-BR": "Eletrônicos" },
    },
  ];
  const en = resolve(
    [taxonomy()],
    { "product-categories": rows },
    {},
    [TYPE],
    "en",
  );
  const pt = resolve(
    [taxonomy()],
    { "product-categories": rows },
    {},
    [TYPE],
    "pt-BR",
  );
  equal(termRoutes(en.routes).length, 1, "routed in en");
  equal(
    termRoutes(pt.routes).length,
    1,
    "and in pt-BR — the term does not vanish",
  );
  equal(termRoutes(en.routes)[0]!.title, "Electronics", "named in en");
  equal(termRoutes(pt.routes)[0]!.title, "Eletrônicos", "and in pt-BR");
  equal(
    termRoutes(en.routes)[0]!.path,
    termRoutes(pt.routes)[0]!.path,
    "at ONE path — the kit has no locale-specific taxonomy URLs, and does not pretend to",
  );
});

check(
  "a term named only in another locale still routes, titled by its slug's name",
  () => {
    const rows: TaxonomyTermRow[] = [
      { slug: "eletronicos", name: { "pt-BR": "Eletrônicos" } },
    ];
    const table = resolve(
      [taxonomy()],
      { "product-categories": rows },
      {},
      [TYPE],
      "en",
    );
    equal(termRoutes(table.routes).length, 1, "still routed");
    equal(
      termRoutes(table.routes)[0]!.title,
      "Eletrônicos",
      "falling back to the name it has, not to a blank",
    );
  },
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nTaxonomy suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Taxonomy suite OK\n");
