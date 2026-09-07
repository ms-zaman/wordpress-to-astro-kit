// What a rendered page SAYS.
//
// ## The comparison this is built for
//
// Not "is the markup the same". Two engines mark the same role up differently
// and always will: a source site puts a plan price in an `<h2>` and your build
// puts it in a `<th>`; its eyebrow is a heading and yours is a paragraph. In
// the project this came from, three prototypes compared element-for-element
// and each one buried the real findings under forty differences nobody can see.
//
// The question worth asking is **"does our page say what the source page
// says"**, and it is deliberately asymmetric:
//
//   * `asked()` pulls the STRUCTURED strings out of a page — headings and the
//     things a reader can act on. That is what a missing band, tab or card
//     shows up as: an absent plan tab is exactly one missing label.
//   * `saidBy()` flattens a page to everything it says.
//
// A finding is a string one page ASKS that the other never SAYS. Run both
// ways, that catches content the source carries and you dropped, AND copy you
// invented that the source has no trace of.
//
// ## Three things are removed first, from both sides
//
//   1. **Anything hidden at every breakpoint, by ANCESTRY.** A page builder
//      emits full markup for a section it never paints, and the flags sit on
//      the section, not on the heading six levels down. WHICH classes mean
//      that is the builder's business and therefore configuration — see
//      `builders.ts`. WordPress is not one editor, and a reconciler that
//      hard-codes one builder's classes is silently wrong on every site built
//      with another.
//   2. **Anything the document carries but the page is not.** A popup ships
//      inside the document and is not part of what the page says.
//   3. **`aria-hidden="true"` subtrees.** This is better than a hand-kept list
//      of "icon noise": a footer's social links read `f Facebook` and `X X` to
//      a naive scan, because the glyph span is decorative and the accessible
//      name is what a reader actually gets. It also KEEPS what such a list
//      would wrongly silence — a screen-reader-only label is a real accessible
//      name, and differing from it is a finding worth ruling on rather than
//      hiding.
import { readFileSync } from "node:fs";

import { attributeOf, blankEmbedded, walkElements } from "../lib/html-walk.ts";
import type { SourceMarkup } from "./builders.ts";

/** Elements whose text a reader acts on. */
const LABEL_ELEMENTS = new Set(["a", "button", "label", "summary", "option"]);
const HEADING = /^h[1-6]$/;

/**
 * The comparison key for a string.
 *
 * Whitespace is collapsed and the string lowercased, because `$33.33/month`
 * and `$33.33 /month` are one price rendered by two engines. Entities and the
 * quote characters are unified for the same reason: WordPress serves `&#8217;`
 * where Astro serves `’`, and neither is a difference anybody can see.
 */
