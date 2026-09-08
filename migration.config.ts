// migration.config.ts — the one file that says which WordPress site this
// project migrates FROM and how its URLs map onto this build.
//
// What reads it TODAY: the Astro app, for the permalink structure
// (`permalinks`) and the media origin (`liveOrigin`); and
// `scripts/accessibility-audit`, for `paginationSegment`, when it decides
// whether a nav landmark is site chrome or belongs to one template.
//
// Every field here has a reader, and that is a rule rather than a coincidence:
// a setting nothing reads looks like a feature and is a lie. `permalinks` build
// the route table; `liveOrigin`, `liveLanguagePrefixes` and `crawl` are read by
// `site-map-audit` and `content-capture`; `evidenceDir` is where both write;
// `routePairs` is read by `content-reconcile`. Delete a field before you let it
// go unread.
//
// Nothing else in the kit names the source site, so a kit configured for a
// different site is this file and the content it produces — not a fork.
//
// `pnpm kit:init` writes the origins. Everything else is yours to edit.

/**
 * The URL structure, in WordPress's own vocabulary (Settings → Permalinks).
 *
 * The default below is WordPress's default for a site with a static front
 * page and a posts page at `/blog/`. A site that shows its latest posts on the
 * front page is `frontPage: null` and `postsIndex: "/"`. Every other structure
 * WordPress offers is a pattern here:
 *
 *   "Day and name"    post: "/%year%/%monthnum%/%day%/%postname%/"
 *   "Month and name"  post: "/%year%/%monthnum%/%postname%/"
 *   "Post name"       post: "/%postname%/"
 *   under a prefix    post: "/blog/%postname%/"
 *   with a category   post: "/%category%/%postname%/"
 *
 * Keep the LIVE site's structure: URL preservation is the migration's first
 * SEO requirement, and a redirect is only for a URL that genuinely changes.
 */
export interface Permalinks {
  /**
   * Post permalink. Tokens: `%postname%`, `%year%`, `%monthnum%`, `%day%`,
   * `%category%` (the first category's slug), `%author%` (the author's
   * nicename).
   */
  readonly post: string;
  /** Page permalink. `%pagename%` expands to the page's hierarchy path (`parent/child`). */
  readonly page: string;
  /** Category archive. Token: `%slug%`. WordPress: `/category/%slug%/`. */
  readonly category: string;
  /** Tag archive. Token: `%slug%`. WordPress: `/tag/%slug%/`. */
  readonly tag: string;
  /** Author archive. Token: `%nicename%`. WordPress: `/author/%nicename%/`. */
  readonly author: string;
  /** Where the posts listing lives. `/` when the front page shows posts. */
  readonly postsIndex: string;
  /** The segment paginated archives use: `/blog/page/2/`. WordPress: `page`. */
  readonly paginationSegment: string;
  /**
   * The `pages` entry rendered at `/`, by slug — or `null` when the front page
   * is the posts listing. A front page is not ALSO published at its own
   * `%pagename%` path.
   */
  readonly frontPage: string | null;
  /** WordPress `posts_per_page`. Default 10. */
  readonly postsPerPage: number;
}

export interface CrawlSettings {
  /** Delay between page requests, in milliseconds. Polite by construction. */
  readonly delayMs: number;
  /**
   * Delay between REST media requests. A capture that reads one media row per
   * post is the one loop that hits the source site hundreds of times in a
   * row, and a firewall that notices will block `wp-json` for the better part
   * of two hours while pages stay 200 — an inventory taken in that window is
   * false. Pace it; never retry into it.
   */
  readonly mediaDelayMs: number;
  /**
   * How a crawler identifies itself. Honest identification with a contact.
   * When the capture tools land they will refuse to run while this still
   * says to set it; today it is a value for the crawler you bring.
   */
  readonly userAgent: string;
}

export interface RoutePair {
  /** The route on this build — `/pricing`. */
  readonly route: string;
  /** The saved crawl of the live page, relative to the repository root. */
  readonly live: string;
  /** The built file, relative to `apps/website/dist/`. */
  readonly ours: string;
}

