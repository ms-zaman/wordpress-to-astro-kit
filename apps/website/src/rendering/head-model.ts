/**
 * The document head, computed. Every social and structured-data tag this site
 * emits is decided here, as a pure function of what a route knows plus
 * whether an origin exists. The layout renders the result and decides
 * nothing of its own, which is what lets the SEO audit and the render
 * contract check the same rules the pages follow.
 *
 * The one rule that shapes all of this: **a tag that needs an absolute URL is
 * not emitted until there is an origin to build one with.**
 *
 * | Always                                                     | Only with an origin                          |
 * | ---------------------------------------------------------- | -------------------------------------------- |
 * | `og:title`, `og:description`, `og:type`, `og:site_name`, `og:locale` | `og:url`                           |
 * | `twitter:card`, `twitter:title`, `twitter:description`     | `og:image` when the value is relative        |
 * | `BlogPosting` structured data (no URL fields)              | `canonical`, `WebSite`, `BreadcrumbList`     |
 */
import { mediaOrigin, mediaUrl } from "./media.ts";
import { SITE_NAME, absoluteUrl, siteOrigin } from "./site-identity.ts";

/** Meta-description bounds, in characters — where engines truncate or ignore. */
export const META_DESCRIPTION_MAX = 160;
export const META_DESCRIPTION_MIN = 50;

/** Title bound, in characters. */
export const TITLE_MAX = 60;

export interface HeadInput {
  readonly title: string;
  readonly description?: string;
  /** A canonical from an override row, as authored (absolute or relative). */
  readonly canonical?: string;
  readonly ogImage?: { readonly url: string; readonly alt?: string };
  readonly ogType?: "website" | "article";
  readonly articleTimes?: {
    readonly published: string;
    readonly modified?: string;
  };
  readonly locale: string;
  /** Root-relative path of this page, for `og:url`. */
  readonly pathname: string;
  /**
   * The origin to build absolute URLs against. Read with an `in` check, never
   * with `??`: an input that carries `origin: undefined` means "there is no
   * origin", and `??` cannot tell that from an input that omits the key.
   */
  readonly origin?: string | undefined;
}

export interface MetaTag {
  readonly attribute: "name" | "property";
  readonly key: string;
  readonly content: string;
}

/** `og:locale` wants `xx_XX`, not the BCP-47 `xx-XX`. */
export function ogLocale(locale: string): string {
  const [language, region] = locale.split("-");
  return region ? `${language}_${region.toUpperCase()}` : language;
}

function originOf(input: HeadInput): string | undefined {
  return "origin" in input ? input.origin : siteOrigin();
}

/** Every social tag for one page, in a stable order. */
export function socialTags(input: HeadInput): MetaTag[] {
  const origin = originOf(input);
  const tags: MetaTag[] = [
    { attribute: "property", key: "og:title", content: input.title },
    {
      attribute: "property",
      key: "og:type",
      content: input.ogType ?? "website",
    },
    { attribute: "property", key: "og:site_name", content: SITE_NAME },
    {
      attribute: "property",
      key: "og:locale",
      content: ogLocale(input.locale),
    },
  ];

  if (input.description)
    tags.push({
      attribute: "property",
      key: "og:description",
      content: input.description,
    });

  const url = absoluteUrl(input.pathname, origin);
  if (url !== undefined)
    tags.push({ attribute: "property", key: "og:url", content: url });

  const image =
    input.ogImage === undefined
      ? undefined
      : absoluteUrl(mediaUrl(input.ogImage.url, mediaOrigin()), origin);
  if (image !== undefined) {
    tags.push({ attribute: "property", key: "og:image", content: image });
    if (input.ogImage?.alt)
      tags.push({
        attribute: "property",
        key: "og:image:alt",
        content: input.ogImage.alt,
      });
  }

  if (input.ogType === "article" && input.articleTimes !== undefined) {
    tags.push({
      attribute: "property",
      key: "article:published_time",
      content: input.articleTimes.published,
    });
    if (input.articleTimes.modified !== undefined)
      tags.push({
        attribute: "property",
        key: "article:modified_time",
        content: input.articleTimes.modified,
      });
  }

  tags.push({
    attribute: "name",
    key: "twitter:card",
    content: image === undefined ? "summary" : "summary_large_image",
  });
  tags.push({ attribute: "name", key: "twitter:title", content: input.title });
  if (input.description)
    tags.push({
      attribute: "name",
      key: "twitter:description",
      content: input.description,
    });

  return tags;
}

