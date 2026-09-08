// The route table: every page, post and archive this site publishes, at the
// path the permalink patterns give it — and nothing else decides a URL.
//
// Pure. It takes plain entries and registry rows and returns routes; the one
// `astro:content` touch is `site-routes.ts`. That is what lets the rendering
// contract execute the whole URL model without a build, and what lets the
// deployment manifest, the sitemap and the search index all describe the
// same set of pages the resolver renders.
//
// Two routes claiming one path THROWS, by name: Astro would fail the build on
// the duplicate anyway, and failing here says which two entries collide.
import {
  migration,
  type PostTypeProfile,
  type TaxonomyProfile,
} from "../../../../migration.config.ts";
import type { SourceBlock } from "../content-model/provenance.ts";
import { paginate, type PageOf } from "../content-index/pagination.ts";
import { routeKey } from "./url-shape.ts";
import {
  coreTaxonomies,
  termsOf,
  userTaxonomies,
  type ResolvedTaxonomy,
} from "./taxonomies.ts";
import {
  authorPath,
  customTypeArchivePath,
  customTypePath,
  taxonomyProfileProblems,
  termPath,
  pagePath,
  paginatedPath,
  permalinkProblems,
  postTypeProfileProblems,
  permalinks,
  postPath,
  postsIndexPath,
} from "./permalink.ts";

export interface PostEntryData {
  /**
   * Where the entity came from — the `source` block the content model
   * requires on every source entity.
   *
   * Declared here because a type that omits it makes the resolver blind to it,
   * and that is not a hypothetical: this field WAS in the front matter and was
   * absent from these interfaces, so nothing from the resolver onward — route,
   * inventory, manifest, `dist/` — could say which WordPress entity a page
   * was a page of. See content-model/provenance.ts.
   */
  readonly source?: SourceBlock;
  readonly slug: string;
  readonly title: string;
  readonly locale: string;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly author: string;
  readonly categories: readonly string[];
  readonly tags?: readonly string[];
  readonly excerpt?: string;
  readonly featuredImage?: {
    readonly url: string;
    readonly alt?: string;
    readonly width?: number;
    readonly height?: number;
    readonly variants?: readonly {
      readonly url: string;
      readonly width: number;
      readonly height: number;
    }[];
  };
}

export interface PageEntryData {
  /**
   * Where the entity came from — the `source` block the content model
   * requires on every source entity.
   *
   * Declared here because a type that omits it makes the resolver blind to it,
   * and that is not a hypothetical: this field WAS in the front matter and was
   * absent from these interfaces, so nothing from the resolver onward — route,
   * inventory, manifest, `dist/` — could say which WordPress entity a page
   * was a page of. See content-model/provenance.ts.
   */
  readonly source?: SourceBlock;
  readonly slug: string;
  readonly title: string;
  readonly locale: string;
  readonly updatedAt: string;
  readonly parent?: string;
  readonly form?: string;
  readonly excerpt?: string;
}

/** An entry as a collection yields it. */
export interface EntryLike<Data> {
  readonly data: Data;
  readonly body?: string | null;
}

export interface AuthorRow {
  /**
   * Where the entity came from — the `source` block the content model
   * requires on every source entity.
   *
   * Declared here because a type that omits it makes the resolver blind to it,
   * and that is not a hypothetical: this field WAS in the front matter and was
   * absent from these interfaces, so nothing from the resolver onward — route,
   * inventory, manifest, `dist/` — could say which WordPress entity a page
   * was a page of. See content-model/provenance.ts.
   */
  readonly source?: SourceBlock;
  readonly slug: string;
  readonly name: string;
  readonly nicename?: string;
  readonly bio?: string;
  readonly avatar?: { readonly url: string; readonly alt?: string };
}

/**
 * A registry row of ANY taxonomy — core or configured.
 *
 * One type, because there is now one schema: `content/categories.json` and
 * `content/product-categories.json` hold the same shape, and a core category
 * has a `parent` for the same reason a custom term does. `TaxonomyTermRow` is
 * the name the custom side already used; this is the same thing.
 */
