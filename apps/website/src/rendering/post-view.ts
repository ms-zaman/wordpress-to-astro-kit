// Post view model: the publishing decisions a listing needs that the content
// model deliberately does not carry. Each is DERIVED in a pure function, so a
// value cannot drift from the content it describes and no field is added to a
// schema that every migrated post would then have to carry.
import { truncateAtWord } from "./portable-body.ts";
import type {
  AuthorRow,
  EntryLike,
  PostEntryData,
} from "../routing/resolver.ts";

/** Reading pace, in words per minute — a convention, stated once. */
const WORDS_PER_MINUTE = 200;

export interface ReadingTime {
  readonly words: number;
  /** Whole minutes, never zero for a non-empty body. */
  readonly minutes: number;
}

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#8217;": "’",
  "&#8216;": "‘",
  "&#8220;": "“",
  "&#8221;": "”",
  "&nbsp;": " ",
  "&#160;": " ",
};

/**
 * Tags that separate words. A BLOCK tag becomes a space because the text
 * either side of it is two runs of prose; an INLINE tag becomes nothing,
 * because `<em>one</em>.` is one word and a full stop, and turning every tag
 * into a space renders it "one ." — a space before punctuation, in every
 * summary and every meta description derived from a migrated body.
 */
const BLOCK_TAG =
  /^<\/?(?:p|div|h[1-6]|li|ul|ol|dl|dt|dd|tr|td|th|table|thead|tbody|tfoot|br|hr|section|article|aside|header|footer|main|nav|blockquote|pre|figure|figcaption|form|fieldset|address|details|summary)\b/i;

/** The visible text of an HTML fragment: tags stripped, entities decoded. */
export function textOf(html: string | undefined | null): string {
  if (typeof html !== "string") return "";
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, (tag) => (BLOCK_TAG.test(tag) ? " " : ""))
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The word segmenter, built once.
 *
 * `split(/\s+/)` counts the spaces in a text, which is a word count only in a
 * script that has spaces between words. Measured on a 4,000-character Japanese
 * article: one "word", so `Math.max(1, …)` printed "1 min read" — on every
 * article on the site, whatever its length. The same rule shows a Thai or
 * Chinese article as a minute long too.
 *
 * `Intl.Segmenter` finds word boundaries in all of them, and leaves an English
 * count where it was.
 */
const WORD_SEGMENTER =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

/** How many words a text holds, in any script. */
export function wordCount(prose: string): number {
  if (prose === "") return 0;
  if (WORD_SEGMENTER === null) return prose.split(/\s+/).length;
  let words = 0;
  for (const piece of WORD_SEGMENTER.segment(prose))
    if (piece.isWordLike === true) words += 1;
  return words;
}

/** Reading time for a body, code blocks excluded. */
export function readingTime(body: string | undefined | null): ReadingTime {
  if (typeof body !== "string") return { words: 0, minutes: 0 };
  const prose = textOf(
    body
      .replace(/<pre\b[\s\S]*?<\/pre>/gi, " ")
      .replace(/```[\s\S]*?```/g, " "),
  );
  const words = wordCount(prose);
  return {
    words,
    minutes:
      words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
  };
}

/**
 * Block constructs that are not a body's opening prose, for a Markdown body.
 */
const NON_PROSE_LINE =
  /^\s*(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\||:{3}|---\s*$|<(?:h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|figure|figcaption|pre|iframe|img|div|section|hr|br)\b)/i;

/**
 * The first paragraph of prose in a body, as plain text. An HTML body yields
 * its first `<p>`; a Markdown body its first line that is not a heading, a
 * list or a block construct.
 */
export function firstProseParagraph(body: string | undefined | null): string {
  if (typeof body !== "string") return "";
  const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(body);
  if (paragraph) return textOf(paragraph[1]);
  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === "" || NON_PROSE_LINE.test(line)) continue;
    return line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

/**
 * What a listing shows for a post: the authored excerpt when there is one,
 * the opening prose otherwise. Derived at RENDER time — nothing is written
 * into the content set.
 */
export function postSummary(
  data: { readonly excerpt?: string },
  body: string | undefined | null,
  maxLength: number,
): string {
  const source = data.excerpt
    ? textOf(data.excerpt)
    : firstProseParagraph(body);
  return truncateAtWord(source, maxLength);
}

export function postsByAuthor<Post extends EntryLike<PostEntryData>>(
  posts: readonly Post[],
  slug: string,
): Post[] {
  return posts.filter((post) => post.data.author === slug);
}

export function postsByCategory<Post extends EntryLike<PostEntryData>>(
  posts: readonly Post[],
  slug: string,
): Post[] {
  return posts.filter((post) => post.data.categories.includes(slug));
}

export function postsByTag<Post extends EntryLike<PostEntryData>>(
  posts: readonly Post[],
  slug: string,
): Post[] {
  return posts.filter((post) => (post.data.tags ?? []).includes(slug));
}

export function latestPosts<Post>(
  posts: readonly Post[],
  count: number,
): Post[] {
  return posts.slice(0, count);
}

/** A date for display, in the reader's locale. UTC: a date has no zone. */
export function formatDate(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** Authors by slug, for a listing's bylines. */
export type AuthorIndex = ReadonlyMap<string, AuthorRow>;

export function authorIndex(rows: readonly AuthorRow[]): AuthorIndex {
  return new Map(rows.map((row) => [row.slug, row]));
}
