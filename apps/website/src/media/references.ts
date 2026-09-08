// Every place a migrated document can name a file, read and rewritten once.
//
// ## What is covered, and why exactly this list
//
// Measured from the markup WordPress and its editors actually emit — not from
// a list of HTML attributes that could hold a URL:
//
//   `src`                 every image, script, video, audio, iframe
//   `srcset`              the responsive set, one candidate per comma
//   `href`                a LINK to a file: the "download the PDF" case, and
//                         the `<a>` wrapping an image that Gutenberg's "link
//                         to media file" produces
//   `poster`              a video's still
//   `data-src`
//   `data-srcset`         the lazy-loading attributes every WordPress lazy
//                         plugin has used, and which core used itself before
//                         native `loading` landed in 5.5
//   `url(...)`            inside a `style` attribute or a `<style>` block —
//                         Elementor and every page builder put background
//                         images there and nowhere else
//   `![](…)` and `[](…)`  Markdown, for a pipeline that emits it
//
// ## What is deliberately NOT covered
//
// `sizes` holds lengths, not URLs. `content:` in CSS can hold a `url()` and is
// matched by the same rule, which is correct. `<meta property="og:image">` is
// a `content` attribute and is handled by the head model, which builds its own
// absolute URL — rewriting it here would do it twice.
//
// ## The rule that keeps this safe
//
// A reference is rewritten only when `identifyAsset` classifies it as migrated.
// Everything else is returned byte-identical, including its query and its
// fragment. "Contains /wp-content/uploads/" is NOT the test — somebody else's
// WordPress site is also somebody else's WordPress site.
import type { MediaProfile } from "../../../../migration.config.ts";
import {
  identifyAsset,
  isMigrated,
  type AssetIdentity,
} from "./asset-identity.ts";

/**
 * ASCII whitespace, and deliberately not `\s`.
 *
 * A URL inside an HTML attribute is delimited by the quote, and a `srcset`
 * candidate by an ASCII space — never by U+00A0 or U+202F, which are ordinary
 * characters in a file name a person typed on a Mac.
 */
const ASCII_SPACE = /[ \t\r\n\f\v]+/;

