// Locale filtering, sorting and kind selection over `IndexedEntry[]`. Nothing
// here mutates its input.
import type { ContentKind, IndexedEntry } from "./entry-model.ts";

export function inLocale(
  entries: readonly IndexedEntry[],
  locale: string,
): IndexedEntry[] {
  return entries.filter((entry) => entry.locale === locale);
}

export function ofKind(
  entries: readonly IndexedEntry[],
  kind: ContentKind,
): IndexedEntry[] {
  return entries.filter((entry) => entry.kind === kind);
}

export type SortOrder = "newest" | "oldest" | "title" | "slug";

const tiebreak = (left: IndexedEntry, right: IndexedEntry): number =>
  left.kind.localeCompare(right.kind) || left.slug.localeCompare(right.slug);

export function sortEntries(
  entries: readonly IndexedEntry[],
  order: SortOrder = "newest",
): IndexedEntry[] {
  const sorted = [...entries];
  if (order === "slug") return sorted.sort(tiebreak);
  if (order === "title")
    return sorted.sort(
      (left, right) =>
        left.title.localeCompare(right.title) || tiebreak(left, right),
    );
  const direction = order === "newest" ? -1 : 1;
  return sorted.sort(
    (left, right) =>
      direction * left.date.localeCompare(right.date) || tiebreak(left, right),
  );
}

/** One locale, one order, optionally one kind. */
export function discoverable(
  entries: readonly IndexedEntry[],
  options: {
    readonly locale: string;
    readonly kind?: ContentKind;
    readonly order?: SortOrder;
  },
): IndexedEntry[] {
  const scoped = options.kind
    ? ofKind(inLocale(entries, options.locale), options.kind)
    : inLocale(entries, options.locale);
  return sortEntries(scoped, options.order ?? "newest");
}

export function countByKind(
  entries: readonly IndexedEntry[],
): Record<ContentKind, number> {
  const counts: Record<ContentKind, number> = { post: 0, page: 0 };
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}
