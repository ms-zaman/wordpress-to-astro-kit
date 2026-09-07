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
import { paginate, type PageOf } from "../content-index/pagination.ts";
import { routeKey } from "./url-shape.ts";
import {
  authorPath,
  categoryPath,
  pagePath,
  paginatedPath,
  permalinkProblems,
  permalinks,
  postPath,
  postsIndexPath,
  tagPath,
} from "./permalink.ts";

export interface PostEntryData {
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
  readonly slug: string;
  readonly name: string;
  readonly nicename?: string;
  readonly bio?: string;
  readonly avatar?: { readonly url: string; readonly alt?: string };
}

export interface TermRow {
  readonly slug: string;
  readonly name: Readonly<Partial<Record<string, string>>>;
}

export interface RouteSources<
  Post extends EntryLike<PostEntryData>,
  Page extends EntryLike<PageEntryData>,
> {
  readonly posts: readonly Post[];
  readonly pages: readonly Page[];
  readonly authors: readonly AuthorRow[];
  readonly categories: readonly TermRow[];
  readonly tags: readonly TermRow[];
  readonly locale: string;
}

export type ArchiveKind = "posts" | "category" | "tag" | "author";

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

export type SiteRoute<Post, Page> =
  PageRoute<Page> | PostRoute<Post> | ArchiveRoute<Post, Page>;

export interface SiteRouteTable<
  Post extends EntryLike<PostEntryData>,
  Page extends EntryLike<PageEntryData>,
> {
  /** Every route the `[...path]` module renders. Never includes `/`. */
  readonly routes: readonly SiteRoute<Post, Page>[];
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
}

/** The display name of a registry row in a locale, falling back to the default. */
export function nameFor(
  row: TermRow,
  locale: string,
  defaultLocale: string,
): string {
  return row.name[locale] ?? row.name[defaultLocale] ?? row.slug;
}

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
>(
  route: SiteRoute<Post, Page>,
): string =>
  route.kind === "page"
    ? `page "${route.entry.data.slug}"`
    : route.kind === "post"
      ? `post "${route.entry.data.slug}"`
      : `${route.archive} archive "${route.title}" page ${route.page.page}`;

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
>(sources: RouteSources<Post, Page>): SiteRouteTable<Post, Page> {
  const problems = permalinkProblems();
  if (problems.length > 0)
    throw new Error(
      `migration.config.ts permalinks are not usable:\n  - ${problems.join("\n  - ")}`,
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

  const routes: SiteRoute<Post, Page>[] = [];
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
  for (const term of sources.categories)
    archive(
      "category",
      categoryPath(term.slug),
      nameFor(term, locale, locale),
      posts.filter((post) => post.data.categories.includes(term.slug)),
      { term },
    );
  for (const term of sources.tags)
    archive(
      "tag",
      tagPath(term.slug),
      nameFor(term, locale, locale),
      posts.filter((post) => (post.data.tags ?? []).includes(term.slug)),
      { term },
    );
  for (const author of sources.authors)
    archive(
      "author",
      authorPath(author.nicename ?? author.slug),
      author.name,
      posts.filter((post) => post.data.author === author.slug),
      { author },
    );

  // Two routes, one path: the collision every static host resolves silently
  // by serving one of them.
  const claimed = new Map<string, SiteRoute<Post, Page>>();
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
  };
}

/** The `[...path]` parameter for a route: the path with no leading or trailing slash. */
export function routeParam(path: string): string {
  return routeKey(path).replace(/^\//, "");
}