const ATTRIBUTE =
  /\b(src|srcset|href|poster|data-src|data-srcset|data-lazy-src|data-lazy-srcset)=("|')([^"']*)\2/gi;
const CSS_URL = /url\(\s*(["']?)([^)"']*)\1\s*\)/gi;
const MARKDOWN = /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g;

/** Where in a document a reference was found. */
export type ReferenceKind =
  "src" | "srcset" | "href" | "poster" | "lazy" | "css" | "markdown";

export interface AssetReference {
  /** The URL exactly as the document writes it. */
  readonly url: string;
  readonly kind: ReferenceKind;
}

const kindOf = (attribute: string): ReferenceKind => {
  const name = attribute.toLowerCase();
  if (name.startsWith("data-")) return "lazy";
  if (name === "srcset") return "srcset";
  if (name === "href") return "href";
  if (name === "poster") return "poster";
  return "src";
};

/** Every candidate URL in one `srcset` value, in order. */
const srcsetCandidates = (value: string): string[] =>
  value
    .split(",")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== "")
    .map((candidate) => candidate.split(ASCII_SPACE)[0] ?? "");

/**
 * Every asset a document references, in document order, with duplicates.
 *
 * Duplicates are KEPT: "this file is referenced fifteen times" and "these are
 * fifteen files" are different facts, and the caller de-duplicates on the
 * normalized key rather than on the raw string — two spellings of one file are
 * one asset, which a set of raw URLs would call two.
 */
export function findReferences(document: string): AssetReference[] {
  const found: AssetReference[] = [];

  for (const match of document.matchAll(ATTRIBUTE)) {
    const attribute = match[1] ?? "";
    const value = match[3] ?? "";
    if (value === "") continue;
    const kind = kindOf(attribute);
    if (kind === "srcset" || /srcset$/i.test(attribute))
      for (const candidate of srcsetCandidates(value))
        found.push({ url: candidate, kind: "srcset" });
    else found.push({ url: value, kind });
  }

  for (const match of document.matchAll(CSS_URL)) {
    const value = match[2] ?? "";
    if (value !== "") found.push({ url: value, kind: "css" });
  }

  for (const match of document.matchAll(MARKDOWN)) {
    const value = match[2] ?? "";
    if (value !== "") found.push({ url: value, kind: "markdown" });
  }

  return found;
}

/**
 * Every reference in a document that is really an ASSET, classified.
 *
 * The one place the `href` rule lives. WordPress's "link to media file"
 * produces an `<a href>` naming a real file, and an ordinary internal link to
 * another page produces the identical attribute — so an `href` counts as media
 * only when the engine owns what it names. Without that rule every link on the
 * site is reported as unsupported media, which buries the findings that
 * matter; and internal links already have a gate of their own in
 * `preview-audit`.
 *
 * Shared by the content-tree scanner and the media manifest, because they were
 * about to answer this question two different ways.
 */
export function assetReferencesIn(
  document: string,
  profile: MediaProfile,
): { reference: AssetReference; identity: AssetIdentity }[] {
  const found: { reference: AssetReference; identity: AssetIdentity }[] = [];
  for (const reference of findReferences(document)) {
    const identity = identifyAsset(reference.url, profile);
    if (
      reference.kind === "href" &&
      identity.classification !== "SUPPORTED" &&
      identity.classification !== "CONFIGURED"
    )
      continue;
    found.push({ reference, identity });
  }
  return found;
}

export interface RewriteResult {
  readonly html: string;
  /** Every reference the document held, with what was decided about it. */
  readonly assets: readonly AssetIdentity[];
}

/**
 * Rewrite every migrated reference to the path this site serves it at.
 *
 * The rewrite is by VALUE, not by position: a value is replaced only when
 * `identifyAsset` says it is migrated, so a document with one migratable image
 * and four external ones comes back with exactly one substitution and four
 * byte-identical strings.
 *
 * A query is preserved. WordPress appends `?ver=` for cache-busting and a
 * plugin can append a real parameter; dropping either changes what the browser
 * asks for. The FILE is the same either way, which is why the normalized key
 * ignores the query and the emitted reference keeps it.
 */
export function rewriteReferences(
  document: string,
  profile: MediaProfile,
): RewriteResult {
  const assets: AssetIdentity[] = [];

  const decide = (raw: string): string => {
    const identity = identifyAsset(raw, profile);
    assets.push(identity);
    if (!isMigrated(identity) || identity.local === undefined) return raw;
    return `${identity.local}${identity.query ?? ""}${identity.fragment ?? ""}`;
  };

  let html = document.replace(
    ATTRIBUTE,
    (whole, attribute: string, quote: string, value: string) => {
      if (value === "") return whole;
      const rewritten = /srcset$/i.test(attribute)
        ? value
            .split(",")
            .map((candidate) => {
              const trimmed = candidate.trim();
              if (trimmed === "") return trimmed;
              const parts = trimmed.split(ASCII_SPACE);
              const url = parts[0] ?? "";
              const descriptor = parts.slice(1).join(" ");
              const next = decide(url);
              return descriptor === "" ? next : `${next} ${descriptor}`;
            })
            .filter((candidate) => candidate !== "")
            .join(", ")
        : decide(value);
      return `${attribute}=${quote}${rewritten}${quote}`;
    },
  );

  html = html.replace(CSS_URL, (whole, quote: string, value: string) => {
    if (value === "") return whole;
    return `url(${quote}${decide(value)}${quote})`;
  });

  html = html.replace(
    MARKDOWN,
    (_whole, open: string, value: string, close: string) =>
      `${open}${decide(value)}${close}`,
  );

  return { html, assets };
}

/**
 * The distinct assets a set of documents references, by normalized key.
 *
 * The de-duplication that makes "one owned asset" true: fifteen references to
 * `2026/01/a.png`, written four different ways, are one entry here. A raw-URL
 * set would report four.
 */
export function distinctAssets(
  identities: readonly AssetIdentity[],
): Map<string, AssetIdentity[]> {
  const byKey = new Map<string, AssetIdentity[]>();
  for (const identity of identities) {
    if (identity.key === undefined) continue;
    const existing = byKey.get(identity.key);
    if (existing === undefined) byKey.set(identity.key, [identity]);
    else existing.push(identity);
  }
  return byKey;
}

/**
 * Two different source files that would be written to one local path.
 *
 * Not the same as one file referenced twice — that is the ordinary case and it
 * de-duplicates. This is `/wp-content/uploads/2026/01/a.png` and
 * `//cdn.example.com/wp-content/uploads/2026/01/a.png` resolving to one output
 * while being, as far as anything here can tell, two different files on two
 * different hosts. The engine refuses rather than picking one.
 */
export function assetConflicts(
  identities: readonly AssetIdentity[],
): { key: string; sources: string[] }[] {
  // The host comes from the classifier rather than being re-parsed here: a
  // second `new URL()` is a second place for the `www.` and scheme rules to
  // drift away from the ones that decided the classification.
  const hosts = new Map<string, Set<string>>();
  for (const identity of identities) {
    if (identity.key === undefined) continue;
    const seen = hosts.get(identity.key) ?? new Set<string>();
    seen.add(identity.host ?? "");
    hosts.set(identity.key, seen);
  }

  const conflicts: { key: string; sources: string[] }[] = [];
  for (const [key, seen] of [...hosts].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    // The site's own host is spelled two ways — absolute and root-relative —
    // and both mean the same file. More than one NAMED host does not.
    const named = [...seen].filter((host) => host !== "");
    if (new Set(named).size > 1) conflicts.push({ key, sources: named.sort() });
  }
  return conflicts;
}
