// One URL shape for the whole site.
//
// A site that emits two shapes for one page — `/pricing` in every link and
// `/pricing/` in the canonical, the sitemap and the source site's published
// URL — points every link at a URL it itself declares non-canonical. What that
// costs depends on the host: one that normalises to the directory form answers
// every link with a 301 before serving anything; one that serves both shapes
// with 200 publishes the whole site twice.
//
// The trailing slash, because that is what WordPress publishes by default and
// what search engines already hold for the site being migrated.
//
// Deliberately left alone: absolute URLs, and paths that end in a file
// extension — `/sitemap.xml`, `/robots.txt` are files, not directories.

/** A path that names a file rather than a directory. */
const FILE_LIKE = /\.[a-z0-9]{2,5}$/i;

/** True when the value is already absolute (scheme-relative included). */
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * The canonical shape of a root-relative site path: exactly one trailing
 * slash, placed before any query string or fragment. Idempotent, so it is
 * safe to apply at every seam rather than exactly once.
 */
export function sitePath(path: string): string {
  if (path === "" || ABSOLUTE.test(path)) return path === "" ? "/" : path;

  const split = path.search(/[?#]/);
  const base = split === -1 ? path : path.slice(0, split);
  const suffix = split === -1 ? "" : path.slice(split);

  const clean = base.replace(/\/{2,}/g, "/");
  if (clean === "" || clean === "/") return `/${suffix}`;
  if (FILE_LIKE.test(clean)) return `${clean}${suffix}`;
  return `${clean.replace(/\/+$/, "")}/${suffix}`;
}

/**
 * A route's KEY: the slash-free form every inventory, manifest, audit and
 * redirect row joins on. `/blog/` and `/blog` are the same route; the link
 * shape is `sitePath`'s and the key is this.
 */
export function routeKey(path: string): string {
  if (path === "/") return "/";
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}
