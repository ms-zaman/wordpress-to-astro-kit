// @ts-check
// The search matcher — one implementation, two runtimes.
//
// This file is plain JavaScript on purpose. It is the matcher `search-query.ts`
// exports to the build (typed through JSDoc and the wrapper there) AND, byte
// for byte, the code `/search` ships to the browser as an inline island: the
// page imports this file as raw text, strips the `export` keywords, and inlines
// it beside `search-island.js`. So the rendering contract, the build-time
// index and a reader's browser all run the same four rules:
//
//   1. A query is a set of TERMS. Terms are ANDed.
//   2. A term matches a field when any of the field's terms STARTS WITH it.
//   3. Fields are weighted — title above taxonomy above summary — and a term
//      scores its best field once.
//   4. Ordering is total: score, then newest, then identity.
//
// No fuzzy matching, no stemming, no stop-word list: each needs language data
// per locale.

/** @typedef {"title" | "categories" | "tags" | "summary"} MatchField */

/**
 * @typedef {object} SearchDocument
 * @property {string} id
 * @property {string} kind
 * @property {string} title
 * @property {string} summary
 * @property {string} href
 * @property {string} locale
 * @property {string} date
 * @property {readonly string[]} categories
 * @property {readonly string[]} tags
 */

/** @type {Readonly<Record<MatchField, number>>} */
export const FIELD_WEIGHTS = { title: 4, categories: 3, tags: 2, summary: 1 };

/** @type {readonly MatchField[]} */
const FIELDS = ["title", "categories", "tags", "summary"];

/**
 * Fold text into the form the matcher compares: lowercase, diacritics
 * stripped, punctuation reduced to spaces. Identical on both sides.
 * @param {string} value
 * @returns {string}
 */
export function normalizeText(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/**
 * @param {string} value
 * @returns {string[]}
 */
export function terms(value) {
  const normalized = normalizeText(value);
  return normalized === "" ? [] : normalized.split(" ");
}

/**
 * @param {SearchDocument} document
 * @param {MatchField} field
 * @returns {string[]}
 */
function fieldTerms(document, field) {
  switch (field) {
    case "title":
      return terms(document.title);
    case "categories":
      return document.categories.flatMap(terms);
    case "tags":
      return document.tags.flatMap(terms);
    default:
      return terms(document.summary);
  }
}

/**
 * @param {SearchDocument} document
 * @param {readonly string[]} queryTerms
 * @returns {{ score: number, matchedFields: MatchField[] } | null}
 */
function scoreDocument(document, queryTerms) {
  /** @type {Map<MatchField, string[]>} */
  const indexed = new Map(
    FIELDS.map((field) => [field, fieldTerms(document, field)]),
  );
  let score = 0;
  /** @type {Set<MatchField>} */
  const matched = new Set();
  for (const term of queryTerms) {
    /** @type {MatchField | undefined} */
    let best;
    for (const field of FIELDS) {
      const values = indexed.get(field) ?? [];
      if (values.some((value) => value.startsWith(term))) {
        best = field;
        break;
      }
    }
    if (!best) return null;
    score += FIELD_WEIGHTS[best];
    matched.add(best);
  }
  return { score, matchedFields: FIELDS.filter((field) => matched.has(field)) };
}

/**
 * Search the index. An empty or punctuation-only query returns NO results.
 * @param {{ locale: string, documents: readonly SearchDocument[] }} index
 * @param {string} query
 * @param {{ limit?: number, locale?: string, kind?: string }} [options]
 * @returns {{ document: SearchDocument, score: number, matchedFields: MatchField[] }[]}
 */
export function search(index, query, options = {}) {
  if (options.locale !== undefined && options.locale !== index.locale)
    return [];
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return [];
  /** @type {{ document: SearchDocument, score: number, matchedFields: MatchField[] }[]} */
  const results = [];
  for (const document of index.documents) {
    if (
      options.kind !== undefined &&
      options.kind !== "all" &&
      document.kind !== options.kind
    )
      continue;
    const scored = scoreDocument(document, queryTerms);
    if (scored === null) continue;
    results.push({ document, ...scored });
  }
  results.sort(
    (left, right) =>
      right.score - left.score ||
      right.document.date.localeCompare(left.document.date) ||
      left.document.id.localeCompare(right.document.id),
  );
  return options.limit === undefined
    ? results
    : results.slice(0, options.limit);
}

/**
 * Which empty state a surface should render.
 * @param {{ documents: readonly SearchDocument[] }} index
 * @param {string} query
 * @param {readonly unknown[]} results
 * @returns {"no-query" | "empty-index" | "no-match" | undefined}
 */
export function emptyReason(index, query, results) {
  if (index.documents.length === 0) return "empty-index";
  if (terms(query).length === 0) return "no-query";
  return results.length === 0 ? "no-match" : undefined;
}