/**
 * How a WordPress taxonomy is published by this build.
 *
 * ## What was measured, and why this cannot be inferred
 *
 * Four facts, read off WordPress core and confirmed against a live install
 * (2026-09-08). Every one of them rules out a guess the kit might have made:
 *
 * 1. **REST does not expose the rewrite.** `wp/v2/taxonomies` returns `name`,
 *    `slug`, `description`, `types`, `hierarchical`, `rest_base` and
 *    `rest_namespace` — and nothing about the URL. Measured on a live site as
 *    well as in `class-wp-rest-taxonomies-controller.php`.
 *
 * 2. **The taxonomy name is not the URL base.** Measured: the taxonomy
 *    `doc_category` publishes terms at `/docs-category/<slug>/`. Deriving one
 *    from the other would have produced a URL the site never served.
 *
 * 3. **A hierarchical taxonomy does not imply hierarchical URLs.**
 *    `get_term_link()` includes ancestor slugs only when
 *    `rewrite['hierarchical']` is true, which `register_taxonomy` sets
 *    independently of `hierarchical`. Two flags, two questions.
 *
 * 4. **A term slug is unique within its taxonomy.** `wp_unique_term_slug()`
 *    appends a parent suffix or a number when a slug already exists in the
 *    same taxonomy; duplicates across DIFFERENT taxonomies have been allowed
 *    since WordPress 4.1. So `(taxonomy, slug)` identifies a term, and two
 *    children of different parents cannot both be `laptops`.
 *
 * A term's `link` field IS exposed, so a capture can CHECK a profile against
 * the URL the source site really serves — configuration that is verifiable
 * rather than merely declared.
 */
export interface TaxonomyProfile {
  /** The WordPress taxonomy key: `product_cat`. */
  readonly name: string;
  /**
   * The human label — `wp/v2/taxonomies` reports it as `name`.
   *
   * Not decoration. WordPress allows the same term name in two taxonomies, and
   * measured on this kit's own fixtures that produced two pages titled
   * "Laptops – Example Site" — a duplicate-title defect `seo:audit` failed on.
   * The label is what tells them apart in a title.
   */
  readonly label: string;
  /** The registry file: `content/<collection>.json`. */
  readonly collection: string;
  /** The REST route segment, which is not always the taxonomy name. */
  readonly restBase: string;
  /**
   * The post-type COLLECTIONS whose entries this taxonomy files.
   *
   * A list, because WordPress attaches one taxonomy to any number of types —
   * measured on a live install, two taxonomies shared one custom type and one
   * custom type had two of its own. Naming the collections rather than the
   * WordPress type keys keeps this in step with the rest of the kit, and every
   * name must belong to a published profile or the build fails.
   */
  readonly appliesTo: readonly string[];
  /**
   * False for a taxonomy whose terms are stored on entries and never routed.
   *
   * Not the same as omitting the profile: a stored-only taxonomy is known, its
   * terms are validated and named, and `content:integrity` reports them.
   */
  readonly published: boolean;
  /**
   * The URL pattern, in WordPress's permalink syntax.
   *
   * `%term%` is the only token, because it is the only one `get_term_link()`
   * expands. The literal prefix is the `rewrite['slug']` REST does not report,
   * so it is written here and checked against a captured term's `link`.
   */
  readonly permalink: string;
  /**
   * Whether the URL carries the term's ancestors — `rewrite['hierarchical']`.
   *
   * SEPARATE from `hierarchical` on purpose, because WordPress separates them:
   * a hierarchical taxonomy with `rewrite.hierarchical` false publishes
   * `/product-category/laptops/`, not `/product-category/electronics/laptops/`.
   * Getting this wrong publishes URLs the source never had.
   */
  readonly urlHierarchy: boolean;
  /** Whether terms have parents at all — the DATA shape, not the URL shape. */
  readonly hierarchical: boolean;
}

/**
 * How a WordPress post type is published by this build.
 *
 * ## Why a profile and not a heuristic
 *
 * WordPress has two built-in content types and an unbounded number of custom
 * ones, and NOTHING about a custom type tells you how it should be published.
 * `product` might be a public catalogue with an archive at `/products/`, an
 * internal record with no public page at all, or a type whose URLs depend on a
 * taxonomy this kit cannot route. The REST API reports that the type exists; it
 * does not report which of those it is, and guessing is how a migration
 * publishes a URL nobody chose.
 *
 * So a custom type is published only when a profile says so, and the profile
 * says exactly what. A type discovered by `content:census` with no profile is
 * REPORTED — never silently dropped, and never silently routed.
 */