export type TermRow = TaxonomyTermRow;

export interface RouteSources<
  Post extends EntryLike<PostEntryData>,
  Page extends EntryLike<PageEntryData>,
  Custom extends EntryLike<CustomEntryData> = never,
> {
  readonly posts: readonly Post[];
  readonly pages: readonly Page[];
  readonly authors: readonly AuthorRow[];
  readonly categories: readonly TermRow[];
  readonly tags: readonly TermRow[];
  readonly locale: string;
  /**
   * Custom-type entries, keyed by COLLECTION name.
   *
   * Keyed by collection rather than by WordPress type key because the
   * collection is what the content tree and the identity use, and two installs
   * have used one type key for different things. The profile carries both.
   */
  readonly custom?: Readonly<Record<string, readonly Custom[]>>;
  /** The profiles to route. Defaults to `migration.config.ts`'s. */
  readonly postTypes?: readonly PostTypeProfile[];
  /** Custom taxonomy terms, keyed by REGISTRY collection name. */
  readonly terms?: Readonly<Record<string, readonly TaxonomyTermRow[]>>;
  /** The taxonomy profiles to route. Defaults to `migration.config.ts`'s. */
  readonly taxonomies?: readonly TaxonomyProfile[];
}

export type ArchiveKind = "posts" | "category" | "tag" | "author";

/** An entry of a custom post type, as its collection yields one. */
export interface CustomEntryData {
  /**
   * Where the entity came from — the `source` block the content model
   * requires on every source entity.
   *
   * Declared here because a type that omits it makes the resolver blind to it,
   * and that is not a hypothetical: this field WAS in the front matter and was
   * absent from these interfaces, so nothing from the resolver onward — route,
   * inventory, manifest, `dist/` — could say which WordPress entity a page
   * was a page of. See content-model/provenance.ts.
   */
  readonly source?: SourceBlock;
  readonly slug: string;
  readonly title: string;
  readonly locale: string;
  readonly updatedAt: string;
  readonly publishedAt?: string;
  readonly excerpt?: string;
  readonly terms?: Readonly<Record<string, readonly string[]>>;
}

export interface PageRoute<Page> {
  readonly kind: "page";
  readonly path: string;
  readonly entry: Page;
  /** The chain of parents, outermost first. */
  readonly parents: readonly Page[];
}

export interface PostRoute<Post> {
  readonly kind: "post";
  readonly path: string;
  readonly entry: Post;
}

/**
 * One entry of a custom post type.
 *
 * Carries its PROFILE, not just its entry, so a route can answer every
 * question a renderer or an audit asks without inferring anything from the
 * path: which collection it came from, which pattern produced the URL, which
 * template renders it. A resolver that decided "this does not look like a page
 * or a post, so it must be custom" would be a heuristic wearing a type.
 */
export interface CustomRoute<Custom> {
  readonly kind: "custom";
  readonly path: string;
  readonly entry: Custom;
  readonly profile: PostTypeProfile;
}

/**
 * A custom type's listing, when its profile declares one.
 *
 * Its own kind rather than a widened `ArchiveRoute`, because an archive lists
 * items of ONE type and `ArchiveRoute` lists posts. Widening it would make
 * every post archive's item type a union that `ArchivePage` would have to
 * narrow at runtime — a type hole opened to save a file.
 */
/** One term of a custom taxonomy, as its registry yields one. */
export interface TaxonomyTermRow {
  /**
   * Where the entity came from — the `source` block the content model
   * requires on every source entity.
   *
   * Declared here because a type that omits it makes the resolver blind to it,
   * and that is not a hypothetical: this field WAS in the front matter and was
   * absent from these interfaces, so nothing from the resolver onward — route,
   * inventory, manifest, `dist/` — could say which WordPress entity a page
   * was a page of. See content-model/provenance.ts.
   */
  readonly source?: SourceBlock;
  readonly slug: string;
  readonly parent?: string;
  readonly name: Readonly<Partial<Record<string, string>>>;
  readonly description?: Readonly<Partial<Record<string, string>>>;
}

