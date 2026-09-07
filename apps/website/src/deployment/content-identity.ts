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

/** The collections whose entries become pages, and whose rows become archives. */
export type ContentKind = "posts" | "pages" | "categories" | "tags" | "authors";

/** A stable name for one intended piece of content. */
export type ContentId = string;

/** `posts/hello-world@en` — an entry, which exists once per language. */
export function entryId(
  kind: "posts" | "pages",
  slug: string,
  locale: string,
): ContentId {
  return `${kind}/${slug}@${locale}`;
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
  if (slash < 0) return undefined;
  const kind = id.slice(0, slash);
  return kind === "posts" ||
    kind === "pages" ||
    kind === "categories" ||
    kind === "tags" ||
    kind === "authors"
    ? kind
    : undefined;
}

/** The locale an entry identity names, or undefined for a registry row. */
export function localeOf(id: ContentId): string | undefined {
  const at = id.lastIndexOf("@");
  return at < 0 ? undefined : id.slice(at + 1);
}
