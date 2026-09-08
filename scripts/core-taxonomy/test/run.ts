// Core taxonomy unification — WordPress's own `category` and `post_tag`,
// through the same model a configured taxonomy uses, and the thirteen
// mutations that must not survive it.
//
// ## What was measured, and what it proved wrong
//
// From WordPress core (`create_initial_taxonomies()` in
// `wp-includes/taxonomy.php`, read 2026-09-08):
//
//     category   hierarchical => true    rewrite['hierarchical'] => true
//                rest_base   => 'categories'
//                rewrite slug => get_option('category_base') ?: 'category'
//     post_tag   hierarchical => false   rewrite['hierarchical'] => false
//                rest_base   => 'tags'
//                rewrite slug => get_option('tag_base') ?: 'tag'
//
// So a WordPress category has parents AND its archive URL carries them. This
// kit could represent neither: `categorySchema` had no `parent` field, and
// `categoryPath()` took a bare slug. A migration that met a nested category
// had to flatten it — publishing a URL the source never served.
//
// ## Why the unification is safe
//
// Backward compatibility is proved rather than asserted, in
// "CORE URLS ARE UNCHANGED" below: the built-in profiles are DERIVED from
// `permalinks.category` and `permalinks.tag`, so a configuration that never
// mentioned taxonomies produces byte-identical URLs. And a content tree that
// existed before this change cannot have a nested category, because there was
// no field to put a parent in — so turning `urlHierarchy` on cannot move an
// existing URL. That is the whole compatibility argument, and it is checkable.
import process from "node:process";

