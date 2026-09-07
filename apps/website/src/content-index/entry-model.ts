// Unified content-entry model. A search document, a related-content match, a
// breadcrumb trail and a sitemap row are all projections of one flat shape,
// DERIVED from entries that already validate against their own schema. It is
// deliberately not a new schema: no content file changes, and no field asks
// a collection for something it does not carry.

/** The collections a reader can discover. */
export type ContentKind = "post" | "page";

export interface KindBinding {
  readonly kind: ContentKind;
  /** Plural display name: the listing surface, the breadcrumb label. */
  readonly label: string;
  /** Singular display name: one result, one card. */
  readonly singular: string;
  /** Which date field the adapter reads, so a card can label it honestly. */
  readonly dateField: "publishedAt" | "updatedAt";
}

export const CONTENT_KINDS: readonly KindBinding[] = [
  { kind: "post", label: "Posts", singular: "Post", dateField: "publishedAt" },
  { kind: "page", label: "Pages", singular: "Page", dateField: "updatedAt" },
] as const;

const BY_KIND = new Map(
  CONTENT_KINDS.map((binding) => [binding.kind, binding]),
);

export function kindBinding(kind: ContentKind): KindBinding {
  const binding = BY_KIND.get(kind);
  if (!binding)
    throw new Error(
      `Content index: "${kind}" is not a discoverable content kind.`,
    );
  return binding;
}

export interface IndexedEntry {
  readonly kind: ContentKind;
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  /** The URL the entry is published at, from the route table. */
  readonly href: string;
  /** Plain text, derived at render time. */
  readonly summary: string;
  readonly date: string;
  readonly dateField: KindBinding["dateField"];
  readonly categories: readonly string[];
  readonly tags: readonly string[];
}

/** Stable identity: `<kind>/<locale>/<slug>`. */
export function indexedId(entry: IndexedEntry): string {
  return `${entry.kind}/${entry.locale}/${entry.slug}`;
}