export interface PostTypeProfile {
  /** The WordPress post type key, as `wp/v2/types` reports it: `product`. */
  readonly name: string;
  /**
   * The content directory and Astro collection: `content/<collection>/`.
   *
   * Separate from `name` because a type key is WordPress's and a directory
   * name is yours — and because two WordPress installs have used the same key
   * for different things.
   */
  readonly collection: string;
  /** The REST route segment, which is NOT always the type name. */
  readonly restBase: string;
  /**
   * The URL pattern, in WordPress's own permalink syntax.
   *
   * Tokens this kit can expand for a custom type: `%postname%`, `%year%`,
   * `%monthnum%`, `%day%`. Anything else fails the build by name — see
   * `PATTERN_TOKENS` in `apps/website/src/routing/permalink.ts`. In particular
   * `%category%` is refused, because a taxonomy-dependent URL needs taxonomy
   * routing this kit does not have, and inventing one URL out of several
   * possible terms would publish a link that WordPress never served.
   */
  readonly permalink: string;
  /**
   * False for a type you capture but do not publish.
   *
   * Not the same as omitting the profile. A profile with `published: false`
   * says "this type is known, its entries are content, and they are
   * deliberately withheld" — and `content:integrity` reports each one by name
   * rather than letting it disappear.
   */
  readonly published: boolean;
  readonly archive: PostTypeArchive;
  readonly taxonomies: PostTypeTaxonomies;
}

/**
 * Whether the type has a listing page of its own.
 *
 * A custom type does not get an archive because it exists — WordPress's own
 * `has_archive` defaults to false, and a listing nobody asked for is a URL
 * nobody asked for.
 */
export type PostTypeArchive =
  | { readonly kind: "none" }
  | {
      /** A listing at `path`, paginated with the same segment as the blog. */
      readonly kind: "archive";
      readonly path: string;
      /** Shown as the listing's heading. */
      readonly title: string;
    };

export interface PostTypeTaxonomies {
  /**
   * The taxonomy names attached to this type, as the census reported them.
   *
   * Recorded even when nothing routes them: the terms are real content, they
   * are stored on the entry, and a later reader needs to know they were seen.
   */
  readonly attached: readonly string[];
  /**
   * Whether this build must publish archives for those taxonomies.
   *
   * **`true` is refused today**, loudly, at build time. The kit's taxonomy
   * routing is written against posts specifically — `categories` and `tags`
   * registries, filtered over the posts collection — and pretending a custom
   * type's terms route would publish archives whose contents nobody checked.
   * The boundary is stated rather than approximated.
   */
  readonly archives: boolean;
}

/**
 * How the source site's HTML has to be read.
 *
 * **WordPress is not one editor.** The same CMS renders through Gutenberg,
 * Elementor, Divi, WPBakery, Beaver Builder and the classic editor, and a site
 * with any history has two of them in different eras of itself. What a builder
 * emits for a section it hides at every breakpoint is entirely its own
 * business, so the reconciler is told rather than assuming.
 *
 * Measured profiles ship in `scripts/content-reconcile/builders.ts`. A builder
 * that has no profile is not a blocker: name nothing, and add the class sets
 * you read off your own pages below.
 */
export interface SourceMarkupConfig {
  /**
   * Builder profiles to apply. Measured: `"gutenberg"`, `"elementor"`.
   *
   * Naming an unmeasured builder is an error rather than a silent no-op — a
   * typo that selected nothing would produce a report claiming to have dropped
   * the hidden sections when it dropped none.
   */
  readonly builders: readonly string[];
  /**
   * Class SETS your theme or plugins use to hide a section at every width.
   *
   * A set, not a class: builders spell per-breakpoint hiding as one class per
   * breakpoint, and a section hidden at three widths of four still paints at
   * the fourth. An element counts as hidden only when it carries every class
   * in one set.
   *
   * Read these off a section you KNOW your source site never paints. Do not
   * guess them — a wrong marker either deletes real content from the
   * comparison or matches nothing, and the report looks the same either way.
   */
  readonly hiddenEverywhere: readonly (readonly string[])[];
  /**
   * `[attribute, value]` pairs marking a subtree the document carries but the
   * page is not — a popup, an off-canvas drawer. `role="dialog"` is applied
   * for every site already; this is for the ones that mark themselves some
   * other way.
   */
  readonly notPartOfThePage: readonly (readonly [string, string])[];
}

