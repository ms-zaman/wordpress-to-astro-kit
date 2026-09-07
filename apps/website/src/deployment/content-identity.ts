// The name a piece of content keeps all the way to `dist/`.
//
// ## Why an identity and not a count
//
// The manifest already recorded, per collection, how many entries exist and
// how many were routed. Two numbers cannot answer the question that matters —
// **which** entry did not arrive — and a build that drops one entry and gains
// another reports the same pair of numbers as a build that dropped nothing.
//
// So every intended thing gets a stable string, and the same string is carried
// on the route it produces. The integrity gate then joins two sets of names
// rather than comparing two integers, and can say `posts/hello-world@en` is
// missing instead of `280 != 279`.
//
// ## The shape
//
//     posts/<slug>@<locale>       one entry, in one language
//     pages/<slug>@<locale>
//     categories/<slug>           a registry row: its name is per-locale, the
//     tags/<slug>                 row itself is not
//     authors/<slug>
//
// `@<locale>` is on entries and not on registry rows because that is where the
// distinction is real: two translations of a page are two entries, whereas one
// category row carries a name for every locale.

/**
 * The collection an identity belongs to.
 *
 * A string rather than a union of the five core names, because a custom post
 * type's collection comes from `migration.config.ts` and the set is therefore
 * open by design. `CORE_KINDS` names the ones the kit itself ships, for a
 * report that wants to group them.
 */
export type ContentKind = string;

export const CORE_KINDS = [
  "posts",
  "pages",
  "categories",
  "tags",
  "authors",
] as const;

/** A stable name for one intended piece of content. */
export type ContentId = string;

/**
 * `posts/hello-world@en` — an entry, which exists once per language.
 *
 * `collection`, not "post type": two WordPress installs have used one type key
 * for different things, and the collection is what the content tree and this
 * identity both use. A custom type's profile carries both names.
 *
 * The locale is part of the identity and the slug is not enough on its own —
 * that is the lesson of the loader collision this kit already hit once, where
 * two translations sharing a slug meant one was silently never loaded.
 */
export function entryId(
  collection: string,
  slug: string,
  locale: string,
): ContentId {
  return `${collection}/${slug}@${locale}`;
}

/** `categories/news` — a registry row, which carries every language itself. */
export function rowId(
  kind: "categories" | "tags" | "authors",
  slug: string,
): ContentId {
  return `${kind}/${slug}`;
}

/** The collection an identity belongs to, for grouping a report. */
export function kindOf(id: ContentId): ContentKind | undefined {
  const slash = id.indexOf("/");
  if (slash <= 0) return undefined;
  return id.slice(0, slash);
}

/**
 * The locale an entry identity names, or undefined for a registry row.
 *
 * The `@` has to come after the last `/`, and that is not pedantry: a
 * structural identity is spelled `@archive/products`, whose `@` is at index 0.
 * Reading that as a locale made the posts-listing identity look like an entry
 * in a language called `archive/products`, and the locale exclusion rule then
 * withheld a listing the build had published — caught by this gate reporting
 * an exclusion that excused nothing.
 */
export function localeOf(id: ContentId): string | undefined {
  const at = id.lastIndexOf("@");
  if (at <= 0) return undefined;
  return at > id.lastIndexOf("/") ? id.slice(at + 1) : undefined;
}

/** True for a route the site's structure produces rather than one entry. */
export function isStructuralId(id: ContentId): boolean {
  return id.startsWith("@");
}
