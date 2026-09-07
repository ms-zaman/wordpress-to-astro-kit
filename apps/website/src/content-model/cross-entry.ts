// Cross-entry validation. Zod validates one entry at a time; these rules span
// entries. Pure functions with no I/O, so the content validator and the
// contract tests run the same code.
import { defaultLocale } from "./shared.ts";

export interface ValidationIssue {
  code:
    | "cluster-missing-source"
    | "cluster-slug-mismatch"
    | "cluster-duplicate-locale"
    | "post-author-unknown"
    | "post-category-unknown"
    | "post-tag-unregistered"
    | "page-parent-unknown"
    | "page-parent-cycle";
  message: string;
}

export interface ClusterEntry {
  collection: string;
  slug: string;
  locale: string;
  cluster: string;
}

/** An entry as the taxonomy rules see one. */
export interface TaxonomyEntry {
  collection: string;
  slug: string;
  author?: string;
  categories?: string[];
  tags?: string[];
}

/** The registry slugs an entry's references are resolved against. */
export interface TaxonomyRegistries {
  readonly authors: readonly string[];
  readonly categories: readonly string[];
  readonly tags: readonly string[];
}

/** A page as the hierarchy rule sees one. */
export interface PageEntry {
  slug: string;
  locale: string;
  parent?: string;
}

/**
 * Translation-cluster integrity:
 *  - every cluster contains a source-locale (default locale) entry;
 *  - a locale appears at most once per cluster;
 *  - variant slugs equal the source slug (untranslated-slug preservation).
 *
 * Partial clusters are VALID by design — default-locale-only is the normal
 * state, and variants accrete as translations are migrated.
 */
export function validateClusters(
  entries: readonly ClusterEntry[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const clusters = new Map<string, ClusterEntry[]>();

  for (const entry of entries) {
    const members = clusters.get(entry.cluster) ?? [];
    members.push(entry);
    clusters.set(entry.cluster, members);
  }

  for (const [cluster, members] of clusters) {
    const seenLocales = new Set<string>();
    for (const member of members) {
      if (seenLocales.has(member.locale)) {
        issues.push({
          code: "cluster-duplicate-locale",
          message: `Cluster "${cluster}" has more than one entry for locale "${member.locale}".`,
        });
      }
      seenLocales.add(member.locale);
    }

    const source = members.find((member) => member.locale === defaultLocale);
    if (!source) {
      issues.push({
        code: "cluster-missing-source",
        message:
          `Cluster "${cluster}" has no source-locale ("${defaultLocale}") entry — ` +
          `variants are orphaned.`,
      });
      continue;
    }

    for (const member of members) {
      if (member.slug !== source.slug) {
        issues.push({
          code: "cluster-slug-mismatch",
          message:
            `Cluster "${cluster}": ${member.locale} entry uses slug "${member.slug}" but the ` +
            `source slug is "${source.slug}". Slugs are untranslated and shared across a cluster.`,
        });
      }
    }
  }

  return issues;
}

/**
 * Reference integrity between posts and the registries. The schema enforces
 * the SHAPE of `author` and `categories`; this enforces the REFERENT — a post
 * naming an author who does not exist links its byline to a page no route
 * generates, which is invisible until a reader clicks.
 *
 * An unregistered tag is reported under its own code: the post still renders
 * it, but it has no display name. Seed the registry; never edit the post.
 */
export function validateTaxonomyReferences(
  entries: readonly TaxonomyEntry[],
  registries: TaxonomyRegistries,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const authors = new Set(registries.authors);
  const categories = new Set(registries.categories);
  const tags = new Set(registries.tags);

  for (const entry of entries) {
    if (entry.collection !== "posts") continue;

    if (entry.author !== undefined && !authors.has(entry.author)) {
      issues.push({
        code: "post-author-unknown",
        message:
          `Post "${entry.slug}" is by "${entry.author}", who is not in the author ` +
          `registry (content/authors.json). The byline would link to a page no route generates.`,
      });
    }

    for (const category of entry.categories ?? []) {
      if (!categories.has(category)) {
        issues.push({
          code: "post-category-unknown",
          message:
            `Post "${entry.slug}" claims category "${category}", which is not in the ` +
            `category registry (content/categories.json).`,
        });
      }
    }

    for (const tag of entry.tags ?? []) {
      if (!tags.has(tag)) {
        issues.push({
          code: "post-tag-unregistered",
          message:
            `Post "${entry.slug}" carries tag "${tag}", which has no row in the tag ` +
            `registry (content/tags.json), so it has no display name. Seed the registry ` +
            `rather than editing the post.`,
        });
      }
    }
  }

  return issues;
}

/**
 * Page hierarchy: every `parent` names a page in the same locale, and no
 * chain of parents loops. A page under an unknown parent has no path.
 */
export function validatePageParents(
  pages: readonly PageEntry[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byKey = new Map(
    pages.map((page) => [`${page.locale}/${page.slug}`, page]),
  );

  for (const page of pages) {
    if (page.parent === undefined) continue;
    const seen = new Set<string>([page.slug]);
    let current: PageEntry | undefined = page;
    while (current?.parent !== undefined) {
      const parent = byKey.get(`${current.locale}/${current.parent}`);
      if (!parent) {
        issues.push({
          code: "page-parent-unknown",
          message:
            `Page "${page.slug}" (${page.locale}) names parent "${current.parent}", ` +
            `which is not a page in that locale. It has no path.`,
        });
        break;
      }
      if (seen.has(parent.slug)) {
        issues.push({
          code: "page-parent-cycle",
          message: `Page "${page.slug}" (${page.locale}) has a parent chain that loops through "${parent.slug}".`,
        });
        break;
      }
      seen.add(parent.slug);
      current = parent;
    }
  }

  return issues;
}
