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
 * Fold text into the form the matcher compares: lowercase, LATIN diacritics
 * stripped. Identical on both sides.
 *
 * The Latin restriction is the whole point, and it replaces a rule that read
 * `.normalize("NFD").replace(/\p{Diacritic}/gu, "")` — every script at once.
 * Measured, that rule did this:
 *
 *     café  -> cafe    the intended folding
 *     だいじ -> たいし   だ is た + U+3099, and U+3099 is a Diacritic
 *     バグ   -> ハク     so "バグ" (bug) and "ハク" became one word
 *
 * Dakuten and handakuten are not accents on a Japanese letter; they make a
 * different letter. Folding them merges words that mean different things, and
 * the search box quietly returns the wrong article rather than none.
 *
 * So a mark is dropped only when the character it sits on is Latin. Greek and
 * Cyrillic are deliberately left alone too: й is not и, and choosing that it
 * is would be a claim about Russian this kit has no business making.
 * @param {string} value
 * @returns {string}
 */
export function normalizeText(value) {
  return value
    .normalize("NFD")
    .replace(
      /(\p{Script=Latin})(\p{Mn}+)/gu,
      (_whole, base, marks) => base + marks.replace(/\p{Diacritic}/gu, ""),
    )
    .normalize("NFC")
    .toLowerCase();
}

/**
 * The segmenter, built once. `undefined` takes the host's locale, which is
 * what a static index built on one machine and queried on another wants: the
 * segmentation of CJK and Thai is dictionary-based rather than locale-based.
 * @type {Intl.Segmenter | null}
 */
const SEGMENTER =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

/**
 * Split text into the words the matcher indexes.
 *
 * This used to be `split(" ")` after punctuation became spaces, which assumes
 * a script that puts spaces between words. Two things went wrong on a site
 * that does not:
 *
 *   - Japanese has no spaces, so a whole title was ONE token. The matcher
 *     compares with `startsWith`, so "リリース" did not match the title
 *     "WordPress 7.1リリース候補版4" — the only queries that worked were the
 *     ones that happened to start a line.
 *   - `[^\p{Letter}\p{Number}]` treats a combining mark as punctuation, so
 *     every abugida was shredded at its vowel signs: দাম (price) became the
 *     two tokens দ and ম, and neither is a word.
 *
 * `Intl.Segmenter` knows where the words are in all of them. The fallback path
 * is the old split with marks kept as letters, for a runtime without it.
 * @param {string} value
 * @returns {string[]}
 */
export function terms(value) {
  const normalized = normalizeText(value);
  if (SEGMENTER === null) {
    const spaced = normalized
      .replace(/[^\p{Letter}\p{Number}\p{Mark}]+/gu, " ")
      .trim();
    return spaced === "" ? [] : spaced.split(" ");
  }
  const out = [];
  for (const piece of SEGMENTER.segment(normalized))
    if (piece.isWordLike === true) out.push(piece.segment);
  return out;
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