/**
 * The canonical URL to emit, or `undefined` to emit none. No origin means no
 * canonical, even when an override row carries an absolute one: a canonical is
 * an instruction to index a different URL instead of this one, and emitting
 * one this project cannot verify is that instruction pointed somewhere.
 */
export function canonicalUrl(input: HeadInput): string | undefined {
  const origin = originOf(input);
  if (origin === undefined) return undefined;
  if (input.canonical !== undefined)
    return absoluteUrl(input.canonical, origin);
  return absoluteUrl(input.pathname, origin);
}

/** True when a row asked for a canonical and the missing origin overrules it. */
export function canonicalDeferred(input: HeadInput): boolean {
  return input.canonical !== undefined && originOf(input) === undefined;
}

export interface ArticleInput {
  readonly headline: string;
  readonly description?: string;
  readonly datePublished: string;
  readonly dateModified?: string;
  readonly authorName?: string;
  readonly locale: string;
  readonly path?: string;
  readonly image?: string;
  readonly origin?: string;
}

export interface SiteIdentityInput {
  readonly name: string;
  readonly origin: string | undefined;
  /** Root-relative path to the logo the header renders, or undefined. */
  readonly logoPath?: string;
  readonly sameAs: readonly string[];
  readonly searchPath: string;
  readonly searchParam: string;
}

/** `BlogPosting` structured data for a post. URL fields wait for an origin. */
export function blogPostingJsonLd(
  input: ArticleInput,
): Record<string, unknown> {
  const json: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.headline,
    datePublished: input.datePublished,
    inLanguage: input.locale,
  };
  if (input.description) json.description = input.description;
  if (input.dateModified) json.dateModified = input.dateModified;
  if (input.authorName)
    json.author = { "@type": "Person", name: input.authorName };
  const url = absoluteUrl(input.path ?? "", input.origin);
  if (input.path !== undefined && url !== undefined) {
    json.mainEntityOfPage = { "@type": "WebPage", "@id": url };
    json.url = url;
  }
  const image = absoluteUrl(input.image ?? "", input.origin);
  if (input.image !== undefined && image !== undefined) json.image = image;
  return json;
}

/** The site's own identity, as one `@graph`. Undefined without an origin. */
export function siteIdentityJsonLd(
  input: SiteIdentityInput,
): Record<string, unknown> | undefined {
  const origin = input.origin;
  if (origin === undefined) return undefined;
  const organization: Record<string, unknown> = {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: input.name,
    url: `${origin}/`,
  };
  const logo =
    input.logoPath === undefined
      ? undefined
      : absoluteUrl(input.logoPath, origin);
  if (logo !== undefined) organization.logo = logo;
  if (input.sameAs.length > 0) organization.sameAs = [...input.sameAs];
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: input.name,
        url: `${origin}/`,
        publisher: { "@id": `${origin}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${origin}${input.searchPath}?${input.searchParam}={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

export interface BreadcrumbInput {
  readonly label: string;
  /** Absent for the current page, which is still a position in the trail. */
  readonly href?: string;
}

/**
 * `BreadcrumbList` for a trail the page already renders — emitted from the
 * SAME crumbs the `<nav>` shows, never a second list. Needs an origin and an
 * href on every crumb but the last, or produces nothing.
 */
export function breadcrumbListJsonLd(
  crumbs: readonly BreadcrumbInput[],
  origin: string | undefined,
): Record<string, unknown> | undefined {
  if (origin === undefined || crumbs.length < 2) return undefined;
  const items = crumbs.map((crumb, index) => {
    const entry: Record<string, unknown> = {
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
    };
    const url =
      crumb.href === undefined ? undefined : absoluteUrl(crumb.href, origin);
    if (url !== undefined) entry.item = url;
    return entry;
  });
  const missing = items.slice(0, -1).some((entry) => entry.item === undefined);
  return missing
    ? undefined
    : {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items,
      };
}