/**
 * A custom taxonomy term's archive.
 *
 * Its own kind rather than a case hidden inside `custom-archive`, because the
 * two answer different questions: a custom archive lists a whole collection,
 * this lists the entries filed under one term, possibly drawn from several
 * collections. A route carries everything an audit or a renderer needs —
 * the taxonomy, the term, the ancestors, and the collections it drew from —
 * so nothing downstream has to read a URL to find out what it is looking at.
 */
export interface TaxonomyArchiveRoute<Custom> {
  readonly kind: "taxonomy-archive";
  readonly path: string;
  /** The term archive's own URL: page 1. */
  readonly base: string;
  readonly title: string;
  readonly page: PageOf<Custom>;
  readonly taxonomy: TaxonomyProfile;
  readonly term: TaxonomyTermRow;
  /** Outermost ancestor first; empty for a root term. */
  readonly ancestors: readonly TaxonomyTermRow[];
  /** The post-type collections this archive drew its entries from. */
  readonly collections: readonly string[];
}

export interface CustomArchiveRoute<Custom> {
  readonly kind: "custom-archive";
  readonly path: string;
  /** The listing's own URL: page 1. */
  readonly base: string;
  readonly title: string;
  readonly page: PageOf<Custom>;
  readonly profile: PostTypeProfile;
}

export interface ArchiveRoute<Post, Page> {
  readonly kind: "archive";
  readonly path: string;
  readonly archive: ArchiveKind;
  /** The archive's own URL (page 1). */
  readonly base: string;
  readonly title: string;
  readonly page: PageOf<Post>;
  /** For a category or tag archive. */
  readonly term?: TermRow;
  /** For an author archive. */
  readonly author?: AuthorRow;
  /** For the posts index: the page WordPress would show it on, if one exists. */
  readonly indexPage?: Page;
}

export type SiteRoute<Post, Page, Custom = never> =
  | PageRoute<Page>
  | PostRoute<Post>
  | ArchiveRoute<Post, Page>
  | CustomRoute<Custom>
  | CustomArchiveRoute<Custom>
  | TaxonomyArchiveRoute<Custom>;

export interface SiteRouteTable<
  Post extends EntryLike<PostEntryData>,
  Page extends EntryLike<PageEntryData>,
  Custom extends EntryLike<CustomEntryData> = never,
> {
  /** Every route the `[...path]` module renders. Never includes `/`. */
  readonly routes: readonly SiteRoute<Post, Page, Custom>[];
  /** What `/` renders: a page, page 1 of the posts listing, or nothing. */
  readonly frontPage: PageRoute<Page> | ArchiveRoute<Post, Page> | undefined;
  /**
   * Page one of the posts listing, wherever it lives — `/`, `/blog/`, or
   * whatever `permalinks.postsIndex` names. Held here rather than found by
   * every caller: a `find` over the route union does not narrow, and three
   * callers wrote the same unnarrowable predicate.
   */
  readonly postsArchive: ArchiveRoute<Post, Page> | undefined;
  /** Every routed post, newest first. */
  readonly posts: readonly Post[];
  /** Every routed page. */
  readonly pages: readonly Page[];
  /** The URL an entry is published at, or undefined for one that is not. */
  readonly hrefOf: (kind: "post" | "page", slug: string) => string | undefined;
  /** The posts listing's own URL. */
  readonly postsIndex: string;
  /** The author registry row for a slug. */
  readonly authorOf: (slug: string) => AuthorRow | undefined;
  readonly categoryOf: (slug: string) => TermRow | undefined;
  readonly tagOf: (slug: string) => TermRow | undefined;
  /**
   * The URL a core term's archive is published at.
   *
   * Held here rather than recomputed by each caller, because a hierarchical
   * category's URL depends on its ancestors and a caller with only a slug
   * cannot know them. `PostPage` linked its post's categories with
   * `categoryPath(slug)` — correct while every category was flat, and a 404
   * the moment one had a parent.
   */
  readonly termHref: (
    taxonomy: "category" | "post_tag",
    slug: string,
  ) => string | undefined;
  /** Every routed custom-type entry, by collection. */
  readonly custom: Readonly<Record<string, readonly Custom[]>>;
  /** The profiles this table routed, so an audit need not re-read the config. */
  readonly postTypes: readonly PostTypeProfile[];
  readonly taxonomies: readonly TaxonomyProfile[];
  /**
   * Every taxonomy this build routed, WordPress's own two included.
   *
   * `taxonomies` stays the CONFIGURED list, because that is what collection
   * ownership and the stored-only exclusions are computed from — the core
   * collections are owned by the kit's content model, and a user profile
   * claiming one is still a contest. This is the list for anything that wants
   * to describe or audit taxonomies uniformly.
   */
  readonly allTaxonomies: readonly ResolvedTaxonomy[];
  /** Every routed term, by registry collection. */
  readonly terms: Readonly<Record<string, readonly TaxonomyTermRow[]>>;
}

