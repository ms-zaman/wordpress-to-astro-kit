// Heading structure validation.
//
// Three properties, each of which breaks something concrete when violated:
//
//   - ONE H1, FIRST. The title is the document's identity. Two of them means
//     two documents in one file, which is the "one topic per file" rule
//     (AGENTS.md §8) failing quietly.
//   - NO SKIPPED LEVELS. An H2 followed by an H4 produces an outline with a
//     hole in it: every generated table of contents mis-nests, and a reader
//     scanning structure sees a subsection that belongs to nothing.
//   - NO EMPTY HEADINGS. A heading with no text produces an empty anchor, which
//     no link can address.
//
// Duplicate headings are NOT reported. They are common and legitimate
// (`### Rules` under several sections), and the anchor rule disambiguates them
// with a numeric suffix, which the link checker already resolves.

import type { Document } from "./markdown.ts";
import type { Finding } from "./finding.ts";

export function validateHeadings(document: Document): readonly Finding[] {
  const findings: Finding[] = [];

  // Severity splits on MECHANICAL breakage. A document with no title or an
  // unaddressable heading is broken: nothing can link to it. An outline that
  // skips a level, or uses `#` where `##` was meant, still renders and still
  // resolves — it deviates from AGENTS.md §8 and is worth reporting, but it is
  // not the same class of defect, and grading it as one would bury the defects
  // that are. `--strict` promotes every warning for anyone who disagrees.
  const at = (
    line: number,
    rule: string,
    detail: string,
    severity: Finding["severity"] = "error",
  ): void => {
    findings.push({ path: document.path, line, rule, severity, detail });
  };

  if (document.headings.length === 0) {
    at(0, "heading-none", "the document has no headings.");
    return findings;
  }

  const titles = document.headings.filter((heading) => heading.level === 1);

  if (titles.length === 0) {
    at(
      document.headings[0].line,
      "heading-no-h1",
      "no level-1 title. A document opens with `# <Title>` (AGENTS.md §8).",
    );
  }

  for (const extra of titles.slice(1)) {
    at(
      extra.line,
      "heading-multiple-h1",
      `a second level-1 heading ("${extra.text}") — one topic per file (AGENTS.md §8); use \`##\` for a section.`,
      "warning",
    );
  }

  if (titles.length > 0 && document.headings[0].level !== 1) {
    at(
      document.headings[0].line,
      "heading-h1-not-first",
      `the document opens at level ${document.headings[0].level} ("${document.headings[0].text}"); the title must come first.`,
    );
  }

  let previous = document.headings[0].level;
  for (const heading of document.headings.slice(1)) {
    if (heading.level > previous + 1) {
      at(
        heading.line,
        "heading-level-skip",
        `level ${previous} is followed by level ${heading.level} ("${heading.text}") — the outline skips level ${previous + 1}.`,
        "warning",
      );
    }
    previous = heading.level;
  }

  for (const heading of document.headings) {
    if (heading.text === "") {
      at(heading.line, "heading-empty", "a heading with no text.");
    } else if (heading.anchor === "") {
      at(
        heading.line,
        "heading-unaddressable",
        `"${heading.text}" produces an empty anchor, so no link can address it.`,
      );
    }
  }

  return findings;
}
