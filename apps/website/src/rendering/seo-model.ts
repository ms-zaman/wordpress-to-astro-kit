// SEO override integration: the consumer of the per-URL override table.
//
// The join key is `path` + `locale`, exactly as the table defines it. No
// prefix matching, no fallback to another locale. `robots` on a row is READ
// and reported (`robotsConflict`), never applied: indexing is the launch
// switch's decision.

export interface SeoOverrideRow {
  readonly path: string;
  readonly locale: string;
  readonly metaTitle?: string;
  readonly metaDescription?: string;
  readonly canonical?: string;
  readonly ogImage?: { readonly url: string; readonly alt?: string };
  readonly robots?: { readonly noindex?: boolean; readonly nofollow?: boolean };
  readonly disposition?: { readonly state: string; readonly note?: string };
}

export interface SeoOverrideEntry {
  readonly data: SeoOverrideRow;
}

/** Normalize a path for the join: `/blog/` and `/blog` are one row. */
export function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "" || trimmed === "/") return "/";
  return trimmed.endsWith("/") ? trimmed.replace(/\/+$/, "") : trimmed;
}

/** The override row for a path in a locale, or undefined — the normal case. */
export function findOverride(
  entries: readonly SeoOverrideEntry[],
  path: string,
  locale: string,
): SeoOverrideRow | undefined {
  const wanted = normalizePath(path);
  return entries.find(
    (entry) =>
      normalizePath(entry.data.path) === wanted && entry.data.locale === locale,
  )?.data;
}

export interface CanonicalTarget {
  readonly canonical: string;
  readonly fromOverride: boolean;
  readonly absolute: boolean;
}

/** What a path canonicalizes to: itself, unless an override row says otherwise. */
export function canonicalFor(
  entries: readonly SeoOverrideEntry[],
  path: string,
  locale: string,
): CanonicalTarget {
  const override = findOverride(entries, path, locale)?.canonical;
  const canonical = override ?? normalizePath(path);
  return {
    canonical,
    fromOverride: override !== undefined,
    absolute: /^https?:\/\//.test(canonical),
  };
}

/** What a route derives from its own content, before any override applies. */
export interface RouteMetadata {
  readonly title: string;
  readonly description?: string;
  readonly ogImage?: { readonly url: string; readonly alt?: string };
}

export interface SeoMetadata {
  readonly title: string;
  readonly description?: string;
  readonly canonical?: string;
  readonly ogImage?: { readonly url: string; readonly alt?: string };
  readonly titleFromOverride: boolean;
  readonly descriptionFromOverride: boolean;
  readonly disposition?: string;
  /** True when the row asks to be indexable and the launch switch overrules it. */
  readonly robotsConflict: boolean;
}

/** Combine a route's derived metadata with its override row. Override wins. */
export function seoMetadata(
  route: RouteMetadata,
  override?: SeoOverrideRow,
): SeoMetadata {
  return {
    title: override?.metaTitle ?? route.title,
    description: override?.metaDescription ?? route.description,
    canonical: override?.canonical,
    ogImage: override?.ogImage ?? route.ogImage,
    titleFromOverride: override?.metaTitle !== undefined,
    descriptionFromOverride: override?.metaDescription !== undefined,
    disposition: override?.disposition?.state,
    robotsConflict: override?.robots?.noindex === false,
  };
}