export function normalise(text: string): string {
  return (
    text
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/&amp;|&#38;/g, "&")
      .replace(/&#8217;|&rsquo;|&#39;|&apos;|’|‘/g, "'")
      .replace(/&#8220;|&#8221;|“|”/g, '"')
      .replace(/&#8211;|&ndash;|–/g, "-")
      .replace(/&#8212;|&mdash;|—/g, "-")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      // A price is `$33.33/month` in one engine and `$33.33 /month` in the
      // other, because one puts the figure and the period in sibling elements.
      // The slash is the join either way.
      .replace(/\s*\/\s*/g, "/")
      .trim()
      .toLowerCase()
  );
}

/** One string a page paints, with the element that paints it. */
export interface Asked {
  /** The normalised comparison key. */
  readonly key: string;
  /** The element carrying it, for a report a person has to read. */
  readonly kind: string;
}

/** A one-character label is a glyph; a 140-character one is prose. */
export const MIN_LENGTH = 3;
export const MAX_LENGTH = 140;

/**
 * How to read one side of the comparison.
 *
 * A union rather than a boolean and an optional table, because "drop what the
 * builder hides" is meaningless without saying WHICH builder. The type makes
 * the omission impossible: you cannot ask for hidden subtrees to be dropped
 * without handing over the rules that define hidden.
 *
 * `dropHidden: true` is the SOURCE side, whose markup carries those flags.
 * `false` is your own build, which does not emit a section it does not paint
 * — and where a class that happened to collide with a marker name would
 * silently delete real content.
 */
export type SurfaceOptions =
  | { readonly dropHidden: false }
  | { readonly dropHidden: true; readonly markup: SourceMarkup };

/**
 * The document with everything unpainted blanked to spaces.
 *
 * Blanked rather than cut so that every offset stays valid: the walk records
 * offsets and slices content out of the same string afterwards.
 */
export function painted(html: string, options: SurfaceOptions): string {
  const blanked = blankEmbedded(html);
  const cuts: [number, number][] = [];

  const rules: SourceMarkup = options.dropHidden
    ? options.markup
    : { hiddenEverywhere: [], notPartOfThePage: [] };

  const hiddenEverywhere = (classes: string): boolean =>
    rules.hiddenEverywhere.some((set) =>
      set.every((name) => classes.includes(name)),
    );

  const notPartOfThePage = (attributes: string): boolean =>
    rules.notPartOfThePage.some(
      ([name, expected]) => attributeOf(attributes, name) === expected,
    );

  walkElements(blanked, {
    onClose(element, unused, closeAt) {
      const remove =
        attributeOf(element.attributes, "aria-hidden") === "true" ||
        (options.dropHidden &&
          (hiddenEverywhere(element.classes) ||
            notPartOfThePage(element.attributes)));
      if (remove) cuts.push([element.contentStart, closeAt]);
    },
  });

  // Innermost-last is not guaranteed, so apply from the end: a later cut
  // cannot move an earlier one's offsets, and overlapping cuts blank the same
  // span twice rather than corrupting it.
  let out = blanked;
  for (const [from, to] of cuts.sort((left, right) => right[0] - left[0]))
    out = out.slice(0, from) + " ".repeat(to - from) + out.slice(to);
  return out;
}

/** The structured strings a page paints: its headings and its labels. */
export function asked(
  html: string,
  options: SurfaceOptions,
): Map<string, Asked> {
  const document = painted(html, options);
  const found = new Map<string, Asked>();

  walkElements(document, {
    onClose(element, unused, closeAt) {
      const isHeading = HEADING.test(element.name);
      if (!isHeading && !LABEL_ELEMENTS.has(element.name)) return;
      const key = normalise(document.slice(element.contentStart, closeAt));
      if (key.length < MIN_LENGTH || key.length > MAX_LENGTH) return;
      // First writer wins: a label nested in a heading is the inner, more
      // specific carrier, and it is met first because `onClose` fires inside
      // out.
      if (!found.has(key))
        found.set(key, { key, kind: isHeading ? "heading" : element.name });
    },
  });

  return found;
}

/**
 * Whether a corpus says a string, at a word boundary.
 *
 * Plain containment is not enough, and a test caught it: `$999.99/mo` sits
 * inside `$999.99/month`, so a struck-through price matched the live one and a
 * real difference reported itself as agreement. A match has to end where a
 * word ends.
 */
export function says(corpus: string, key: string): boolean {
  let at = corpus.indexOf(key);
  while (at >= 0) {
    const before = at === 0 ? "" : corpus[at - 1]!;
    const after = corpus[at + key.length] ?? "";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    at = corpus.indexOf(key, at + 1);
  }
  return false;
}

/** Everything a page says, flattened — the corpus an asked string is sought in. */
export function saidBy(html: string, options: SurfaceOptions): string {
  return normalise(painted(html, options));
}

export interface Surface {
  readonly asked: Map<string, Asked>;
  readonly said: string;
}

/** Both halves of one document, read once. */
export function surfaceOf(html: string, options: SurfaceOptions): Surface {
  return { asked: asked(html, options), said: saidBy(html, options) };
}

export function surfaceOfFile(file: string, options: SurfaceOptions): Surface {
  return surfaceOf(readFileSync(file, "utf8"), options);
}
