// What a slug may be — the one authority, for the schema and the transform.
//
// This module exists because the answer was written twice and both copies
// described the Latin alphabet:
//
//     content-model/shared.ts      /^[a-z0-9]+(?:-[a-z0-9]+)*$/
//     content-transform/transform  /^[a-z0-9]+(?:-[a-z0-9]+)*$/
//
// WordPress's `post_name` is not restricted to ASCII, and on a site that
// publishes in any script but Latin it usually is not ASCII. Measured on
// ja.wordpress.org: 3 posts and 7 tags carried a slug no character of which
// matched `[a-z0-9]`, and the tags were dropped without a record — nine posts
// kept a tag reference to a term that had silently ceased to exist.
//
// ## Two spellings, one slug
//
// WordPress percent-encodes a non-ASCII slug on the way into the database:
// `sanitize_title_with_dashes()` calls `utf8_uri_encode()`, so the term named
// 翻訳 is stored, and served by REST, as `%e7%bf%bb%e8%a8%b3`. The two are the
// same URL — RFC 3986 §2.1: a percent-encoded octet decodes to the data it
// encodes — so `/tag/%e7%bf%bb%e8%a8%b3/` and `/tag/翻訳/` name one resource,
// and a browser asking for the second sends the first.
//
// So the slug this kit stores is the DECODED form: it is what WordPress
// displays, it is what a person reading `content/` can recognise, and it
// re-encodes to the URL the source published. The decode is reported per row
// rather than performed quietly — see `readSourceSlug`.
//
// ## Why NFC is required rather than applied
//
// Refusing a slug that is not in Unicode NFC looks pedantic until you measure
// the filesystem. On macOS (APFS) normalisation forms are INTERCHANGEABLE for
// lookup: a file written under an NFD name is found under its NFC spelling and
// the reverse. Measured, on this machine:
//
//     write NFD "가나.md"  →  exists("가나.md" as NFC) === true
//
// On Linux — which is what CI runs — they are two different files. So a
// content tree holding both spellings of one slug is one entry on a laptop and
// two in CI, and neither machine reports anything wrong. Normalising silently
// would hide it; refusing names it while it is still one row in a capture.
//
// NFC, never NFKC: NFKC folds full-width ａ onto a and ㈱ onto (株), which
// changes which characters the source published. The same choice, for the same
// reason, is made in `scripts/content-reconcile/script.ts`.

/**
 * One unit of a slug: a letter with no uppercase form, a digit, a combining
 * mark, or an underscore.
 *
 *   `\p{Ll}`  lowercase letters — a-z, а-я, ς
 *   `\p{Lo}`  letters with no case at all — 翻, 訳, ก, א, ب, ক
 *   `\p{Lm}`  modifier letters — ー (U+30FC), the Japanese prolonged sound
 *             mark, which is in half the katakana slugs there are
 *   `\p{N}`   digits, in any script
 *   `\p{M}`   combining marks — Devanagari and Bengali matras, Thai vowels
 *   `_`       WordPress keeps the underscore: `sanitize_title_with_dashes()`
 *             strips `[^%a-z0-9 _-]` and turns spaces into hyphens
 *
 * `\p{Lu}` and `\p{Lt}` are absent on purpose, and that is not a new rule: the
 * pattern this replaces refused `A-Z` too. WordPress lower-cases a slug with
 * `mb_strtolower()` before storing it, so an upper-case slug did not come from
 * WordPress's own sanitiser and the kit says so rather than guessing a case
 * mapping — which is locale-dependent (Turkish İ) and therefore a decision.
 */
const WORD = "[\\p{Ll}\\p{Lo}\\p{Lm}\\p{N}\\p{M}_]";

/** Words joined by single hyphens: no leading, trailing or doubled hyphen. */
const SLUG_BODY = `${WORD}+(?:-${WORD}+)*`;

/** URL-segment identity. Immutable, extracted from the source, never derived. */
export const SLUG = new RegExp(`^${SLUG_BODY}$`, "u");

/** `<set>/<source-slug>`: the set is this kit's own name, so it stays ASCII. */
export const CLUSTER_KEY = new RegExp(`^[a-z0-9-]+/${SLUG_BODY}$`, "u");

export const SLUG_MESSAGE =
  "slug must be one or more lowercase or caseless words joined by single " +
  "hyphens, in Unicode NFC — ASCII is not required, upper case is refused";

export const CLUSTER_KEY_MESSAGE =
  "cluster must be `<set>/<source-slug>`, the set in kebab-case and the slug " +
  "in the slug alphabet";

/** Why a source slug cannot become this kit's slug. Each one is actionable. */
export type SlugRefusal =
  /** `%zz`, or a truncated escape: `decodeURIComponent` throws on it. */
  | "malformed-escape"
  /** Decodes cleanly, but not to Unicode NFC. See the header. */
  | "not-nfc"
  /** Outside the alphabet: upper case, a space, a dot, a slash, an emoji. */
  | "outside-alphabet";

export interface SlugAccepted {
  readonly ok: true;
  /** The slug to store: percent-decoded, verified NFC, verified in alphabet. */
  readonly slug: string;
  /** True when the source spelling was percent-encoded and this one is not. */
  readonly decoded: boolean;
}

export interface SlugRefused {
  readonly ok: false;
  readonly reason: SlugRefusal;
  /** A sentence naming the value and what about it was refused. */
  readonly detail: string;
}

export type SlugReading = SlugAccepted | SlugRefused;

/**
 * Read a slug as WordPress stores it, and say plainly whether this kit can
 * represent it.
 *
 * Nothing here repairs a value. A slug that arrives outside the alphabet
 * leaves as a refusal with a reason, because the alternative — transliterate,
 * strip, or normalise — invents a URL the source never served, and a migration
 * whose URLs are invented has lost the one thing it was for.
 */
export function readSourceSlug(raw: string): SlugReading {
  if (raw === "")
    return {
      ok: false,
      reason: "outside-alphabet",
      detail: "the source supplies an empty slug.",
    };

  let value = raw;
  let decoded = false;
  if (raw.includes("%")) {
    try {
      value = decodeURIComponent(raw);
    } catch {
      // Reachable from real content: ja.wordpress.org publishes a body with
      // `href="%s"`, an unfilled printf template, and `decodeURIComponent`
      // throws URIError on it rather than returning anything.
      return {
        ok: false,
        reason: "malformed-escape",
        detail:
          `"${raw}" is not a valid percent-encoding, so it names no ` +
          "character sequence and cannot be decoded to one.",
      };
    }
    decoded = value !== raw;
  }

  if (value.normalize("NFC") !== value)
    return {
      ok: false,
      reason: "not-nfc",
      detail:
        `"${value}" is not in Unicode NFC. Two normalisation forms of one ` +
        "slug are one file on macOS and two on Linux, so this kit refuses " +
        "the ambiguity rather than choosing a form on the source's behalf.",
    };

  if (!SLUG.test(value))
    return {
      ok: false,
      reason: "outside-alphabet",
      detail:
        `"${value}"${decoded ? ` (decoded from "${raw}")` : ""} is not ` +
        `${SLUG_MESSAGE}.`,
    };

  return { ok: true, slug: value, decoded };
}

/** True when this kit can store the value as a slug exactly as it stands. */
export function isSlug(value: string): boolean {
  return SLUG.test(value) && value.normalize("NFC") === value;
}