/**
 * The media library, and what this build is allowed to do with it.
 *
 * ## Why this is configuration and not a constant
 *
 * `/wp-content/uploads/` is WordPress's default and not its rule: the
 * directory is `UPLOADS` in `wp-config.php`, `upload_path` in the options
 * table, and a multisite install serves `/wp-content/uploads/sites/7/`. A kit
 * that hard-coded the prefix would silently classify a real library as
 * "outside every migratable namespace" and migrate nothing.
 *
 * ## Why a HOST allowlist rather than a pattern
 *
 * `migrateFrom` is the safety rule. A migrated body routinely carries images
 * from other people's sites — a partner's logo, an embedded chart — and some
 * of those URLs contain `/wp-content/uploads/` because that site is also
 * WordPress. Rewriting one would point this site at a file it does not have
 * and never captured. So a reference is migrated only when its HOST is named
 * here; everything else is classified `EXTERNAL` and left exactly as written.
 */
export interface MediaProfile {
  /**
   * The uploads directory, as a root-relative path.
   *
   * WordPress's default is `/wp-content/uploads`. A multisite child serves
   * `/wp-content/uploads/sites/<id>`; read it off a real image URL rather than
   * assuming.
   */
  readonly uploadsPath: string;
  /**
   * Extra local namespaces the source site served files from.
   *
   * Empty by default and deliberately so: a plugin that serves downloads from
   * its own directory is a real shape, and it is a DECISION to migrate it —
   * the engine classifies anything matched here as `CONFIGURED` rather than
   * `SUPPORTED`, so a report says which files moved because somebody asked.
   */
  readonly extraPaths: readonly string[];
  /**
   * The hosts whose files this build may copy.
   *
   * Compared with `www.` and the scheme ignored, because a body written over
   * fifteen years carries all four spellings of one site. A root-relative
   * reference needs no host and is always the site's own.
   */
  readonly migrateFrom: readonly string[];
  /**
   * The path migrated files are served at.
   *
   * `/media/` rather than keeping `/wp-content/uploads/`: the uploads path is
   * the SOURCE's shape, and a static site that reproduces it is claiming to be
   * a WordPress install. Redirects preserve the old URLs where that matters —
   * that is what `content/redirects.json` is for.
   */
  readonly localBase: string;
}

export interface MigrationConfig {
  /**
   * The WordPress site being migrated: scheme and host, no trailing slash.
   * `undefined` until `pnpm kit:init --live-origin` (or you) sets it. The
   * media seam passes uploads through unchanged without it; the capture
   * tools, when they land, will refuse to run without it.
   */
  readonly liveOrigin: string | undefined;
  /**
   * Language prefixes the live site serves translated URLs under (`/fr`,
   * `/de`), when a translation plugin publishes them. Each becomes a splat
   * redirect row until the translated corpus is migrated — a static build
   * cannot enumerate what falls under a prefix, only a host can honour one.
   */
  readonly liveLanguagePrefixes: readonly string[];
  readonly permalinks: Permalinks;
  /** Where captures and crawls are stored, relative to the repository root. */
  readonly evidenceDir: string;
  readonly crawl: CrawlSettings;
  /**
   * Live page ↔ built page pairs for content reconciliation ("does our page
   * SAY what live's page says?"). Empty until a page is built.
   */
  readonly routePairs: readonly RoutePair[];
  readonly sourceMarkup: SourceMarkupConfig;
  /**
   * Custom post types this build publishes, one profile each.
   *
   * Empty is the correct starting state: `content:census` lists what the source
   * site has, and each type earns a profile when somebody decides how it should
   * be published. A discovered type with no profile is reported as
   * unconfigured — that is a decision waiting, not a gap in the tooling.
   */
  readonly postTypes: readonly PostTypeProfile[];
  /**
   * Taxonomies this build publishes or stores, one profile each.
   *
   * `category` and `post_tag` are NOT here: the kit models WordPress's two core
   * taxonomies directly, through `content/categories.json` and
   * `content/tags.json` and the `permalinks.category` / `permalinks.tag`
   * patterns. This list is for everything else.
   */
  readonly taxonomies: readonly TaxonomyProfile[];
  /** The media library, and what this build may do with it. */
  readonly media: MediaProfile;
}

