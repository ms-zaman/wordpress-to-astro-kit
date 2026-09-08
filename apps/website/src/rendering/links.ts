// Absolute links to the source site, made this site's own.
//
// ## The defect this closes
//
// A WordPress body written in the block or a page-builder editor stores
// internal links ABSOLUTELY — `https://source.example/support/`, not
// `/support/`. Measured on a live install: 17 of 18 internal links on one page
// were absolute. Migrate that body verbatim and every internal link on the new
// site points at the old one.
//
// It survived every gate, and that is the part worth remembering.
// `preview-audit` classifies any reference carrying a scheme as `external` and
// does not check it, so a site could migrate with every internal link pointing
// at the server it was migrating away from and the link gate would report
// nothing. The media engine does not catch it either — correctly, because a
// link to a page is not media.
//
// ## The rule, and the two paths it refuses to touch
//
// A reference is made root-relative when its origin is the SOURCE's — nothing
// else. And two path prefixes are left absolute even then:
//
//   `/wp-content/`   plugin and theme assets, and the source CMS's generated
//   `/wp-includes/`  files. A static Astro site does not serve these paths, so
//                    internalising one turns a working absolute URL into a 404.
//                    If you want them locally, `media.extraPaths` copies them
//                    and the media engine rewrites them to `localBase` before
//                    this runs.
//
// Uploads never reach here: the media engine runs first and has already
// rewritten what it owns.
import { migration } from "../../../../migration.config.ts";

/** Attributes that can carry a link to another page of the same site. */
const ATTRIBUTE = /\b(href|src|action|poster|data-href)=("|')([^"']*)\2/gi;

/**
 * Source-CMS namespaces a static build does not serve. These two are facts
 * about WordPress, so they live here; anything particular to the source HOST —
 * a forum, a shop, a second install under the same domain — is
 * `migration.notMigratedPaths`, because only discovery can know it.
 */
const CMS_PATHS = ["/wp-content/", "/wp-includes/"];

/**
 * A path naming a FILE rather than a page.
 *
 * The media engine runs before this does and has already rewritten every file
 * it owns to `media.localBase`. So a reference still pointing at the source
 * host AND carrying an extension is a file this build does not emit, and
 * making it root-relative can only turn a working download into a 404.
 *
 * Measured on ja.wordpress.org: 4,087 of the 4,102 broken internal links in
 * the first complete build were release archives — `/wordpress-3.9-ja.zip` and
 * its like — absolute in the source body, internalised here, served by nobody.
 */
const FILE_LIKE = /\.[a-z0-9]{2,5}$/i;

/** True when the path is under one of the declared not-migrated prefixes. */
const isNotMigrated = (
  pathname: string,
  prefixes: readonly string[],
): boolean =>
  prefixes.some(
    (prefix) =>
      pathname === prefix.replace(/\/+$/, "") ||
      pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );

/** Every reference that must stay absolute, whatever its reason. */
const keepAbsolute = (pathname: string, prefixes: readonly string[]): boolean =>
  FILE_LIKE.test(pathname) ||
  CMS_PATHS.some((prefix) => pathname.startsWith(prefix)) ||
  isNotMigrated(pathname, prefixes);

/** `https://www.x.com` and `http://x.com` are one origin. */
const hostKey = (host: string): string =>
  host.toLowerCase().replace(/^www\./, "");

/**
 * Rewrite absolute references on the source origin to root-relative ones.
 *
 * `origin` is required rather than defaulted, for the reason `mediaUrl`'s is:
 * a default cannot express "explicitly none", and the no-origin branch would
 * become unreachable from every caller the moment one was configured.
 */
export function internaliseLinks(
  html: string,
  origin: string | undefined = migration.liveOrigin,
  /**
   * Passed rather than read, for the reason the contract tests found the hard
   * way: three checks written against the kit's own `notMigratedPaths` value
   * failed the moment a project configured its own — which is the exact defect
   * this mission spent its length removing from four other gates. A test that
   * supplies its own list asserts the RULE; one that reads the config asserts
   * today's configuration.
   */
  notMigratedPaths: readonly string[] = migration.notMigratedPaths,
): string {
  if (origin === undefined || origin.trim() === "") return html;
  let sourceHost: string;
  try {
    sourceHost = hostKey(new URL(origin).host);
  } catch {
    return html;
  }

  return html.replace(
    ATTRIBUTE,
    (whole, attribute: string, quote: string, value: string) => {
      const trimmed = value.trim();
      if (trimmed === "") return whole;
      // Protocol-relative is the same site written a third way.
      const absolute = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
      if (!/^https?:\/\//i.test(absolute)) {
        // A ROOT-RELATIVE link into a namespace this migration does not
        // publish. The declaration has to work in both directions or it only
        // half works: a source body writes the same destination absolutely in
        // one paragraph and relatively in the next, and on ja.wordpress.org
        // 302 links to `/support/forum/alphabeta/` were absolute and 4 were
        // not. Protecting only the absolute ones leaves those 4 as 404s.
        //
        // Only a DECLARED prefix is externalised. Nothing else relative is
        // touched — `/favicon.ico` and `/robots.txt` are file-like and this
        // build really does serve them, so the file rule above must never
        // reach a relative path.
        return trimmed.startsWith("/") &&
          isNotMigrated(trimmed.split(/[?#]/)[0] ?? "", notMigratedPaths)
          ? `${attribute}=${quote}${new URL(trimmed, origin).href}${quote}`
          : whole;
      }

      let url: URL;
      try {
        url = new URL(absolute);
      } catch {
        return whole;
      }
      if (hostKey(url.host) !== sourceHost) return whole;
      if (keepAbsolute(url.pathname, notMigratedPaths)) return whole;

      // Path, query and fragment are kept exactly. A query on an internal link
      // is a real parameter — a filter, a UTM tag somebody wrote on purpose —
      // and dropping it changes where the link goes.
      return `${attribute}=${quote}${url.pathname}${url.search}${url.hash}${quote}`;
    },
  );
}
