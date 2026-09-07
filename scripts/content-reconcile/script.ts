// Reading a comparison key without assuming it is written in English.
//
// ## The defect this exists for
//
// The first version of the reconciler asked two questions about a string —
// "does this match end where a word ends?" and "is this long enough to be
// content rather than a decorative glyph?" — and answered both with rules that
// only describe the Latin alphabet:
//
//     boundary:  /[a-z0-9]/          length:  key.length >= 3
//
// Both are wrong outside Latin, and **both fail toward false agreement**,
// which is the dangerous direction for this tool. Measured on the shipped
// code, before this module existed:
//
//     says("$999.99/month", "$999.99/mo")  ->  false   correct
//     says("会社概要", "会社")               ->  TRUE    wrong
//     says("দামি", "দাম")                  ->  TRUE    wrong
//     says("كتابي", "كتاب")                ->  TRUE    wrong
//
// No character of 会社, দাম or كتاب matches `[a-z0-9]`, so every position in
// those strings read as a word boundary, the guard silently evaporated, and
// containment alone counted as agreement. A struck-out price, a truncated
// heading, a plan name that is a prefix of another — every difference the
// boundary rule was written to catch came back, reported as a match.
//
// The length rule failed the same way in the other direction. Measured:
//
//     asked("<h2>会社</h2><a>採用</a><h2>お問い合わせ</h2>")  ->  ['お問い合わせ']
//
// Two of the page's three strings were discarded for being "too short", and a
// page compared on a third of itself reports the rest as matched.
//
// ## What this module does NOT do
//
// It does not tokenise. `Intl.Segmenter` with `granularity: "word"` would give
// real word boundaries for Japanese and Thai, and it is deliberately not used:
// its CJK segmentation comes from an ICU dictionary that differs between ICU
// builds, so the same page would reconcile differently on two machines. A gate
// whose verdict depends on which Node built it is not a gate. Grapheme
// segmentation IS used, because UAX #29 grapheme rules are locale-independent
// and stable.
//
// It also does not try to be right about every script. It tries to be
// CONSERVATIVE: where the rule is unsure, it keeps the string and lets the
// difference be reported. Over-reporting costs somebody a ruling; under-
// reporting silently ships a page that does not say what the source says.
//
// ## Unicode normalization
//
// Comparison keys are normalised to **NFC**, not NFKC. NFC is canonical
// equivalence: `é` written as one code point and as `e` + U+0301 are the same
// character, and a source site authored on one system against a build authored
// on another must not differ over that. WordPress serves both — the REST API
// returns whatever the editor stored.
//
// NFKC was considered and rejected. It folds COMPATIBILITY differences —
// full-width `Ａ` to `A`, `①` to `1`, `ﬁ` to `fi` — and in Japanese and Korean
// content the full-width/half-width distinction is a real editorial choice
// that a migration can get wrong. Folding it would hide that class of
// difference, and hiding differences is the failure this whole tool exists to
// prevent.

/**
 * A character that continues a word.
 *
 * Letters, numbers and combining marks, plus the two join controls. The marks
 * matter more than anything else here: in Bengali `দামি` is `দ` `া` `ম` `ি`,
 * and the character after a match on `দাম` is the vowel sign `ি` — a mark, not
 * a letter. A rule that checked only letters and digits would call that a word
 * boundary and match a different word. The same holds for Devanagari, Tamil,
 * Thai, Arabic vowel points and every other script that writes with marks.
 *
 * `‌` (ZWNJ) and `‍` (ZWJ) are format characters, not marks, and
 * they appear INSIDE words in Indic and Arabic script. Counting them as
 * continuation is the conservative choice: it can only refuse a match, never
 * invent one.
 */
const WORD_CONTINUES = /[\p{L}\p{N}\p{M}‌‍]/u;

/**
 * Whether a match at `at` in `corpus` ends where a word ends, on both sides.
 *
 * This is the generalisation of the old `[a-z0-9]` test, and it keeps its
 * behaviour exactly on Latin text while giving the same protection to every
 * other script.
 */
export function isWholeWordAt(
  corpus: string,
  key: string,
  at: number,
): boolean {
  const before = at === 0 ? "" : corpus[at - 1]!;
  const after = corpus[at + key.length] ?? "";
  return !WORD_CONTINUES.test(before) && !WORD_CONTINUES.test(after);
}

/**
 * Grapheme segmentation, pinned to `und`.
 *
 * An explicit locale rather than the machine's default, so two people running
 * this gate on the same page get the same answer. `und` — "undetermined" — is
 * the honest tag for a tool that does not know what language it is reading.
 */
const GRAPHEMES = new Intl.Segmenter("und", { granularity: "grapheme" });

/**
 * How many user-visible characters a string has.
 *
 * Not `String.length`, which counts UTF-16 code units, and not code points
 * either. Measured: `দামি` is 4 code points and **2 graphemes**; an NFD `café`
 * is 5 code points and 4 graphemes; a ZWJ family emoji is 5 code points and 1
 * grapheme. A length rule written against code points is a rule about encoding
 * rather than about what a reader sees.
 */
export function visibleLength(text: string): number {
  let count = 0;
  for (const _segment of GRAPHEMES.segment(text)) count += 1;
  return count;
}

/**
 * Scripts in which two characters are still plausibly decoration.
 *
 * This is the list the old floor of three was measured against, named rather
 * than assumed: Latin, Cyrillic and Greek, plus `Common` (digits, punctuation,
 * symbols, the arrows and bullets an icon font maps into) and `Inherited`
 * (marks that take the script of what they attach to).
 *
 * An icon font's glyphs are mapped into exactly this range, which is what the
 * floor was ever really guarding against — `f` for a Facebook mark, `»` for a
 * chevron, `->` for an arrow.
 */
const SPARSE_SCRIPTS =
  /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Common}\p{Script=Inherited}]*$/u;

/**
 * The shortest string worth comparing, in graphemes.
 *
 * Three for a string written entirely in the sparse scripts above — unchanged,
 * so Latin pages reconcile exactly as they did. Two for anything else, because
 * in Han, Kana, Hangul and every abugida a single grapheme cluster is a
 * syllable or a whole word: `会社` is "company", `採用` is "recruitment",
 * `দাম` is "price", `לא` is "no". Discarding those is discarding content.
 *
 * Two, not one, in every script: a lone grapheme cannot be told apart from a
 * decorative mark by any rule that does not know the font.
 *
 * The cost of keeping three for Latin is known and accepted: a real two-letter
 * label — `OK`, a `de`/`fr` language switcher — is still dropped. That is
 * inherited behaviour, it under-reports, and it is left alone here only
 * because changing Latin's floor is a separate decision with its own noise
 * budget. It is written down rather than forgotten.
 */
export const MIN_LENGTH_SPARSE = 3;
export const MIN_LENGTH_DENSE = 2;

export function minimumLength(key: string): number {
  return SPARSE_SCRIPTS.test(key) ? MIN_LENGTH_SPARSE : MIN_LENGTH_DENSE;
}

/**
 * The longest string worth comparing, in graphemes.
 *
 * A label is short; a paragraph is prose, and prose belongs to the walk rather
 * than to a string comparison. 140 graphemes is more prose in Japanese than in
 * English — which errs toward keeping more strings, the safe direction.
 */
export const MAX_LENGTH = 140;

/** Whether a normalised key is in the band this tool compares. */
export function isComparable(key: string): boolean {
  const length = visibleLength(key);
  return length >= minimumLength(key) && length <= MAX_LENGTH;
}