/** The display name of a registry row in a locale, falling back to the default. */
export function nameFor(
  row: TermRow,
  locale: string,
  defaultLocale: string,
): string {
  return row.name[locale] ?? row.name[defaultLocale] ?? row.slug;
}

/**
 * The first locale a term has a name in, for a fallback that is never blank.
 *
 * A term registry is per-locale like the core ones, and a term migrated before
 * its translation exists has a name in one language only. Falling back to the
 * slug is the last resort, not the first.
 */
const defaultLocaleOf = (term: {
  readonly name: Readonly<Partial<Record<string, string>>>;
}): string => Object.keys(term.name)[0] ?? "";

/** Posts newest first; two on one date order by slug so builds are stable. */
export function orderPostsByDate<Post extends EntryLike<PostEntryData>>(
  posts: readonly Post[],
): Post[] {
  return [...posts].sort(
    (left, right) =>
      right.data.publishedAt.localeCompare(left.data.publishedAt) ||
      left.data.slug.localeCompare(right.data.slug),
  );
}

const describe = <
  Post extends EntryLike<PostEntryData>,
  Page extends EntryLike<PageEntryData>,
  Custom extends EntryLike<CustomEntryData>,
>(
  route: SiteRoute<Post, Page, Custom>,
): string => {
  switch (route.kind) {
    case "page":
      return `page "${route.entry.data.slug}"`;
    case "post":
      return `post "${route.entry.data.slug}"`;
    case "custom":
      return `${route.profile.name} "${route.entry.data.slug}"`;
    case "custom-archive":
      return `${route.profile.name} archive page ${route.page.page}`;
    case "taxonomy-archive":
      return `${route.taxonomy.name} term "${route.term.slug}" page ${route.page.page}`;
    case "archive":
      return `${route.archive} archive "${route.title}" page ${route.page.page}`;
  }
};

/**
 * Index one taxonomy's registry: duplicate slugs, parents, ancestors.
 *
 * Extracted so WordPress's own `category` runs the SAME rules a configured
 * taxonomy does. It did not, before: core categories had no `parent` field to
 * check, no cycle guard and no duplicate-slug throw of their own — the
 * filesystem check in `validate-content.ts` was all that stood between two
 * `news` rows and a silently dropped archive.
 */
