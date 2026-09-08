// One taxonomy model, for WordPress's own two and for yours.
//
// ## What was measured first
//
// The kit had two taxonomy implementations that had grown apart:
//
//                      core `category` / `post_tag`   custom taxonomy
//     terms            content/categories.json        content/<collection>.json
//     schema           categorySchema (no parent)     taxonomyTermSchema
//     URL              permalinks.category, %slug%    profile.permalink, %term%
//     hierarchy        NONE — no parent field         parent + cycle guard
//     archive lists    posts                          entries of appliesTo
//     validated by     hand-written per-registry      profile-driven
//     described as     nothing in the manifest        a taxonomies[] row
//
// The row that matters is `hierarchy`. Measured from WordPress core
// (`create_initial_taxonomies()` in `wp-includes/taxonomy.php`, read
// 2026-09-08), `category` is registered with:
//
//     'hierarchical' => true,
//     'rewrite'      => array( 'hierarchical' => true,
//                              'slug' => get_option('category_base') ?: 'category', … )
//     'rest_base'    => 'categories',
//
// and `post_tag` with `'hierarchical' => false`, `rewrite['hierarchical']`
// false, `rest_base => 'tags'`. So a WordPress category has parents AND its
// archive URL carries them — `/category/parent/child/` — and this kit could
// not represent either: `categorySchema` had no `parent`, and `categoryPath()`
// took a bare slug.
//
// A migration that met a nested category therefore had to flatten it, which is
// a URL the source never served. That is the defect this module fixes, and it
// is why "unify the two models" turned out to be worth doing rather than tidy.
//
// ## Why the public configuration did not change
//
// `TaxonomyProfile` in `migration.config.ts` is untouched, and nobody has to
// declare `category` or `post_tag`: the two built-ins are DERIVED here from
// `permalinks.category` and `permalinks.tag`, which is where they were already
// configured. An existing configuration produces the same URLs it did before —
// see `coreTaxonomies()` — and a site with no nested categories cannot notice
// this change at all, because it had no way to express one.
//
// ## Shared implementation, explicit semantics
//
// `ResolvedTaxonomy` adds the two things that genuinely differ and are not
// expressible in the public profile, so that downstream code can stop asking
// "is this the core one?" by comparing names:
//
//   `builtIn`     WordPress's own, modelled by the kit rather than configured
//   `reference`   where an entry names its terms — measured, and really two
//                 shapes: `wp/v2/posts` returns `categories` and `tags` as
//                 top-level arrays, and everything else is filed in the
//                 generic `terms` map keyed by taxonomy name
import {
  migration,
  type Permalinks,
  type TaxonomyProfile,
} from "../../../../migration.config.ts";

/** How an entry names its terms of one taxonomy. */
export type TermReference =
  /** A named front-matter field on the entry — `categories`, `tags`. */
  | { readonly kind: "field"; readonly field: "categories" | "tags" }
  /** The generic `terms` map, keyed by taxonomy name. */
  | { readonly kind: "terms" };

/**
 * A taxonomy as the pipeline uses one: the configured profile, plus the two
 * facts a profile cannot carry.
 *
 * Built rather than written, so a consumer handles core and custom taxonomies
 * with one loop and still knows which it has.
 */
export interface ResolvedTaxonomy extends TaxonomyProfile {
  /** True for WordPress's `category` and `post_tag`. */
  readonly builtIn: boolean;
  readonly reference: TermReference;
}

/** WordPress's own two. A user profile may not claim either name. */
export const CORE_TAXONOMY_NAMES = ["category", "post_tag"] as const;

/**
 * The collection each built-in taxonomy's terms live in.
 *
 * These are the filenames the kit has always used, and they stay: retiring
 * `content/categories.json` would break every existing content tree for no
 * gain. It is the SCHEMA behind them that unified, not the storage.
 */
export const CORE_TAXONOMY_COLLECTIONS = ["categories", "tags"] as const;

/**
 * WordPress's `category` and `post_tag`, as profiles.
 *
 * Every field is either measured from core or read from `permalinks`, and
 * nothing is invented:
 *
 *   `permalink`    `permalinks.category` / `permalinks.tag` — unchanged, so an
 *                  existing configuration produces the URLs it always did
 *   `restBase`     `categories` / `tags` — core's own `rest_base`
 *   `urlHierarchy` core's `rewrite['hierarchical']`: true / false
 *   `hierarchical` core's `hierarchical`: true / false
 *   `appliesTo`    `posts`, because core registers both against `'post'`
 *   `published`    always: the kit has always published these archives, and
 *                  making them optional now would retire live URLs
 */
export function coreTaxonomies(
  permalinks: Permalinks = migration.permalinks,
): ResolvedTaxonomy[] {
  return [
    {
      name: "category",
      label: "Category",
      collection: "categories",
      restBase: "categories",
      appliesTo: ["posts"],
      published: true,
      permalink: permalinks.category,
      // Measured, and the whole reason this module exists: a WordPress
      // category archive carries its ancestors. Turning this on cannot move an
      // existing URL, because until now no category could HAVE an ancestor.
      urlHierarchy: true,
      hierarchical: true,
      builtIn: true,
      reference: { kind: "field", field: "categories" },
    },
    {
      name: "post_tag",
      label: "Tag",
      collection: "tags",
      restBase: "tags",
      appliesTo: ["posts"],
      published: true,
      permalink: permalinks.tag,
      urlHierarchy: false,
      hierarchical: false,
      builtIn: true,
      reference: { kind: "field", field: "tags" },
    },
  ];
}

/** A configured taxonomy, lifted into the shared shape. */
export function userTaxonomies(
  taxonomies: readonly TaxonomyProfile[] = migration.taxonomies,
): ResolvedTaxonomy[] {
  return taxonomies.map((profile) => ({
    ...profile,
    builtIn: false,
    // Configured taxonomies file their terms in the generic map. There is no
    // way to opt into the `field` shape, deliberately: the two named fields
    // exist because WordPress's own REST shape has them, not as a style.
    reference: { kind: "terms" },
  }));
}

/**
 * Every taxonomy this build knows about, core first.
 *
 * The single list. A consumer that needs only the configured ones filters on
 * `builtIn` — which is also what keeps collection OWNERSHIP honest: the core
 * collections are owned by the kit's content model, so the ownership check is
 * still given the user's profiles alone and a user profile claiming
 * `categories` is still a contest.
 */
export function allTaxonomies(
  taxonomies: readonly TaxonomyProfile[] = migration.taxonomies,
  permalinks: Permalinks = migration.permalinks,
): ResolvedTaxonomy[] {
  return [...coreTaxonomies(permalinks), ...userTaxonomies(taxonomies)];
}

/** The term slugs an entry files under one taxonomy. */
export function termsOf(
  taxonomy: ResolvedTaxonomy,
  data: {
    readonly categories?: readonly string[];
    readonly tags?: readonly string[];
    readonly terms?: Readonly<Record<string, readonly string[]>>;
  },
): readonly string[] {
  return taxonomy.reference.kind === "field"
    ? (data[taxonomy.reference.field] ?? [])
    : (data.terms?.[taxonomy.name] ?? []);
}