export const migration: MigrationConfig = {
  liveOrigin: undefined,
  liveLanguagePrefixes: [],
  permalinks: {
    post: "/%postname%/",
    page: "/%pagename%/",
    category: "/category/%slug%/",
    tag: "/tag/%slug%/",
    author: "/author/%nicename%/",
    postsIndex: "/blog/",
    paginationSegment: "page",
    frontPage: "home",
    postsPerPage: 10,
  },
  evidenceDir: "research",
  crawl: {
    delayMs: 1500,
    mediaDelayMs: 120,
    userAgent:
      "site-migration-discovery/0.1 (contact: set crawl.userAgent in migration.config.ts)",
  },
  routePairs: [],
  sourceMarkup: {
    // Gutenberg is the default because it is WordPress's own editor, and its
    // profile is empty on purpose: core ships no responsive-hide utility at
    // all, so there is nothing to drop. Add "elementor" — or your own sets —
    // when discovery says what built the source site.
    builders: ["gutenberg"],
    hiddenEverywhere: [],
    notPartOfThePage: [],
  },
  // Three profiles ship, and they are FIXTURES rather than a claim about your
  // site: they exist so the custom-type path is exercised by the kit's own
  // ladder on every build instead of only in a unit test. `product` and
  // `portfolio` are the two ordinary shapes (with and without a listing);
  // `internal-note` is the withheld case. Delete all three when you replace
  // the sample content, the same as every other `source.system: sample` entry.
  postTypes: [
    {
      name: "product",
      collection: "products",
      restBase: "product",
      permalink: "/products/%postname%/",
      published: true,
      archive: { kind: "archive", path: "/products/", title: "Products" },
      taxonomies: { attached: [], archives: false },
    },
    {
      name: "portfolio",
      collection: "portfolio",
      restBase: "portfolio",
      permalink: "/portfolio/%postname%/",
      published: true,
      archive: { kind: "none" },
      taxonomies: { attached: [], archives: false },
    },
    {
      name: "internal-note",
      collection: "internal-notes",
      restBase: "internal-note",
      permalink: "/internal-notes/%postname%/",
      published: false,
      archive: { kind: "none" },
      taxonomies: { attached: [], archives: false },
    },
  ],
  // Two taxonomy fixtures on the `product` type, for the same reason the type
  // fixtures exist: the paths they exercise have to run in the kit's own
  // ladder, not only in a unit test. Both are synthetic.
  //
  // `product-category` is hierarchical in BOTH senses — its terms have parents
  // and its URLs carry them — which is the case a flat model gets wrong.
  // `product-tag` is neither, which is the case a hierarchical model gets
  // wrong by assuming.
  media: {
    uploadsPath: "/wp-content/uploads",
    extraPaths: [],
    // The kit's own sample content carries a WordPress-shaped body, so the
    // engine runs on every build rather than only in a unit test. Replace this
    // with your source site's host — nothing is copied from a host this does
    // not list, so an unedited clone reaches out to nobody.
    migrateFrom: ["old.example.com"],
    localBase: "/media",
  },

  taxonomies: [
    {
      name: "product_cat",
      label: "Product category",
      collection: "product-categories",
      restBase: "product_cat",
      appliesTo: ["products"],
      published: true,
      // The literal prefix differs from the taxonomy name deliberately: that is
      // what a real install does, measured — `doc_category` serves terms at
      // `/docs-category/`. A kit that derived one from the other would publish
      // URLs the source never had.
      permalink: "/product-category/%term%/",
      urlHierarchy: true,
      hierarchical: true,
    },
    {
      name: "product_tag",
      label: "Product tag",
      collection: "product-tags",
      restBase: "product_tag",
      appliesTo: ["products"],
      published: true,
      permalink: "/product-tag/%term%/",
      urlHierarchy: false,
      hierarchical: false,
    },
  ],
};
