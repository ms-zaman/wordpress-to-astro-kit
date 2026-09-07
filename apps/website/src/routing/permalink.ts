// Permalinks: WordPress's URL structure, expressed as patterns, expanded into
// this site's one URL shape.
//
// The patterns come from `migration.config.ts`. Every route the site
// publishes is composed here and nowhere else, so changing a pattern changes
// every link, canonical, sitemap row and redirect target together — and no
// route file has to be renamed to preserve a live site's URLs.
import { migration, type Permalinks } from "../../../../migration.config.ts";
import { routeKey, sitePath } from "./url-shape.ts";

export const permalinks: Permalinks = migration.permalinks;

const TOKEN = /%([a-z_]+)%/g;

/** The tokens a pattern may use, per pattern, so a typo fails at build time. */
export const PATTERN_TOKENS: Readonly<
  Record<
    keyof Pick<Permalinks, "post" | "page" | "category" | "tag" | "author">,
    readonly string[]
  >
> = {
  post: ["postname", "year", "monthnum", "day", "category", "author"],
  page: ["pagename"],
  category: ["slug"],
  tag: ["slug"],
  author: ["nicename"],
};

/**
 * Expand a pattern with the values a route supplies. Throws on a token the
 * caller did not supply — a URL with a literal `%postname%` in it is not a
 * URL, and a build that emitted one would publish it.
 */
export function expandPattern(
  pattern: string,
  values: Readonly<Record<string, string | undefined>>,
): string {
  const expanded = pattern.replace(TOKEN, (_whole, name: string) => {
    const value = values[name];
    if (value === undefined || value === "")
      throw new Error(
        `Permalink pattern "${pattern}" uses %${name}%, and no value was supplied for it.`,
      );
    return value;
  });
  return sitePath(expanded);
}

/** Every problem with the configured patterns: unknown tokens, missing slashes. */
export function permalinkProblems(config: Permalinks = permalinks): string[] {
  const problems: string[] = [];
  for (const [name, allowed] of Object.entries(PATTERN_TOKENS)) {
    const pattern = config[name as keyof typeof PATTERN_TOKENS];
    if (!pattern.startsWith("/"))
      problems.push(`permalinks.${name} must start with "/": got "${pattern}"`);
    for (const match of pattern.matchAll(TOKEN)) {
      const token = match[1] ?? "";
      if (!allowed.includes(token))
        problems.push(
          `permalinks.${name} uses %${token}%, which it cannot: allowed tokens are ${allowed
            .map((value) => `%${value}%`)
            .join(", ")}`,
        );
    }
    if (!TOKEN.test(pattern) && name !== "page")
      problems.push(
        `permalinks.${name} has no token, so every entry would share one URL`,
      );
    TOKEN.lastIndex = 0;
  }
  if (!config.postsIndex.startsWith("/"))
    problems.push(`permalinks.postsIndex must start with "/"`);
  if (!/^[a-z0-9-]+$/.test(config.paginationSegment))
    problems.push(
      `permalinks.paginationSegment must be a lowercase URL segment`,
    );
  if (!Number.isInteger(config.postsPerPage) || config.postsPerPage < 1)
    problems.push(`permalinks.postsPerPage must be a positive integer`);
  if (config.frontPage !== null && routeKey(config.postsIndex) === "/")
    problems.push(
      `permalinks.frontPage is "${config.frontPage}" but postsIndex is "/": the front page cannot be both a page and the posts listing`,
    );
  return problems;
}

export interface PostPathInput {
  readonly slug: string;
  readonly publishedAt: string;
  readonly categories: readonly string[];
  readonly author: string;
}

/** The URL a post is published at. `%author%` takes the author's nicename. */
export function postPath(
  post: PostPathInput,
  options: { readonly authorNicename?: string } = {},
): string {
  const [year, month, day] = post.publishedAt.split("-");
  return expandPattern(permalinks.post, {
    postname: post.slug,
    year,
    monthnum: month,
    day,
    category: post.categories[0],
    author: options.authorNicename ?? post.author,
  });
}

/** The URL a page is published at: its hierarchy path through `%pagename%`. */
export function pagePath(slug: string, parentSlugs: readonly string[]): string {
  return expandPattern(permalinks.page, {
    pagename: [...parentSlugs, slug].join("/"),
  });
}

export function categoryPath(slug: string): string {
  return expandPattern(permalinks.category, { slug });
}

export function tagPath(slug: string): string {
  return expandPattern(permalinks.tag, { slug });
}

export function authorPath(nicename: string): string {
  return expandPattern(permalinks.author, { nicename });
}

/** Where the posts listing lives. */
export function postsIndexPath(): string {
  return sitePath(permalinks.postsIndex);
}

/**
 * The URL of one page of an archive. Page 1 is the archive's own URL — two
 * URLs for one page of results is a duplicate-content defect.
 */
export function paginatedPath(base: string, page: number): string {
  if (!Number.isInteger(page) || page < 1)
    throw new RangeError(`Pagination: page ${page} is not a page number.`);
  return page === 1
    ? sitePath(base)
    : sitePath(`${routeKey(base)}/${permalinks.paginationSegment}/${page}`);
}

const PAGINATED = new RegExp(
  `/${permalinks.paginationSegment.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}/\\d+/?$`,
);

/** True for page 2..N of an archive. */
export function isPaginationPath(path: string): boolean {
  return PAGINATED.test(path);
}
