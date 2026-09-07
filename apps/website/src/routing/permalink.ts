// Permalinks: WordPress's URL structure, expressed as patterns, expanded into
// this site's one URL shape.
//
// The patterns come from `migration.config.ts`. Every route the site
// publishes is composed here and nowhere else, so changing a pattern changes
// every link, canonical, sitemap row and redirect target together — and no
// route file has to be renamed to preserve a live site's URLs.
import {
  migration,
  type Permalinks,
  type PostTypeProfile,
} from "../../../../migration.config.ts";
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
 * The tokens a CUSTOM post type's pattern may use.
 *
 * A shorter list than `post`'s, and the two omissions are the point:
 *
 *   `%category%` — a taxonomy-dependent URL needs taxonomy routing, and this
 *   kit routes taxonomies for posts only. An entry usually has SEVERAL terms,
 *   so expanding it would pick one and publish a URL WordPress never served.
 *   Refused by name rather than approximated.
 *
 *   `%author%` — a custom type need not be attached to the author registry at
 *   all, and expanding an author into a URL for a type that has none would
 *   fail at build time on some entries and not others.
 *
 * What is here is what has been exercised end to end: a fixed prefix, the post
 * name, and the date parts.
 */
export const CUSTOM_TYPE_TOKENS: readonly string[] = [
  "postname",
  "year",
  "monthnum",
  "day",
];

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

/**
 * Everything wrong with one custom post type's profile.
 *
 * Separate from `permalinkProblems` because these are per-profile and the
 * caller reports them by type name — but the same rule applies: a pattern this
 * kit cannot expand is a build failure, never a route it invents.
 */
export function postTypeProblems(profile: PostTypeProfile): string[] {
  const problems: string[] = [];
  const where = `postTypes["${profile.name}"]`;

  if (!/^[a-z0-9][a-z0-9-]*$/.test(profile.collection))
    problems.push(
      `${where}.collection must be a lowercase directory name: got "${profile.collection}"`,
    );
  if (!profile.permalink.startsWith("/"))
    problems.push(
      `${where}.permalink must start with "/": got "${profile.permalink}"`,
    );

  const tokens = [...profile.permalink.matchAll(TOKEN)].map(
    (match) => match[1] ?? "",
  );
  for (const token of tokens)
    if (!CUSTOM_TYPE_TOKENS.includes(token))
      problems.push(
        `${where}.permalink uses %${token}%, which this kit cannot expand for a ` +
          `custom type. Supported: ${CUSTOM_TYPE_TOKENS.map((one) => `%${one}%`).join(", ")}.` +
          (token === "category" || token === "tag"
            ? " A taxonomy-dependent URL needs taxonomy routing, which this kit " +
              "has for posts only — see the capability boundary in " +
              "scripts/content-integrity/README.md."
            : ""),
      );
  if (!tokens.includes("postname"))
    problems.push(
      `${where}.permalink has no %postname%, so every entry of the type would ` +
        `share one URL`,
    );

  if (
    profile.archive.kind === "archive" &&
    !profile.archive.path.startsWith("/")
  )
    problems.push(`${where}.archive.path must start with "/"`);

  if (profile.taxonomies.archives)
    problems.push(
      `${where}.taxonomies.archives is true, and this kit cannot publish ` +
        `taxonomy archives for a custom type. Its taxonomy routing is written ` +
        `against posts — the categories and tags registries, filtered over the ` +
        `posts collection. Set it to false: the attached taxonomies are still ` +
        `recorded and the terms still travel on each entry, but no archive is ` +
        `published for them. Claiming otherwise would ship listings nobody ` +
        `checked.`,
    );

  if (!profile.published && profile.archive.kind === "archive")
    problems.push(
      `${where} is not published but declares an archive. A listing of pages ` +
        `that do not exist is a page of dead links.`,
    );

  return problems;
}

/** Every profile's problems, named by type, for one message at build time. */
export function postTypeProfileProblems(
  profiles: readonly PostTypeProfile[] = migration.postTypes,
): string[] {
  const problems: string[] = [];
  const seenCollections = new Map<string, string>();
  const seenNames = new Set<string>();

  for (const profile of profiles) {
    if (seenNames.has(profile.name))
      problems.push(`postTypes declares "${profile.name}" more than once`);
    seenNames.add(profile.name);

    const owner = seenCollections.get(profile.collection);
    if (owner !== undefined)
      problems.push(
        `postTypes["${profile.name}"] and postTypes["${owner}"] both use ` +
          `collection "${profile.collection}". Two types in one directory cannot ` +
          `be told apart, and one would silently overwrite the other's identity.`,
      );
    seenCollections.set(profile.collection, profile.name);

    if (RESERVED_COLLECTIONS.has(profile.collection))
      problems.push(
        `postTypes["${profile.name}"] uses collection "${profile.collection}", ` +
          `which is one of the kit's own. Choose another directory name.`,
      );

    problems.push(...postTypeProblems(profile));
  }
  return problems;
}

/** Collection names the kit's core content model already owns. */
const RESERVED_COLLECTIONS = new Set([
  "posts",
  "pages",
  "authors",
  "categories",
  "tags",
  "navigation",
  "seo",
  "config",
]);

/** The URL one custom-type entry is published at. */
export function customTypePath(
  profile: PostTypeProfile,
  entry: { readonly slug: string; readonly publishedAt?: string },
): string {
  const [year, month, day] = (entry.publishedAt ?? "").split("-");
  return expandPattern(profile.permalink, {
    postname: entry.slug,
    year,
    monthnum: month,
    day,
  });
}

/** The URL a custom type's listing lives at, when it has one. */
export function customTypeArchivePath(profile: PostTypeProfile): string {
  if (profile.archive.kind !== "archive")
    throw new Error(
      `postTypes["${profile.name}"] has no archive, so it has no archive path.`,
    );
  return sitePath(profile.archive.path);
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
