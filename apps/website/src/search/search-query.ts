// The typed face of the matcher. The rules and the code live in
// `search-core.js`, because that file is also what the browser runs.
import * as core from "./search-core.js";
import type { SearchDocument, SearchIndex } from "./search-document.ts";

export type MatchField = "title" | "categories" | "tags" | "summary";

export const FIELD_WEIGHTS: Readonly<Record<MatchField, number>> =
  core.FIELD_WEIGHTS;

export interface SearchResult {
  readonly document: SearchDocument;
  readonly score: number;
  readonly matchedFields: readonly MatchField[];
}

export interface SearchOptions {
  readonly limit?: number;
  readonly locale?: string;
  readonly kind?: string;
}

export function search(
  index: SearchIndex,
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  return core.search(index, query, options) as SearchResult[];
}

export type EmptyReason = "no-query" | "empty-index" | "no-match";

export function emptyReason(
  index: SearchIndex,
  query: string,
  results: readonly SearchResult[],
): EmptyReason | undefined {
  return core.emptyReason(index, query, results);
}
