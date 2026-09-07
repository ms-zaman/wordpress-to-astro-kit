// Plain-text helpers shared by every summary derivation.

/** Paragraph break: one or more blank lines, in either line ending. */
const PARAGRAPH_BREAK = /(?:\r?\n){2,}/;

/** The paragraphs of a plain-text body, in order. */
export function paragraphsOf(source: string | undefined | null): string[] {
  if (typeof source !== "string") return [];
  return source
    .split(PARAGRAPH_BREAK)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * Cut plain text at a word boundary, marking that it was cut. Trailing
 * punctuation is stripped before the ellipsis so a cut never reads `word.…`.
 */
export function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:]$/, "")}…`;
}