function indexTerms(
  taxonomy: { name: string; hierarchical: boolean },
  rows: readonly TaxonomyTermRow[],
): {
  bySlug: Map<string, TaxonomyTermRow>;
  ancestorsOf: (row: TaxonomyTermRow) => TaxonomyTermRow[];
} {
  // WordPress guarantees this and the kit enforces it rather than inventing a
  // disambiguation WordPress does not have: `wp_unique_term_slug()` refuses a
  // slug that already exists in the SAME taxonomy, appending a parent suffix
  // or a number. Two terms sharing one slug here would share one URL.
  const bySlug = new Map<string, TaxonomyTermRow>();
  for (const row of rows) {
    if (bySlug.has(row.slug))
      throw new Error(
        `Taxonomy "${taxonomy.name}" has two terms with slug "${row.slug}". ` +
          "WordPress does not allow that — wp_unique_term_slug() makes a " +
          "colliding slug unique within its taxonomy — so one of these did " +
          "not come from the source site, or the capture lost the suffix.",
      );
    bySlug.set(row.slug, row);
  }

  // A parent on a flat taxonomy is data the URL model cannot express, and
  // silently ignoring it would file a term somewhere the source did not.
  if (!taxonomy.hierarchical)
    for (const row of rows)
      if (row.parent !== undefined)
        throw new Error(
          `Term "${row.slug}" names a parent, but taxonomy ` +
            `"${taxonomy.name}" is not hierarchical. WordPress refuses this ` +
            "too — rest_taxonomy_not_hierarchical.",
        );

  /** Outermost ancestor first. Throws on an unknown or looping parent. */
  const ancestorsOf = (row: TaxonomyTermRow): TaxonomyTermRow[] => {
    const chain: TaxonomyTermRow[] = [];
    const seen = new Set<string>([row.slug]);
    let current = row;
    while (current.parent !== undefined) {
      const parent = bySlug.get(current.parent);
      if (parent === undefined)
        throw new Error(
          `Term "${row.slug}" in "${taxonomy.name}" names parent ` +
            `"${current.parent}", which is not a term of that taxonomy.`,
        );
      if (seen.has(parent.slug))
        throw new Error(
          `Term "${row.slug}" in "${taxonomy.name}" has a parent chain that ` +
            `loops through "${parent.slug}".`,
        );
      seen.add(parent.slug);
      chain.unshift(parent);
      current = parent;
    }
    return chain;
  };

  return { bySlug, ancestorsOf };
}

/**
 * Resolve the whole route table for one locale.
 *
 * Only entries in the requested locale are routed: no URL strategy for
 * translations is assumed, and a build that silently published a German
 * entry at an English path would be inventing one.
 */
export function resolveSiteRoutes<
  Post extends EntryLike<PostEntryData>,
  Page extends EntryLike<PageEntryData>,
  Custom extends EntryLike<CustomEntryData> = never,
