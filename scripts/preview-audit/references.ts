// Extracting what a page points at.
//
// A regex reader over emitted HTML, not a parser, and the limits of that are
// worth stating because the audit's credibility rests on them:
//
//   - It reads `href` and `src` attributes, plus `srcset` candidates. An
//     attribute assembled by JavaScript is invisible to it — which is sound
//     here and only here, because the build audit asserts that no page ships
//     any script at all. `checkScripts` re-asserts it, so this reader's
//     assumption fails loudly rather than silently.
//   - It does not resolve `<base href>`. No layout emits one, and a page that
//     did would change what every relative URL means, so `collectReferences`
//     reports the tag as a reference of its own rather than quietly ignoring it.
//   - It cannot tell a comment from markup. A commented-out `<img src>` would be
//     checked as if it were live. That is the conservative direction: it can
//     produce a finding about a link nobody follows, never miss a broken one.
//
// Nothing here touches the filesystem. The checks decide what exists; this
// module only says what was asked for.

/** How a reference must be resolved. */
export type ReferenceScope =
  /** Root-relative, same origin — `/blog/hello-world`, `/assets/x.svg`. */
  | "internal"
  /** Relative to the page — `../x`, `x.html`. */
  | "relative"
  /** Another origin, or a non-HTTP scheme. Recorded, never followed. */
  | "external"
  /** `#section` — an in-page anchor. */
  | "fragment";

export interface Reference {
  /** The dist-relative HTML file the reference was found in. */
  readonly from: string;
  /** The attribute value, verbatim. */
  readonly raw: string;
  /** `raw` with any `#fragment` and `?query` removed. */
  readonly target: string;
  readonly scope: ReferenceScope;
  /** The attribute it came from. */
  readonly attribute: "href" | "src" | "srcset";
  /** True when the tag is one that must resolve to a file, not a page. */
  readonly isAsset: boolean;
}

// Tag + attribute pairs, read separately so the tag is known. `[^>]*?` keeps a
// match inside one tag.
const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
const ATTRIBUTE =
  /\b(href|src|srcset)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>=`]+))/gi;

/**
 * Tags whose `href`/`src` names a FILE the host must serve, rather than a page
 * a visitor navigates to. The distinction is what lets "missing asset" and
 * "broken internal link" be different findings with different fixes.
 */
const ASSET_TAGS = new Set([
  "img",
  "script",
  "source",
  "video",
  "audio",
  "track",
  "embed",
]);

/** `<link>` is an asset only for the rels that fetch one. */
const ASSET_LINK_RELS = new Set([
  "stylesheet",
  "icon",
  "shortcut icon",
  "apple-touch-icon",
  "preload",
  "prefetch",
  "manifest",
  "mask-icon",
]);

const relOf = (attributes: string): string => {
  const match = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>=`]+))/i.exec(
    attributes,
  );
  return (match?.[2] ?? match?.[3] ?? match?.[4] ?? "").trim().toLowerCase();
};

const scopeOf = (raw: string): ReferenceScope => {
  if (raw.startsWith("#")) return "fragment";
  if (raw.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw))
    return "external";
  if (raw.startsWith("/")) return "internal";
  return "relative";
};

/** Strip the query and fragment: only the path can be checked against a file. */
const pathOf = (raw: string): string => raw.split("#")[0].split("?")[0];

/** Every candidate URL in a `srcset`, without its descriptor. */
const srcsetCandidates = (value: string): string[] =>
  value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter((candidate) => candidate !== "");

/**
 * Every reference one HTML document makes.
 *
 * Empty attribute values are skipped: `href=""` resolves to the current
 * document, which is a markup smell rather than a broken link, and reporting it
 * as a missing file would be wrong.
 */
export function collectReferences(from: string, html: string): Reference[] {
  const references: Reference[] = [];

  for (const tagMatch of html.matchAll(TAG)) {
    const tag = tagMatch[1].toLowerCase();
    const attributes = tagMatch[2] ?? "";

    const isAsset =
      ASSET_TAGS.has(tag) ||
      (tag === "link" && ASSET_LINK_RELS.has(relOf(attributes)));

    for (const attributeMatch of attributes.matchAll(ATTRIBUTE)) {
      const attribute =
        attributeMatch[1].toLowerCase() as Reference["attribute"];
      const value = (
        attributeMatch[3] ??
        attributeMatch[4] ??
        attributeMatch[5] ??
        ""
      ).trim();
      if (value === "") continue;

      const raws = attribute === "srcset" ? srcsetCandidates(value) : [value];
      for (const raw of raws) {
        references.push({
          from,
          raw,
          target: pathOf(raw),
          scope: scopeOf(raw),
          attribute,
          isAsset: isAsset || attribute === "srcset",
        });
      }
    }
  }

  return references;
}

/** True when the document declares a `<base href>`. See the header. */
export function declaresBase(html: string): boolean {
  return /<base\b[^>]*\bhref\s*=/i.test(html);
}
