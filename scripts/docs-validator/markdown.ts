// Minimal, line-oriented Markdown reading.
//
// Enough structure to answer three questions (metadata, headings, links) and
// deliberately not a Markdown parser. A parser would be a dependency; the
// repository's documentation conventions (AGENTS.md §8) are line-shaped, so a
// line-shaped reader is the right size for them.
//
// The one piece of real parsing here is FENCE TRACKING. A fenced code block
// containing `# Title` or `[a](b)` is a code sample, not a heading or a link,
// and reporting it would make the validator worse than useless — it would train
// readers to ignore output. Inline code spans are stripped for the same reason.

export interface DocumentLine {
  /** 1-indexed, so a finding points at what an editor shows. */
  readonly number: number;
  readonly text: string;
  /** Inside a fenced code block — content, not structure. */
  readonly fenced: boolean;
}

export interface Heading {
  readonly level: number;
  readonly text: string;
  readonly line: number;
  /** The GitHub-style anchor this heading answers to. */
  readonly anchor: string;
}

export interface Document {
  /** Repository-relative path — the identity a finding is reported against. */
  readonly path: string;
  readonly lines: readonly DocumentLine[];
  readonly headings: readonly Heading[];
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const ATX_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Split into lines with fence state resolved. Handles ``` and ~~~ fences. */
export function readLines(source: string): readonly DocumentLine[] {
  const lines: DocumentLine[] = [];
  let fenceMarker: string | null = null;

  source.split(/\r?\n/).forEach((text, index) => {
    const match = FENCE.exec(text);
    const opening = match?.[1] ?? null;

    if (fenceMarker === null) {
      // The fence line itself is structure, not content: it never carries a
      // heading or a link, and marking it fenced or not changes nothing.
      lines.push({ number: index + 1, text, fenced: false });
      if (opening !== null) fenceMarker = opening[0];
      return;
    }

    // A fence closes only on the same marker character (CommonMark).
    if (opening !== null && opening[0] === fenceMarker) {
      fenceMarker = null;
      lines.push({ number: index + 1, text, fenced: false });
      return;
    }

    lines.push({ number: index + 1, text, fenced: true });
  });

  return lines;
}

/** Remove inline code spans — `like this` — before scanning for links. */
export const stripCodeSpans = (text: string): string =>
  text.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));

/**
 * GitHub's heading anchor rule: strip formatting, lowercase, drop anything that
 * is not a letter, digit, space, hyphen, or underscore, then hyphenate spaces.
 * Repeats are disambiguated with `-1`, `-2`, … in document order.
 */
export function anchorOf(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_~]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

export function readHeadings(
  lines: readonly DocumentLine[],
): readonly Heading[] {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();

  for (const line of lines) {
    if (line.fenced) continue;
    const match = ATX_HEADING.exec(line.text);
    if (match === null) continue;

    const base = anchorOf(match[2]);
    const repeat = seen.get(base) ?? 0;
    seen.set(base, repeat + 1);

    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      line: line.number,
      anchor: repeat === 0 ? base : `${base}-${repeat}`,
    });
  }

  return headings;
}

export function readDocument(path: string, source: string): Document {
  const lines = readLines(source);
  return { path, lines, headings: readHeadings(lines) };
}
