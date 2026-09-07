// The sitemap model. Every candidate row carries what it knows AND whether it
// is publishable, decided by `sitemapIncludes`: nothing while the build is a
// preview, every indexable non-paginated page in production.
import { routeKey } from "../routing/url-shape.ts";
import {
  isIndexablePath,
  isPaginationPath,
  siteEnvironment,
  sitemapIncludes,
  type SiteEnvironment,
} from "../deployment/site-environment.ts";
import { canonicalFor, type SeoOverrideRow } from "./seo-model.ts";
import { absoluteUrl } from "./site-identity.ts";

export const SITEMAP_PATH = "/sitemap.xml";

export type ExclusionReason =
  "preview-noindex" | "never-indexed" | "pagination";

/** A route as the sitemap sees it. */
export interface SitemapSource {
  /** Root-relative path, either shape. */
  readonly path: string;
  readonly lastModified?: string;
  readonly kind: string;
}

export interface SitemapCandidate {
  /** Root-relative route key. */
  readonly path: string;
  /** The canonical this path resolves to — itself unless a row overrides it. */
  readonly canonical: string;
  readonly locale: string;
  readonly lastModified?: string;
  readonly kind: string;
  readonly includable: boolean;
  readonly excludedBy?: ExclusionReason;
}

const disposition = (
  path: string,
  environment: SiteEnvironment,
): Pick<SitemapCandidate, "includable" | "excludedBy"> => {
  if (sitemapIncludes(path, environment)) return { includable: true };
  if (environment !== "production")
    return { includable: false, excludedBy: "preview-noindex" };
  if (!isIndexablePath(path))
    return { includable: false, excludedBy: "never-indexed" };
  if (isPaginationPath(path))
    return { includable: false, excludedBy: "pagination" };
  return { includable: false, excludedBy: "never-indexed" };
};

export function sitemapCandidates(
  sources: readonly SitemapSource[],
  options: {
    readonly locale: string;
    readonly overrides?: readonly { readonly data: SeoOverrideRow }[];
    readonly environment?: SiteEnvironment;
  },
): SitemapCandidate[] {
  const overrides = options.overrides ?? [];
  const environment = options.environment ?? siteEnvironment();
  return sources
    .map((source) => {
      const path = routeKey(source.path);
      return {
        path,
        canonical: canonicalFor(overrides, path, options.locale).canonical,
        locale: options.locale,
        lastModified: source.lastModified,
        kind: source.kind,
        ...disposition(path, environment),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function publishableCandidates(
  candidates: readonly SitemapCandidate[],
): SitemapCandidate[] {
  return candidates.filter((candidate) => candidate.includable);
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The `<loc>` for a path: absolute, in the site's one URL shape. */
export function sitemapLocation(
  path: string,
  origin: string | undefined,
): string | undefined {
  const withSlash = path === "/" ? "/" : `${path.replace(/\/+$/, "")}/`;
  return absoluteUrl(withSlash, origin);
}

/** The XML document. An origin is required: a sitemap URL is absolute. */
export function serializeSitemap(
  rows: readonly SitemapCandidate[],
  origin: string | undefined,
): string {
  const entries = rows
    .map((row) => {
      const location = sitemapLocation(row.canonical, origin);
      if (location === undefined) return undefined;
      const lastmod =
        row.lastModified === undefined
          ? ""
          : `<lastmod>${escapeXml(row.lastModified)}</lastmod>`;
      return `  <url><loc>${escapeXml(location)}</loc>${lastmod}</url>`;
    })
    .filter((line): line is string => line !== undefined);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.join("\n") +
    (entries.length > 0 ? "\n" : "") +
    "</urlset>\n"
  );
}
