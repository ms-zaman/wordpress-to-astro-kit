// URL keys and families — the pure half of the site-map audit.
//
// Two different strings matter for every URL and they must never be merged:
// the PUBLIC PATH exactly as the source site serves it, and the COMPARISON KEY
// the diff joins on. The key normalizes only what provably cannot change
// identity on either side: scheme, host case, fragment, and the trailing slash
// on extension-less paths. WordPress 301s the slashless form and Astro's
// directory output serves both, so that one is safe.
//
// Everything else — prefixes, archive shapes, language segments, query strings
// — stays, because those differences are the audit's SUBJECT, not its noise.
// A key that collapsed `/?s=hello` onto `/` would hide a search page.
//
// ## Families come from your config, not from a list
//
// `classifyFamily` reads `migration.config.ts`. A post is whatever
// `permalinks.post` describes on YOUR source site, so a site at
// `/%year%/%monthnum%/%postname%/` and one at `/blog/%postname%/` are both
// classified correctly with no code change.
//
// On top of that sit the shapes WordPress serves whether or not anybody
// configured them: date archives, feeds, the `wp-*` runtime, attachment and
// upload paths, and paginated variants of any archive. Those are universals,
// so they are recognised without config.
import { migration, type Permalinks } from "../../migration.config.ts";

export type Family =
  /** The configured front page. */
  | "front-page"
  /** The posts listing. */
  | "posts-index"
  /** Matches `permalinks.post`. */
  | "post"
  /** Matches `permalinks.page`. */
  | "page"
  /** Matches both, and the patterns cannot tell them apart from the URL alone. */
  | "entry"
  | "category"
  | "tag"
  | "author"
  /** Page 2..N of any archive. */
  | "pagination"
  /** `/2024/`, `/2024/03/`, `/2024/03/17/`, with or without a prefix. */
  | "date-archive"
  /** A translation plugin's language prefix. */
  | "translated"
  /** `/feed/`, `/comments/feed/`, and per-page feed aliases. */
  | "feed"
  | "sitemap"
  /** `wp-admin`, `wp-json`, `wp-login.php`, `xmlrpc.php`. */
  | "wp-internal"
  /** `wp-content/uploads` and anything with a file extension. */
  | "media"
  /** A URL whose only difference from another is its query string. */
  | "query-variant"
  /** WordPress's own search. */
  | "search"
  | "unknown";

/** Path looks like a file (has an extension), so no trailing slash is added. */
const FILE_LIKE = /\.[a-z0-9]{1,5}$/i;

/**
 * The comparison key for a URL: pathname plus query, fragment dropped,
 * trailing slash added to extension-less paths.
 *
 * `null` for anything outside the audit's universe — another origin, a
 * `mailto:`, a `tel:`. Those are recorded by the crawl as external and never
 * fetched.
 */
export function comparisonKey(url: string, origin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.origin !== new URL(origin).origin) return null;
  let path = parsed.pathname;
  if (!FILE_LIKE.test(path) && !path.endsWith("/")) path += "/";
  return path + parsed.search;
}

const TOKEN = /%([a-z_]+)%/g;

/**
 * What each permalink token can match in a URL.
 *
 * `%pagename%` is the exception and it matters: WordPress expands it to a
 * page's whole hierarchy path, so `/about/team/` is one page and not a page
 * under a page. It therefore matches slashes; every other token matches one
 * segment.
 */
const TOKEN_PATTERN: Readonly<Record<string, string>> = {
  postname: "[^/]+",
  pagename: "[^?#]+",
  slug: "[^/]+",
  nicename: "[^/]+",
  category: "[^/]+",
  author: "[^/]+",
  year: "\\d{4}",
  monthnum: "\\d{2}",
  day: "\\d{2}",
};

const escapeLiteral = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A permalink pattern as a regular expression over comparison keys.
 *
 * Anchored at both ends, and tolerant of the trailing slash the key adds.
 */
export function patternToRegExp(pattern: string): RegExp {
  let source = "";
  let lastIndex = 0;
  for (const match of pattern.matchAll(TOKEN)) {
    source += escapeLiteral(pattern.slice(lastIndex, match.index));
    source += TOKEN_PATTERN[match[1] ?? ""] ?? "[^/]+";
    lastIndex = match.index + match[0].length;
  }
  source += escapeLiteral(pattern.slice(lastIndex));
  return new RegExp(`^${source.replace(/\/$/, "")}/?$`);
}

/**
 * How specific a pattern is: the number of LITERAL characters in it.
 *
 * `/blog/%postname%/` beats `/%postname%/` because it says more. Used to
 * resolve a key that several patterns match, so a site that puts posts under a
 * prefix and pages at the root classifies both correctly.
 */
const specificity = (pattern: string): number =>
  pattern.replace(TOKEN, "").length;

/** One configured shape and what it means. */
interface Shape {
  readonly family: Family;
  readonly pattern: string;
  readonly test: RegExp;
  readonly weight: number;
}

function shapesOf(permalinks: Permalinks): Shape[] {
  const entries: [Family, string][] = [
    ["post", permalinks.post],
    ["page", permalinks.page],
    ["category", permalinks.category],
    ["tag", permalinks.tag],
    ["author", permalinks.author],
  ];
  return entries.map(([family, pattern]) => ({
    family,
    pattern,
    test: patternToRegExp(pattern),
    weight: specificity(pattern),
  }));
}

