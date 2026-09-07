// The launch switch.
//
// One variable, `WPK_SITE_ENV`, decides which of two sites a build is:
//
//   - `preview` (the default, and what every CI run builds): every page is
//     `noindex`, `robots.txt` disallows everything, `sitemap.xml` carries no
//     rows and the footer states the scope. A preview must never compete with
//     the live site in an index, and the default is the safe direction — an
//     unset variable produces the build that cannot do harm.
//   - `production`: indexable pages carry the indexable directive,
//     `robots.txt` allows crawling and names the sitemap, `sitemap.xml` lists
//     every indexable page, and the scope notice is gone.
//
// Nothing else reads the variable. Every surface that changes at launch asks
// this module, so the difference between the two builds is enumerable: grep
// for `siteEnvironment(` and you have the complete list. The value is also
// recorded in `dist/deployment.json` (`build.environment`), which is what lets
// the build audit check the right contract for the build it is reading.
//
// The switch is an engineering seam, not the launch decision itself. Flipping
// it in a deploy pipeline is the owner's call, and the launch runbook lists
// what else has to be true that day. **Do not flip it before the DNS cutover:**
// a production build served anywhere public while WordPress still answers the
// domain puts two copies of every page in one index.
import { isPaginationPath as isPaginatedArchive } from "../routing/permalink.ts";

export type SiteEnvironment = "preview" | "production";

export const SITE_ENVIRONMENT_KEY = "WPK_SITE_ENV";

export const SITE_ENVIRONMENTS: readonly SiteEnvironment[] = [
  "preview",
  "production",
];

/** `process.env` without `@types/node` — the same shape the manifest reads. */
export const processEnvironment = (): Readonly<
  Record<string, string | undefined>
> =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};

/**
 * Which site this build is. Unset or empty means `preview`; a value that is
 * neither environment throws, because "prod" silently building a preview is
 * the kind of typo that would be discovered from a search console.
 */
export function siteEnvironment(
  source: Readonly<Record<string, string | undefined>> = processEnvironment(),
): SiteEnvironment {
  const raw = source[SITE_ENVIRONMENT_KEY]?.trim();
  if (raw === undefined || raw === "") return "preview";
  if (raw === "preview" || raw === "production") return raw;
  throw new Error(
    `${SITE_ENVIRONMENT_KEY} is "${raw}"; it must be "preview" or ` +
      `"production" (or unset, which means preview).`,
  );
}

export const isProduction = (
  source?: Readonly<Record<string, string | undefined>>,
): boolean => siteEnvironment(source) === "production";

/**
 * Paths that are `noindex` in EVERY environment: a results page whose content
 * is whatever was typed, and the not-found page.
 */
export const NEVER_INDEXED_PATHS: readonly string[] = ["/search", "/404"];

const normalizePath = (pathname: string): string => {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
};

/** True when a page may be indexed in production. */
export function isIndexablePath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return !NEVER_INDEXED_PATHS.includes(path) && path !== "/404.html";
}

/** True for page 2..N of a paginated archive. */
export function isPaginationPath(pathname: string): boolean {
  return isPaginatedArchive(normalizePath(pathname));
}

/**
 * The robots directive an indexable page emits in production. WordPress's own
 * default directive, so the head reads the same to a crawler before and after
 * cutover.
 */
export const INDEXABLE_ROBOTS = "index, follow, max-image-preview:large";

export function robotsDirective(
  pathname: string,
  environment: SiteEnvironment,
): "noindex" | typeof INDEXABLE_ROBOTS {
  if (environment !== "production") return "noindex";
  return isIndexablePath(pathname) ? INDEXABLE_ROBOTS : "noindex";
}

/**
 * Whether a page belongs in `sitemap.xml`. Paginated archive pages are
 * indexable but not listed — a sitemap names canonical entry points, and page
 * 3 of an archive is reachable from page 2.
 */
export function sitemapIncludes(
  pathname: string,
  environment: SiteEnvironment,
): boolean {
  return (
    environment === "production" &&
    isIndexablePath(pathname) &&
    !isPaginationPath(pathname)
  );
}
