// Markdown link validation.
//
// The rule this enforces is AGENTS.md's documentation contract, one layer down: "one source of
// truth per topic … if a document is superseded, mark it and link forward."
// A cross-reference that no longer resolves is a source of truth that has
// silently stopped pointing anywhere, and this repository's documents are dense
// with cross-references — they are the structure, not decoration.
//
// The filesystem is reached through a RESOLVER rather than imported directly,
// so the rules are testable without a fixture tree on disk and the CLI owns the
// only place that touches `node:fs`.
//
// External links are counted, never fetched. Fetching would make the validator
// non-deterministic, network-dependent, and slow, and would send this
// repository's link graph to third parties for nothing.

import { stripCodeSpans, type Document } from "./markdown.ts";
import type { Finding } from "./finding.ts";

export interface LinkResolver {
  /** Does this repository-relative path exist? */
  exists(path: string): boolean;
  /** Anchors in a Markdown target, or `null` when it is not readable Markdown. */
  anchors(path: string): readonly string[] | null;
  /** Resolve `target` relative to the directory holding `from`. */
  resolve(from: string, target: string): string;
}

interface RawLink {
  readonly line: number;
  readonly label: string;
  readonly target: string;
}

const INLINE_LINK =
  /!?\[([^\]]*)\]\(\s*(<[^>]*>|[^()\s]*)(?:\s+"[^"]*")?\s*\)/g;
const REFERENCE_USE = /!?\[([^\]]*)\]\[([^\]]*)\]/g;
const REFERENCE_DEFINITION = /^\s{0,3}\[([^\]]+)\]:\s*(\S+)/;

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const MAILTO = /^mailto:/i;

const unwrap = (target: string): string =>
  target.startsWith("<") && target.endsWith(">") ? target.slice(1, -1) : target;

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape is reported as a link defect below, not thrown here.
    return value;
  }
};

export interface LinkScan {
  readonly links: readonly RawLink[];
  readonly definitions: ReadonlyMap<string, RawLink>;
  readonly externalCount: number;
}

/** Extract every link, skipping fenced blocks and inline code spans. */
export function scanLinks(document: Document): LinkScan {
  const links: RawLink[] = [];
  const definitions = new Map<string, RawLink>();
  let externalCount = 0;

  for (const line of document.lines) {
    if (line.fenced) continue;
    const text = stripCodeSpans(line.text);

    const definition = REFERENCE_DEFINITION.exec(text);
    if (definition !== null) {
      definitions.set(definition[1].trim().toLowerCase(), {
        line: line.number,
        label: definition[1].trim(),
        target: unwrap(definition[2]),
      });
      continue;
    }

    for (const match of text.matchAll(INLINE_LINK)) {
      const target = unwrap(match[2]);
      if (EXTERNAL.test(target) || MAILTO.test(target)) {
        externalCount += 1;
        continue;
      }
      links.push({ line: line.number, label: match[1], target });
    }

    for (const match of text.matchAll(REFERENCE_USE)) {
      // Collapsed form `[label][]` reuses the text as the label. The shortcut
      // form `[label]` is NOT treated as a link: these documents use bare
      // brackets for identifiers (`[B2]`, `[D1]`) constantly, and reading those
      // as links would bury every real finding under false ones.
      const label = (match[2].trim() === "" ? match[1] : match[2]).trim();
      links.push({ line: line.number, label: match[1], target: `][${label}` });
    }
  }

  return { links, definitions, externalCount };
}

export function validateLinks(
  document: Document,
  resolver: LinkResolver,
): readonly Finding[] {
  const findings: Finding[] = [];
  const scan = scanLinks(document);
  const ownAnchors = new Set(
    document.headings.map((heading) => heading.anchor),
  );

  const add = (
    line: number,
    rule: string,
    severity: Finding["severity"],
    detail: string,
  ): void => {
    findings.push({ path: document.path, line, rule, severity, detail });
  };

  const checkTarget = (link: RawLink, target: string): void => {
    if (target.trim() === "") {
      add(
        link.line,
        "link-empty",
        "error",
        `[${link.label}] has an empty target.`,
      );
      return;
    }

    const hash = target.indexOf("#");
    const pathPart = hash === -1 ? target : target.slice(0, hash);
    const anchor = hash === -1 ? "" : decode(target.slice(hash + 1));

    // A same-document anchor.
    if (pathPart === "") {
      if (anchor !== "" && !ownAnchors.has(anchor)) {
        add(
          link.line,
          "link-anchor-missing",
          "warning",
          `#${anchor} does not match any heading in this document.`,
        );
      }
      return;
    }

    if (pathPart.startsWith("/")) {
      add(
        link.line,
        "link-absolute-path",
        "warning",
        `"${pathPart}" is an absolute path; it resolves against the server root rather than the repository and breaks wherever the document is rendered outside it. Use a relative path.`,
      );
      return;
    }

    const resolved = resolver.resolve(document.path, decode(pathPart));
    if (resolved === "") {
      add(
        link.line,
        "link-escapes-repository",
        "error",
        `"${pathPart}" resolves outside the repository.`,
      );
      return;
    }

    if (!resolver.exists(resolved)) {
      add(
        link.line,
        "link-target-missing",
        "error",
        `"${pathPart}" does not exist (resolved to \`${resolved}\`).`,
      );
      return;
    }

    if (anchor === "") return;

    const anchors = resolver.anchors(resolved);
    if (anchors === null) return; // Not Markdown — the anchor is not ours to judge.
    if (!anchors.includes(anchor)) {
      add(
        link.line,
        "link-anchor-missing",
        "warning",
        `\`${resolved}\` has no heading matching #${anchor}.`,
      );
    }
  };

  for (const link of scan.links) {
    if (link.target.startsWith("][")) {
      const label = link.target.slice(2).toLowerCase();
      const definition = scan.definitions.get(label);
      if (definition === undefined) {
        add(
          link.line,
          "link-reference-undefined",
          "error",
          `reference [${label}] is used but never defined.`,
        );
        continue;
      }
      checkTarget(link, definition.target);
      continue;
    }
    checkTarget(link, link.target);
  }

  for (const [label, definition] of scan.definitions) {
    if (EXTERNAL.test(definition.target) || MAILTO.test(definition.target)) {
      continue;
    }
    checkTarget({ ...definition, label }, definition.target);
  }

  return findings;
}

export const countExternalLinks = (document: Document): number =>
  scanLinks(document).externalCount;