/** A path with its language prefix removed, when it carries one. */
function stripLanguagePrefix(
  path: string,
  prefixes: readonly string[],
): { path: string; translated: boolean } {
  const first = path.split("/").filter(Boolean)[0];
  if (first !== undefined && prefixes.includes(first))
    return { path: path.slice(first.length + 1) || "/", translated: true };
  return { path, translated: false };
}

export interface ClassifyOptions {
  readonly permalinks?: Permalinks;
  readonly languagePrefixes?: readonly string[];
}

/**
 * Classify a comparison key into a route family.
 *
 * The order is deliberate. WordPress's universal surfaces are recognised
 * first, because they are unambiguous and a permalink pattern like
 * `/%postname%/` would otherwise swallow `/feed/`. Configured patterns come
 * next, most specific first. What is left is `unknown`, which is the audit's
 * word for "a person has to look at this".
 */
export function classifyFamily(
  key: string,
  options: ClassifyOptions = {},
): Family {
  const permalinks = options.permalinks ?? migration.permalinks;
  const prefixes = options.languagePrefixes ?? migration.liveLanguagePrefixes;

  const [rawPath = key, query] = key.split("?");
  if (query !== undefined && query !== "") {
    // WordPress's own search, whatever the theme calls it.
    if (new URLSearchParams(query).has("s")) return "search";
    return "query-variant";
  }

  const { path, translated } = stripLanguagePrefix(rawPath, prefixes);
  if (translated) return "translated";

  const segments = path.split("/").filter((segment) => segment.length > 0);
  const first = segments[0];

  if (segments.length === 0) return "front-page";

  // --- WordPress universals, before any configured pattern ------------------

  if (
    first === "wp-admin" ||
    first === "wp-json" ||
    first === "wp-login.php" ||
    first === "xmlrpc.php"
  )
    return "wp-internal";
  if (first === "wp-content" || first === "wp-includes") return "media";
  if (path.endsWith(".xml") && /sitemap/i.test(path)) return "sitemap";
  if (segments.at(-1) === "feed") return "feed";
  if (FILE_LIKE.test(path)) return "media";

  // Page 2..N of any archive, at the configured segment.
  const paginationSegment = escapeLiteral(permalinks.paginationSegment);
  if (new RegExp(`/${paginationSegment}/\\d+/?$`).test(path))
    return "pagination";

  // Date archives. WordPress serves `/YYYY/`, `/YYYY/MM/` and `/YYYY/MM/DD/`
  // for every site, optionally under the posts-index prefix, and they exist
  // whether or not the permalink structure mentions a date. A site with 250
  // posts serves hundreds of them, and a successor almost never reproduces
  // them — so they need a family of their own rather than reading as `unknown`
  // and burying everything else in the report.
  const withoutPostsPrefix = path.startsWith(permalinks.postsIndex)
    ? path.slice(permalinks.postsIndex.length - 1)
    : path;
  if (/^\/\d{4}(\/\d{2}(\/\d{2})?)?\/?$/.test(withoutPostsPrefix))
    return "date-archive";

  // --- Configured shapes, most specific first -------------------------------

  if (path === permalinks.postsIndex) return "posts-index";

  const matched = shapesOf(permalinks)
    .filter((shape) => shape.test.test(path))
    .sort((left, right) => right.weight - left.weight);

  if (matched.length === 0) return "unknown";

  const best = matched[0]!;
  const tied = matched.filter((shape) => shape.weight === best.weight);

  // `/%postname%/` and `/%pagename%/` are the same regular expression. A
  // single-segment URL genuinely cannot be told apart from the URL alone, and
  // saying "post" would be a guess presented as a measurement.
  if (tied.length > 1) {
    const families = new Set(tied.map((shape) => shape.family));
    if (families.size === 1) return best.family;
    if (families.has("post") && families.has("page") && families.size === 2)
      return "entry";
    return "unknown";
  }

  return best.family;
}

/**
 * Families a successor is not expected to publish, with the reason.
 *
 * Not "retired": these are surfaces that belong to WordPress itself rather
 * than to the site's content, so a static successor having no equivalent is
 * the normal outcome rather than a gap somebody has to rule on. The diff still
 * counts them, and the report still lists them, so nothing disappears — they
 * simply do not fail the run.
 *
 * `translated` is NOT here. A language prefix is content somebody wrote, and
 * whether to carry it is a decision (`decisions/ADR/`, multilingual routing),
 * so it stays a gap until a project rules on it.
 */
export const INFRASTRUCTURE_FAMILIES: ReadonlyMap<Family, string> = new Map([
  [
    "wp-internal",
    "WordPress's own runtime (wp-admin, wp-json, wp-login, xmlrpc) — not a page of the site",
  ],
  [
    "media",
    "an uploaded file or an asset path, not a page — the media seam decides where these are served from",
  ],
  [
    "feed",
    "a WordPress feed. A static build can emit feeds; whether yours should is a decision, not a routing gap",
  ],
  ["sitemap", "the source site's own sitemap files — this build emits its own"],
  [
    "query-variant",
    "the same page with a query string appended, usually by a link somebody shared",
  ],
  [
    "search",
    "WordPress's own search results — this build has its own search route",
  ],
]);
