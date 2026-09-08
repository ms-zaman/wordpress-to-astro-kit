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

/** Source-CMS namespaces a static build does not serve. */
const CMS_PATHS = ["/wp-content/", "/wp-includes/"];

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
      if (!/^https?:\/\//i.test(absolute)) return whole;

      let url: URL;
      try {
        url = new URL(absolute);
      } catch {
        return whole;
      }
      if (hostKey(url.host) !== sourceHost) return whole;
      if (CMS_PATHS.some((prefix) => url.pathname.startsWith(prefix)))
        return whole;

      // Path, query and fragment are kept exactly. A query on an internal link
      // is a real parameter — a filter, a UTM tag somebody wrote on purpose —
      // and dropping it changes where the link goes.
      return `${attribute}=${quote}${url.pathname}${url.search}${url.hash}${quote}`;
    },
  );
}
