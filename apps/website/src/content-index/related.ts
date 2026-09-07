// Related content: a JOIN over facets the content already carries, so a reader
// can see why two entries are related and an editor can change it by editing
// content. No recommendation model, no similarity score over text.
//
//   post → shared categories, then shared tags.
//   page → none: a page is a destination a reader navigates to deliberately.
import type { ContentKind, IndexedEntry } from "./entry-model.ts";
import { indexedId } from "./entry-model.ts";

export const CATEGORY_WEIGHT = 2;
export const TAG_WEIGHT = 1;
export const DEFAULT_RELATED_LIMIT = 3;

export interface RelatedMatch {
  readonly entry: IndexedEntry;
  readonly score: number;
  readonly sharedCategories: readonly string[];
  readonly sharedTags: readonly string[];
}

const FACETS: Record<ContentKind, ReadonlyArray<"categories" | "tags">> = {
  post: ["categories", "tags"],
  page: [],
};

export function hasRelatedRule(kind: ContentKind): boolean {
  return FACETS[kind].length > 0;
}

const shared = (
  left: readonly string[],
  right: readonly string[],
): string[] => {
  const other = new Set(right);
  return left.filter((value) => other.has(value));
};

/** Entries related to `entry`, strongest first. Same kind, same locale, not itself. */
export function relatedContent(
  entry: IndexedEntry,
  pool: readonly IndexedEntry[],
  options: { readonly limit?: number } = {},
): RelatedMatch[] {
  const facets = FACETS[entry.kind];
  if (facets.length === 0) return [];

  const self = indexedId(entry);
  const matches: RelatedMatch[] = [];

  for (const candidate of pool) {
    if (candidate.kind !== entry.kind) continue;
    if (candidate.locale !== entry.locale) continue;
    if (indexedId(candidate) === self) continue;

    const sharedCategories = facets.includes("categories")
      ? shared(entry.categories, candidate.categories)
      : [];
    const sharedTags = facets.includes("tags")
      ? shared(entry.tags, candidate.tags)
      : [];

    const score =
      sharedCategories.length * CATEGORY_WEIGHT +
      sharedTags.length * TAG_WEIGHT;
    if (score === 0) continue;

    matches.push({ entry: candidate, score, sharedCategories, sharedTags });
  }

  return matches
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.entry.date.localeCompare(left.entry.date) ||
        indexedId(left.entry).localeCompare(indexedId(right.entry)),
    )
    .slice(0, options.limit ?? DEFAULT_RELATED_LIMIT);
}
