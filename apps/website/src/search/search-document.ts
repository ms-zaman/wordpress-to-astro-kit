// Search documents and the static index. No provider: a normalized, plain-JSON
// projection of the content index, and a matcher over it with no dependency,
// no network call and no runtime. The index is DERIVED at build time, so it
// cannot describe content the site does not publish.
import type {
  ContentKind,
  IndexedEntry,
} from "../content-index/entry-model.ts";
import { indexedId } from "../content-index/entry-model.ts";

/** The query-string parameter the search form submits. */
export const SEARCH_QUERY_PARAM = "q";

export interface SearchDocument {
  readonly id: string;
  readonly kind: ContentKind;
  readonly title: string;
  readonly summary: string;
  readonly href: string;
  readonly locale: string;
  readonly date: string;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
}

export interface SearchIndex {
  readonly version: 1;
  readonly locale: string;
  readonly documents: readonly SearchDocument[];
}

export const SEARCH_INDEX_VERSION = 1;

export { normalizeText, terms } from "./search-core.js";

export function toSearchDocument(entry: IndexedEntry): SearchDocument {
  return {
    id: indexedId(entry),
    kind: entry.kind,
    title: entry.title,
    summary: entry.summary,
    href: entry.href,
    locale: entry.locale,
    date: entry.date,
    categories: [...entry.categories],
    tags: [...entry.tags],
  };
}

/** Build the static index for one locale, ordered by identity so the file is stable. */
export function buildSearchIndex(
  entries: readonly IndexedEntry[],
  options: { readonly locale: string },
): SearchIndex {
  const documents = entries
    .filter((entry) => entry.locale === options.locale)
    .map(toSearchDocument)
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    version: SEARCH_INDEX_VERSION,
    locale: options.locale,
    documents,
  };
}