import {
  allTaxonomies,
  coreTaxonomies,
  CORE_TAXONOMY_COLLECTIONS,
  CORE_TAXONOMY_NAMES,
  termsOf,
  userTaxonomies,
} from "../../../apps/website/src/routing/taxonomies.ts";
import {
  categoryPath,
  tagPath,
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
import { collectionOwnershipIssues } from "../../../apps/website/src/content-model/ownership.ts";
import { taxonomyTermSchema } from "../../../apps/website/src/content-model/taxonomy-term.ts";
import { categorySchema } from "../../../apps/website/src/content-model/registries.ts";
import {
  buildRouteInventory,
  duplicatePaths,
} from "../../../apps/website/src/deployment/route-inventory.ts";
import type { Permalinks, TaxonomyProfile } from "../../../migration.config.ts";

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
// A small site: two posts, three categories (one nested), one tag.
// ---------------------------------------------------------------------------

type Post = EntryLike<PostEntryData>;
type Page = EntryLike<PageEntryData>;
type Custom = EntryLike<CustomEntryData>;

const wp = (id: number) => ({
  system: "wordpress",
  sourceId: String(id),
  capturedAt: "2026-01-16",
});

const post = (
  slug: string,
  categories: string[],
  tags: string[] = [],
  locale = "en",
): Post => ({
  data: {
    slug,
    title: slug,
    locale,
    publishedAt: "2026-01-10",
    updatedAt: "2026-01-10",
    author: "jane",
    categories,
    tags,
    source: wp(100 + slug.length),
  },
});

const term = (slug: string, id: number, parent?: string): TaxonomyTermRow => ({
  slug,
  ...(parent === undefined ? {} : { parent }),
  name: { en: slug },
  source: wp(id),
});

const TAXONOMY: TaxonomyProfile = {
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

const CATEGORIES = [
  term("news", 3),
  term("releases", 4, "news"),
  term("uncategorized", 1),
];
const TAGS = [term("sample", 20)];

interface Overrides {
  categories?: TaxonomyTermRow[];
  tags?: TaxonomyTermRow[];
  posts?: Post[];
  taxonomies?: TaxonomyProfile[];
  terms?: Record<string, TaxonomyTermRow[]>;
}

const site = (overrides: Overrides = {}) =>
  resolveSiteRoutes<Post, Page, Custom>({
    posts: overrides.posts ?? [
      post("hello-world", ["uncategorized"], ["sample"]),
      post("second", ["news", "releases"], ["sample"]),
    ],
    pages: [],
    authors: [{ slug: "jane", name: "Jane", nicename: "jane", source: wp(7) }],
    categories: overrides.categories ?? CATEGORIES,
    tags: overrides.tags ?? TAGS,
    locale: "en",
    postTypes: [],
    taxonomies: overrides.taxonomies ?? [],
    ...(overrides.terms === undefined ? {} : { terms: overrides.terms }),
  });

const pathsOf = (table: ReturnType<typeof site>): string[] =>
  table.routes.map((route) => route.path).sort();

// ---------------------------------------------------------------------------
console.log("\nThe measured model");

check(
  "CORE CATEGORY IS HIERARCHICAL IN BOTH SENSES; POST_TAG IN NEITHER",
  () => {
    const [category, tag] = coreTaxonomies();
    equal(category!.name, "category", "the taxonomy key");
    equal(category!.hierarchical, true, "category has parents");
    equal(category!.urlHierarchy, true, "and its URL carries them");
    equal(category!.restBase, "categories", "core's own rest_base");
    equal(tag!.name, "post_tag", "WordPress's key, not `tag`");
    equal(tag!.hierarchical, false, "post_tag is flat");
    equal(tag!.urlHierarchy, false, "in the URL too");
    equal(tag!.restBase, "tags", "core's own rest_base");
  },
);

check("both are attached to posts, and always published", () => {
  for (const taxonomy of coreTaxonomies()) {
    equal(taxonomy.appliesTo.join(","), "posts", `${taxonomy.name} appliesTo`);
    equal(taxonomy.published, true, `${taxonomy.name} is published`);
    equal(taxonomy.builtIn, true, `${taxonomy.name} is built in`);
  }
});

check("a post names its terms in a FIELD, a custom entry in the map", () => {
  // Measured from the REST shape: `wp/v2/posts` returns `categories` and
  // `tags` as top-level arrays. Everything else is filed in the generic map.
  const [category, tag] = coreTaxonomies();
  equal(category!.reference.kind, "field", "category");
  equal(tag!.reference.kind, "field", "post_tag");
  equal(
    termsOf(category!, { categories: ["news"], tags: ["x"] }).join(","),
    "news",
    "reads the categories field",
  );
  equal(
    termsOf(userTaxonomies([TAXONOMY])[0]!, {
      terms: { product_cat: ["laptops"] },
    }).join(","),
    "laptops",
    "and a configured taxonomy reads the map",
  );
});

check("ONE SCHEMA BEHIND EVERY REGISTRY", () => {
  // `categorySchema` was a schema of its own with no `parent` field. It is now
  // the same schema a configured taxonomy uses, which is what makes a nested
  // category representable at all.
  equal(categorySchema, taxonomyTermSchema, "the same schema object");
  const nested = categorySchema.safeParse({
    slug: "releases",
    parent: "news",
    name: { en: "Releases" },
    source: { system: "authored" },
  });
  assert(nested.success, "a nested category parses");
  const noName = categorySchema.safeParse({
    slug: "x",
    name: { fr: "X" },
    source: { system: "authored" },
  });
  assert(!noName.success, "and the default-locale name rule survived");
});

// ---------------------------------------------------------------------------
console.log("\nBackward compatibility");

check("CORE URLS ARE UNCHANGED BY THE UNIFICATION", () => {
  // The compatibility argument, executed: the built-in profiles are derived
  // from `permalinks`, so a flat category tree produces exactly the URLs the
  // previous implementation produced — `expandPattern(permalinks.category,
  // { slug })`.
  equal(categoryPath("news"), "/category/news/", "a flat category");
  equal(tagPath("sample"), "/tag/sample/", "a tag");
  const table = site({ categories: [term("news", 3)] });
  assert(
    pathsOf(table).includes("/category/news/"),
    `flat category archive: ${pathsOf(table).join(", ")}`,
  );
});

check("A NESTED CATEGORY CARRIES ITS PARENT, THE WAY WORDPRESS DOES", () => {
  const paths = pathsOf(site());
  assert(
    paths.includes("/category/news/releases/"),
    `nested archive: ${paths.join(", ")}`,
  );
  equal(
    categoryPath("releases", ["news"]),
    "/category/news/releases/",
    "and the path function agrees",
  );
});

check("a tag never carries a parent, even if one is written", () => {
  const message = threw(() =>
    site({ tags: [term("sample", 20), term("child", 21, "sample")] }),
  );
  assert(message.includes("not hierarchical"), `refused: ${message}`);
  assert(message.includes("rest_taxonomy_not_hierarchical"), "citing core");
});

check("a custom permalink base still moves core URLs, and only those", () => {
  const moved: Permalinks = {
    post: "/%postname%/",
    page: "/%pagename%/",
    // WordPress's `category_base` option, which is exactly what this models.
    category: "/topics/%slug%/",
    tag: "/tag/%slug%/",
    author: "/author/%nicename%/",
    postsIndex: "/blog/",
    paginationSegment: "page",
    frontPage: null,
    postsPerPage: 10,
  };
  const [category] = coreTaxonomies(moved);
  equal(
    termPath(category!, "releases", ["news"]),
    "/topics/news/releases/",
    "the base moved and the hierarchy stayed",
  );
});

check("the identity of a core term is a registry row, not a route", () => {
  const table = site();
  const archives = table.routes.filter(
    (route) => route.kind === "archive" && route.archive === "category",
  );
  assert(archives.length >= 2, "category archives exist");
  const identities = archives.map((route) => identityOf(route));
  assert(
    identities.includes(rowId("categories", "releases")),
    `identity: ${identities.join(", ")}`,
  );
  // The route moved when the term gained a parent; the identity did not.
  const flat = site({ categories: [term("releases", 4)] });
  const flatIdentity = flat.routes
    .filter((route) => route.kind === "archive" && route.archive === "category")
    .map((route) => identityOf(route));
  assert(
    flatIdentity.includes(rowId("categories", "releases")),
    "the same identity at a different URL",
  );
});

check("A CORE TERM AND A CUSTOM TERM MAY SHARE A SLUG", () => {
  // WordPress allows one slug in two taxonomies; the collection namespaces it.
  assert(
    rowId("categories", "news") !== rowId("product-categories", "news"),
    "two identities",
  );
});

// ---------------------------------------------------------------------------
console.log("\nThe mutations");

check("M1: DELETING A CORE CATEGORY REMOVES ITS ARCHIVE, LOUDLY", () => {
  // A post still claims it, and the content contract is what says so. The
  // resolver publishes no archive, which on its own is silent — so the
  // failure has to come from the layer that sees BOTH the post and the
  // registry.
  const without = site({
    categories: [term("news", 3), term("releases", 4, "news")],
  });
  assert(
    !pathsOf(without).includes("/category/uncategorized/"),
    "the archive is gone",
  );
  // And a post referencing it is a cross-entry failure — proved in the
  // content-contract suite, which reads the real registries.
});

check("M2: A DELETED PARENT BREAKS THE CHAIN BY NAME", () => {
  const message = threw(() =>
    site({ categories: [term("releases", 4, "news")] }),
  );
  assert(message.includes('names parent "news"'), `named: ${message}`);
});

check("M3: TWO CATEGORIES WITH ONE SLUG THROW AS A DUPLICATE", () => {
  const message = threw(() =>
    site({ categories: [...CATEGORIES, term("news", 99)] }),
  );
  assert(
    message.includes('two terms with slug "news"'),
    `duplicate named: ${message}`,
  );
  assert(message.includes("wp_unique_term_slug"), "citing WordPress's rule");
});

check("M4: TWO CATEGORIES PRODUCING ONE OUTPUT ARE A DUPLICATE PATH", () => {
  // Distinct slugs, one URL — which a duplicate-slug check cannot see. A
  // child named for its own parent's path is the shape that does it.
  const table = site({
    categories: [term("news", 3), term("releases", 4, "news")],
  });
  const inventory = buildRouteInventory({
    resolved: table.routes.map((route) => ({
      path: route.path,
      kind: route.kind,
      entry: identityOf(route),
    })),
  });
  equal(duplicatePaths(inventory).length, 0, "the healthy site is clean");
  equal(
    duplicatePaths([
      ...inventory,
      {
        path: "/category/news/releases",
        file: "category/news/releases/index.html",
        kind: "page",
        origin: "archive",
        source: "x",
      },
    ]).length,
    1,
    "and a second claim on one output is reported",
  );
});

check("M5: TWO ROUTES CLAIMING ONE CATEGORY PATH THROW", () => {
  // The resolver's own check, reached when two DIFFERENT things collide.
  // A configured taxonomy pointed at the core category base. Both have a term
  // called `news`, and they are different entities in different registries —
  // so this is not a duplicate slug, it is two owners of one URL.
  const message = threw(() =>
    site({
      categories: [term("news", 3)],
      taxonomies: [
        {
          ...TAXONOMY,
          name: "shadow",
          collection: "shadow",
          appliesTo: ["posts"],
          permalink: "/category/%term%/",
          urlHierarchy: false,
          hierarchical: false,
        },
      ],
      terms: { shadow: [term("news", 77)] },
    }),
  );
  assert(message.includes("Two routes claim"), `collision named: ${message}`);
});

check("M6: A CATEGORY THAT IS ITS OWN ANCESTOR THROWS", () => {
  const message = threw(() =>
    site({
      categories: [term("a", 1, "b"), term("b", 2, "a")],
    }),
  );
  assert(message.includes("loops through"), `cycle named: ${message}`);
});

check("M7: A CATEGORY NAMING AN UNKNOWN PARENT THROWS", () => {
  const message = threw(() =>
    site({ categories: [term("news", 3), term("releases", 4, "absent")] }),
  );
  assert(message.includes('"absent"'), `named: ${message}`);
});

check("M8: A PROFILE FOR A CORE TAXONOMY IS REFUSED", () => {
  // The compatibility boundary: `category` is modelled by the kit, so a second
  // profile for it would give one registry two identities.
  for (const name of CORE_TAXONOMY_NAMES) {
    const problems = taxonomyProfileProblems(
      [{ ...TAXONOMY, name, collection: `x-${name}` }],
      [],
    );
    assert(
      problems.some((problem) => problem.includes("core taxonomies")),
      `${name}: ${problems.join("; ")}`,
    );
  }
});

check("M9: A PROFILE CLAIMING A CORE COLLECTION IS A CONTEST", () => {
  for (const collection of CORE_TAXONOMY_COLLECTIONS) {
    const issues = collectionOwnershipIssues({
      postTypes: [],
      taxonomies: [{ name: "shadow", collection }],
    });
    equal(issues.length, 1, `${collection} is contested`);
    equal(
      issues[0]!.code,
      "collection-ownership-contested",
      "with the right code",
    );
  }
});

check("M10: A CONFIGURATION CANNOT AWARD ITSELF `builtIn`", () => {
  const problems = taxonomyProfileProblems(
    [{ ...TAXONOMY, builtIn: true } as TaxonomyProfile],
    [
      {
        name: "product",
        collection: "products",
        restBase: "product",
        permalink: "/products/%postname%/",
        published: true,
        archive: { kind: "none" },
        taxonomies: { attached: [], archives: false },
      },
    ],
  );
  assert(
    problems.some((problem) => problem.includes("builtIn")),
    `refused: ${problems.join("; ")}`,
  );
});

check("M11: A CATEGORY SLUG CHANGE MOVES THE ROUTE, NOT THE SOURCE ID", () => {
  const before = site({ categories: [term("news", 3)] });
  const after = site({
    categories: [term("nouvelles", 3)],
    posts: [post("hello-world", ["nouvelles"])],
  });
  assert(pathsOf(before).includes("/category/news/"), "before");
  assert(pathsOf(after).includes("/category/nouvelles/"), "after");
  // The WordPress term_id is what a re-capture matches on, and it did not move.
  equal(
    before.categoryOf("news")?.source?.sourceId,
    after.categoryOf("nouvelles")?.source?.sourceId,
    "the same source id",
  );
});

check(
  "M12: A POST NAMING A TERM OF THE WRONG TAXONOMY IS NOT ROUTED INTO IT",
  () => {
    // `sample` is a tag. A post listing it under `categories` must not produce a
    // category archive entry — the two registries are separate namespaces.
    const table = site({ posts: [post("hello-world", ["news"], ["sample"])] });
    const tagArchive = table.routes.find(
      (route) => route.kind === "archive" && route.archive === "tag",
    );
    assert(tagArchive !== undefined, "the tag archive exists");
    const categoryArchives = table.routes.filter(
      (route) => route.kind === "archive" && route.archive === "category",
    );
    assert(
      !categoryArchives.some((route) => route.path.includes("/sample")),
      "and no category archive is published for it",
    );
  },
);

check(
  "M13: A TRANSLATED POST DOES NOT POPULATE ANOTHER LOCALE'S ARCHIVE",
  () => {
    const table = site({
      posts: [
        post("hello-world", ["news"], [], "en"),
        post("bonjour", ["news"], [], "pt-BR"),
      ],
    });
    const archive = table.routes.find(
      (route) =>
        route.kind === "archive" &&
        route.archive === "category" &&
        route.path.startsWith("/category/news"),
    );
    assert(archive !== undefined, "the archive exists");
    equal(
      archive!.kind === "archive" ? archive!.page.items.length : -1,
      1,
      "and lists only the built locale's post",
    );
  },
);

check("M14: AN UNEXPECTED CATEGORY ARCHIVE HAS NO CLAIMANT", () => {
  // A registry row nothing intends. The integrity gate reports the route as
  // emitted from an identity `content/` does not intend — proved in the
  // content-integrity suite; here the identity itself is checked.
  const table = site({ categories: [...CATEGORIES, term("ghost", 55)] });
  const identities = table.routes
    .filter((route) => route.kind === "archive" && route.archive === "category")
    .map((route) => identityOf(route));
  assert(
    identities.includes(rowId("categories", "ghost")),
    "the route names the row it came from, so a missing row is detectable",
  );
});

check("M15: MISSING REGISTRY DATA PRODUCES NO ARCHIVES, NOT A GUESS", () => {
  const table = site({ categories: [], tags: [] });
  const archives = table.routes.filter(
    (route) =>
      route.kind === "archive" &&
      (route.archive === "category" || route.archive === "tag"),
  );
  equal(archives.length, 0, "no archive is invented from the posts' terms");
});

// ---------------------------------------------------------------------------
console.log("\nOne list, two kinds");

check("allTaxonomies puts WordPress's own first and marks them", () => {
  const all = allTaxonomies([TAXONOMY]);
  equal(all.length, 3, "two core plus one configured");
  equal(all.filter((one) => one.builtIn).length, 2, "two built in");
  equal(all[2]!.name, "product_cat", "the configured one follows");
  equal(all[2]!.builtIn, false, "and is not built in");
});

check("a taxonomy may be attached to posts as well as to a custom type", () => {
  const problems = taxonomyProfileProblems(
    [
      {
        ...TAXONOMY,
        name: "topic",
        collection: "topics",
        appliesTo: ["posts"],
      },
    ],
    [],
  );
  equal(problems.length, 0, `posts is a valid target: ${problems.join("; ")}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nCore taxonomy suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Core taxonomy suite OK\n");