>(
  sources: RouteSources<Post, Page, Custom>,
): SiteRouteTable<Post, Page, Custom> {
  const problems = permalinkProblems();
  if (problems.length > 0)
    throw new Error(
      `migration.config.ts permalinks are not usable:\n  - ${problems.join("\n  - ")}`,
    );

  // A custom type whose profile this kit cannot honour must stop the build
  // here, before any route exists. The alternative is publishing a URL that
  // WordPress never served, which is the one thing a migration must not do.
  const postTypes = sources.postTypes ?? migration.postTypes;
  const profileProblems = postTypeProfileProblems(postTypes);
  if (profileProblems.length > 0)
    throw new Error(
      `migration.config.ts postTypes are not usable:\n  - ${profileProblems.join("\n  - ")}`,
    );

  const taxonomies = sources.taxonomies ?? migration.taxonomies;
  const taxonomyIssues = taxonomyProfileProblems(taxonomies, postTypes);
  if (taxonomyIssues.length > 0)
    throw new Error(
      `migration.config.ts taxonomies are not usable:\n  - ${taxonomyIssues.join("\n  - ")}`,
    );

  const { locale } = sources;
  const posts = orderPostsByDate(
    sources.posts.filter((post) => post.data.locale === locale),
  );
  const pages = sources.pages.filter((page) => page.data.locale === locale);
  const pagesBySlug = new Map(pages.map((page) => [page.data.slug, page]));
  const authorsBySlug = new Map(sources.authors.map((row) => [row.slug, row]));
  const categoriesBySlug = new Map(
    sources.categories.map((row) => [row.slug, row]),
  );
  const tagsBySlug = new Map(sources.tags.map((row) => [row.slug, row]));

  const routes: SiteRoute<Post, Page, Custom>[] = [];
  const hrefs = new Map<string, string>();

  // Pages: resolve each parent chain, outermost first.
  const parentsOf = (page: Page): Page[] => {
    const chain: Page[] = [];
    const seen = new Set<string>([page.data.slug]);
    let current: Page | undefined = page;
    while (current?.data.parent !== undefined) {
      const parent = pagesBySlug.get(current.data.parent);
      if (parent === undefined)
        throw new Error(
          `Page "${page.data.slug}" names parent "${current.data.parent}", which is not a ${locale} page. Fix the front matter or add the parent.`,
        );
      if (seen.has(parent.data.slug))
        throw new Error(
          `Page "${page.data.slug}" has a parent chain that loops through "${parent.data.slug}".`,
        );
      seen.add(parent.data.slug);
      chain.unshift(parent);
      current = parent;
    }
    return chain;
  };

  const postsIndex = postsIndexPath();
  const postsIndexKey = routeKey(postsIndex);
  let frontPage: PageRoute<Page> | ArchiveRoute<Post, Page> | undefined;
  let postsArchive: ArchiveRoute<Post, Page> | undefined;
  let indexPage: Page | undefined;

  for (const page of pages) {
    const parents = parentsOf(page);
    const isFront =
      permalinks.frontPage !== null &&
      page.data.slug === permalinks.frontPage &&
      parents.length === 0;
    const path = isFront
      ? "/"
      : pagePath(
          page.data.slug,
          parents.map((p) => p.data.slug),
        );
    const route: PageRoute<Page> = { kind: "page", path, entry: page, parents };
    hrefs.set(`page/${page.data.slug}`, path);
    if (isFront) {
      frontPage = route;
      continue;
    }
    // WordPress renders the posts LISTING at the posts page's own URL; the
    // page supplies the title and is not rendered as a page itself.
    if (routeKey(path) === postsIndexKey && postsIndexKey !== "/") {
      indexPage = page;
      continue;
    }
    routes.push(route);
  }

  // Posts.
  for (const post of posts) {
    const path = postPath(post.data, {
      authorNicename: authorsBySlug.get(post.data.author)?.nicename,
    });
    hrefs.set(`post/${post.data.slug}`, path);
    routes.push({ kind: "post", path, entry: post });
  }

  // Archives: page 1 at the base, 2..N under the pagination segment.
  const archive = (
    kind: ArchiveKind,
    base: string,
    title: string,
    items: readonly Post[],
    extra: { term?: TermRow; author?: AuthorRow; indexPage?: Page } = {},
  ): void => {
    const first = paginate(items, {
      page: 1,
      pageSize: permalinks.postsPerPage,
    });
    for (let number = 1; number <= first.pageCount; number += 1) {
      const page = paginate(items, {
        page: number,
        pageSize: permalinks.postsPerPage,
      });
      const path = paginatedPath(base, number);
      const route: ArchiveRoute<Post, Page> = {
        kind: "archive",
        path,
        archive: kind,
        base: paginatedPath(base, 1),
        title,
        page,
        ...extra,
      };
      if (kind === "posts" && number === 1) postsArchive = route;
      if (kind === "posts" && number === 1 && postsIndexKey === "/") {
        frontPage = route;
        continue;
      }
      routes.push(route);
    }
  };

  archive("posts", postsIndex, indexPage?.data.title ?? "Blog", posts, {
    indexPage,
  });
  // WordPress's own two taxonomies, through the SAME rules as a configured one:
  // duplicate slugs throw, a parent on a flat taxonomy throws, an unknown or
  // looping parent throws, and a hierarchical taxonomy's archive URL carries
  // its ancestors. `coreTaxonomies()` derives both profiles from `permalinks`,
  // so an existing configuration produces the URLs it always did — and a
  // category tree that was flat before still is, because it had no way to be
  // anything else.
  const termHrefs = new Map<string, string>();
  for (const taxonomy of coreTaxonomies()) {
    const rows =
      taxonomy.name === "category" ? sources.categories : sources.tags;
    const { ancestorsOf } = indexTerms(taxonomy, rows);
    for (const term of rows) {
      const base = termPath(
        taxonomy,
        term.slug,
        ancestorsOf(term).map((one) => one.slug),
      );
      termHrefs.set(`${taxonomy.name}/${term.slug}`, paginatedPath(base, 1));
      archive(
        taxonomy.name === "category" ? "category" : "tag",
        base,
        nameFor(term, locale, locale),
        posts.filter((post) =>
          termsOf(taxonomy, post.data).includes(term.slug),
        ),
        { term },
      );
    }
  }
  for (const author of sources.authors)
    archive(
      "author",
      authorPath(author.nicename ?? author.slug),
      author.name,
      posts.filter((post) => post.data.author === author.slug),
      { author },
    );

  // Custom post types. Each profile is explicit about all three questions —
  // is it published, does it have a listing, does it need taxonomy routing —
  // and the profile was validated above, so nothing here guesses.
  const routedCustom: Record<string, Custom[]> = {};
  for (const profile of postTypes) {
    const all = sources.custom?.[profile.collection] ?? [];
    // Same locale rule as everything else, and for the same reason: no URL
    // strategy for translations is assumed. `content:integrity` names each
    // withheld entry rather than letting it disappear.
    const entries = all.filter((entry) => entry.data.locale === locale);
    if (!profile.published) {
      routedCustom[profile.collection] = [];
      continue;
    }

    const ordered = [...entries].sort(
      (left, right) =>
        (right.data.publishedAt ?? "").localeCompare(
          left.data.publishedAt ?? "",
        ) || left.data.slug.localeCompare(right.data.slug),
    );
    routedCustom[profile.collection] = ordered;

    for (const entry of ordered) {
      const path = customTypePath(profile, entry.data);
      hrefs.set(`${profile.collection}/${entry.data.slug}`, path);
      routes.push({ kind: "custom", path, entry, profile });
    }

    if (profile.archive.kind !== "archive") continue;
    const base = customTypeArchivePath(profile);
    const first = paginate(ordered, {
      page: 1,
      pageSize: permalinks.postsPerPage,
    });
    for (let number = 1; number <= first.pageCount; number += 1)
      routes.push({
        kind: "custom-archive",
        path: paginatedPath(base, number),
        base: paginatedPath(base, 1),
        title: profile.archive.title,
        page: paginate(ordered, {
          page: number,
          pageSize: permalinks.postsPerPage,
        }),
        profile,
      });
  }

  // Custom taxonomies. Every profile was validated above, so nothing here
  // guesses — not the URL base, not whether ancestors appear in it, and not
  // which collections a term files.
  const routedTerms: Record<string, TaxonomyTermRow[]> = {};
  for (const taxonomy of taxonomies) {
    const rows = sources.terms?.[taxonomy.collection] ?? [];

    // WordPress guarantees this and the kit enforces it rather than inventing
    // a disambiguation WordPress does not have: `wp_unique_term_slug()` refuses
    // a slug that already exists in the SAME taxonomy, appending a parent
    // suffix or a number. Two terms sharing one slug here would share one URL.
    const { bySlug, ancestorsOf } = indexTerms(taxonomy, rows);

    // A term an entry names that the registry does not have.
    //
    // Nothing checked this before, at any layer: the content contract does not
    // read the `terms` map out of front matter, and the archive simply did not
    // list the entry — so a typo in a taxonomy term made a product quietly
    // vanish from the listing it belonged in, with every gate green.
    //
    // Checked HERE because this is the earliest layer that holds both sides:
    // `sources.custom` carries every entry in EVERY locale (the locale filter
    // is applied below, not before), and `rows` is the whole registry.
    for (const collection of taxonomy.appliesTo) {
      for (const entry of sources.custom?.[collection] ?? []) {
        for (const named of entry.data.terms?.[taxonomy.name] ?? []) {
          if (bySlug.has(named)) continue;
          throw new Error(
            `Entry "${collection}/${entry.data.slug}" files itself under ` +
              `${taxonomy.name} term "${named}", which is not in ` +
              `content/${taxonomy.collection}.json. The term archive would ` +
              `simply not list it, so seed the registry rather than removing ` +
              `the reference.`,
          );
        }
      }
    }

    routedTerms[taxonomy.collection] = taxonomy.published ? [...rows] : [];
    if (!taxonomy.published) continue;

    for (const term of rows) {
      const ancestors = ancestorsOf(term);
      // The union across every collection the taxonomy applies to, ordered the
      // way a custom archive is. One taxonomy on two types is what WordPress
      // does; picking one of them silently would drop half the archive.
      const items = taxonomy.appliesTo
        .flatMap((collection) => routedCustom[collection] ?? [])
        .filter((entry) =>
          (entry.data.terms?.[taxonomy.name] ?? []).includes(term.slug),
        )
        .sort(
          (left, right) =>
            (right.data.publishedAt ?? "").localeCompare(
              left.data.publishedAt ?? "",
            ) || left.data.slug.localeCompare(right.data.slug),
        );

      const base = termPath(
        taxonomy,
        term.slug,
        ancestors.map((one) => one.slug),
      );
      const first = paginate(items, {
        page: 1,
        pageSize: permalinks.postsPerPage,
      });
      for (let number = 1; number <= first.pageCount; number += 1)
        routes.push({
          kind: "taxonomy-archive",
          path: paginatedPath(base, number),
          base: paginatedPath(base, 1),
          title:
            term.name[locale] ?? term.name[defaultLocaleOf(term)] ?? term.slug,
          page: paginate(items, {
            page: number,
            pageSize: permalinks.postsPerPage,
          }),
          taxonomy,
          term,
          ancestors,
          collections: taxonomy.appliesTo,
        });
    }
  }

  // Two routes, one path: the collision every static host resolves silently
  // by serving one of them.
  const claimed = new Map<string, SiteRoute<Post, Page, Custom>>();
  for (const route of routes) {
    const key = routeKey(route.path);
    const other = claimed.get(key);
    if (other !== undefined)
      throw new Error(
        `Two routes claim ${route.path}: ${describe(other)} and ${describe(route)}. ` +
          "One URL, one page — change a slug, a parent or a permalink pattern.",
      );
    if (key === "/")
      throw new Error(
        `${describe(route)} resolves to "/", which index.astro owns. Only the configured front page or the posts index may live there.`,
      );
    claimed.set(key, route);
  }

  return {
    routes,
    frontPage,
    postsArchive,
    posts,
    pages,
    hrefOf: (kind, slug) => hrefs.get(`${kind}/${slug}`),
    postsIndex,
    authorOf: (slug) => authorsBySlug.get(slug),
    categoryOf: (slug) => categoriesBySlug.get(slug),
    tagOf: (slug) => tagsBySlug.get(slug),
    termHref: (taxonomy, slug) => termHrefs.get(`${taxonomy}/${slug}`),
    custom: routedCustom,
    postTypes,
    taxonomies,
    allTaxonomies: [...coreTaxonomies(), ...userTaxonomies(taxonomies)],
    terms: routedTerms,
  };
}

/** The `[...path]` parameter for a route: the path with no leading or trailing slash. */
export function routeParam(path: string): string {
  return routeKey(path).replace(/^\//, "");
}
