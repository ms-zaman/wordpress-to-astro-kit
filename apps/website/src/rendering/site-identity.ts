// Who this site is, and where it lives — read from `content/config/site.json`.
//
// The origin is the seam: `<link rel="canonical">`, `og:url`, a relative
// `og:image` and every `sitemap.xml` row must be absolute, and all of them
// read `siteOrigin()` from here. While it is null none of them is emitted —
// not as a placeholder, not pointing at example.com, not relative. A wrong
// `og:url` is worse than an absent one: absent, a crawler falls back to the
// page it fetched; wrong, it follows the lie.
//
// The origin is not the cutover. A preview build carries `noindex` on every
// page whatever the origin says; see `deployment/site-environment.ts`.
import siteData from "../../../../content/config/site.json" with { type: "json" };

export interface SiteSocialLink {
  readonly label: string;
  readonly href: string;
}

export interface SiteConfig {
  readonly name: string;
  readonly tagline: string | null;
  /** The production origin, scheme and host, no trailing slash — or null. */
  readonly origin: string | null;
  /** A root-relative path under `apps/website/public/`, or null for a wordmark. */
  readonly logo: string | null;
  readonly social: readonly SiteSocialLink[];
}

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i;

function readSiteConfig(raw: unknown): SiteConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (typeof value.name !== "string" || value.name.trim() === "")
    throw new Error(
      "content/config/site.json: `name` must be a non-empty string.",
    );
  const origin = value.origin ?? null;
  if (origin !== null && (typeof origin !== "string" || !ORIGIN.test(origin)))
    throw new Error(
      `content/config/site.json: \`origin\` must be null or a scheme and host like https://example.com, got ${JSON.stringify(origin)}.`,
    );
  const logo = value.logo ?? null;
  if (logo !== null && (typeof logo !== "string" || !logo.startsWith("/")))
    throw new Error(
      "content/config/site.json: `logo` must be null or a root-relative path under apps/website/public/.",
    );
  const social = Array.isArray(value.social) ? value.social : [];
  for (const [index, link] of social.entries()) {
    const row = link as Record<string, unknown>;
    if (typeof row.label !== "string" || typeof row.href !== "string")
      throw new Error(
        `content/config/site.json: social[${index}] needs a label and an href.`,
      );
  }
  return {
    name: value.name.trim(),
    tagline: typeof value.tagline === "string" ? value.tagline : null,
    origin: origin === null ? null : origin.replace(/\/+$/, ""),
    logo,
    social: social as SiteSocialLink[],
  };
}

export const site: SiteConfig = readSiteConfig(siteData);

/** The site's name, for `og:site_name`, the wordmark and structured data. */
export const SITE_NAME: string = site.name;

/**
 * The production origin, scheme and host, no trailing slash — or `undefined`
 * while none has been decided. A function so every caller reads it at the
 * same point in its own lifecycle.
 */
export function siteOrigin(): string | undefined {
  return site.origin ?? undefined;
}

/**
 * An absolute URL for a root-relative path, or `undefined` with no origin. A
 * value that is already absolute is returned unchanged.
 *
 * `origin` is REQUIRED rather than defaulted: a default parameter cannot
 * express "explicitly no origin" — passing `undefined` selects the default —
 * so the no-origin branch would become unreachable the day an origin landed.
 */
export function absoluteUrl(
  pathOrUrl: string,
  origin: string | undefined,
): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl) || pathOrUrl.startsWith("//"))
    return pathOrUrl;
  if (origin === undefined) return undefined;
  return `${origin.replace(/\/$/, "")}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}
