// A tag-stack walk over captured HTML.
//
// Written to answer questions about an element's ANCESTRY that a flat regex
// cannot: is this `<img>` inside something the page hides at every breakpoint,
// is this heading inside the article body or inside the chrome. Two earlier
// attempts at the first of those were silently wrong, which is why the walk
// lives in one place rather than being written again per caller.
//
// **This is not a parser.** It maintains an element stack over a regular
// expression scan, which is enough to answer "what is this element's ancestry"
// and nothing more. It does not build a tree, resolve implied end tags, or
// understand `<template>`.
//
// ## Why `blankEmbedded` comes first, always
//
// A stylesheet is full of `>` and a script is full of `<`. Either one
// desynchronises the scan within a few kilobytes, and the failure is silent —
// the stack simply reports the wrong ancestry from then on. Blanking to spaces
// rather than deleting keeps every offset in the document valid, so an offset
// found in the original still points at the same place here.

/** Elements that never have a closing tag. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * `<script>` and `<style>` bodies, blanked to spaces of the same length.
 *
 * Call this before any tag scan. See the module note above for why.
 */
export function blankEmbedded(html: string): string {
  return html.replace(
    /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
    (_match, open: string, _name, body: string, close: string) =>
      open + " ".repeat(body.length) + close,
  );
}

/**
 * The tag pattern, as a factory.
 *
 * A fresh regex per walk: a `/g` literal shared between callers carries
 * `lastIndex`, and a walk that starts mid-document is a bug nobody would look
 * for.
 */
const tagPattern = (): RegExp =>
  /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/** One element met during the walk. */
export interface Element {
  readonly name: string;
  readonly attributes: string;
  /** The `class` attribute's value, or `""`. Read once, since every caller wants it. */
  readonly classes: string;
  /** Offset just past this element's opening `>`, for slicing its content. */
  readonly contentStart: number;
}

export interface WalkHandlers {
  /** A void or self-closing element. `stack` is its ancestry, innermost last. */
  readonly onVoid?: (element: Element, stack: readonly Element[]) => void;
  /** An element opening. `stack` is its ancestry and does NOT include it. */
  readonly onOpen?: (element: Element, stack: readonly Element[]) => void;
  /**
   * An element closing. `closeAt` is the offset of its `</`, so
   * `html.slice(element.contentStart, closeAt)` is exactly its content.
   */
  readonly onClose?: (
    element: Element,
    stack: readonly Element[],
    closeAt: number,
  ) => void;
}

/**
 * One named attribute of a tag's attribute string.
 *
 * Both quote styles, because a test fixture written by hand uses single quotes
 * and a double-quote-only reader passes every assertion about it while doing
 * nothing — which is how three of this module's own tests first went green
 * against a reader that could not see them.
 */
export function attributeOf(
  attributes: string,
  name: string,
): string | undefined {
  const match = new RegExp(`\\b${name}=("([^"]*)"|'([^']*)')`).exec(attributes);
  return match ? (match[2] ?? match[3]) : undefined;
}

/** The `class` attribute of a tag's attribute string. */
export function classesOf(attributes: string): string {
  return attributeOf(attributes, "class") ?? "";
}

/**
 * Walk `html`, maintaining an element stack.
 *
 * The caller is responsible for having run `blankEmbedded` first — this does
 * not do it, because a caller that needs offsets into the ORIGINAL text has to
 * blank it itself and keep both strings.
 */
export function walkElements(html: string, handlers: WalkHandlers): void {
  const stack: Element[] = [];
  for (const match of html.matchAll(tagPattern())) {
    const [, closing, rawName, attributes = ""] = match;
    const name = rawName!.toLowerCase();

    if (closing) {
      // Unwind to the nearest matching open tag. Real-world markup closes tags
      // it never opened; popping blindly is how a stack drifts.
      const at = stack.findLastIndex((entry) => entry.name === name);
      if (at < 0) continue;
      const element = stack[at]!;
      stack.length = at;
      handlers.onClose?.(element, stack, match.index);
      continue;
    }

    const element: Element = {
      name,
      attributes,
      classes: classesOf(attributes),
      contentStart: match.index + match[0].length,
    };

    if (VOID_ELEMENTS.has(name) || attributes.trimEnd().endsWith("/")) {
      handlers.onVoid?.(element, stack);
      continue;
    }

    handlers.onOpen?.(element, stack);
    stack.push(element);
  }
}
