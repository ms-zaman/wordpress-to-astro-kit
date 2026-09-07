// The judgement half of the render digest.
//
// Pure: baseline text in, recorded text in, findings out. No filesystem, no
// browser, no clock. The suite exercises this without any of them, which is
// the same split `scripts/layout-audit` uses and for the same reason — the
// part that decides is the part worth testing, and it should not need Chrome.

/** What changed about one route at one width. */
export type Change =
  /** A digest exists in the build and no baseline was ever recorded. */
  | { readonly kind: "unrecorded"; readonly file: string }
  /** A baseline exists and the build no longer produces that route. */
  | { readonly kind: "vanished"; readonly file: string }
  /** Both exist and differ. */
  | {
      readonly kind: "changed";
      readonly file: string;
      readonly added: readonly string[];
      readonly removed: readonly string[];
    };

export interface DigestFile {
  readonly file: string;
  readonly text: string;
}

/**
 * How far a box may move before it counts as a change.
 *
 * **One pixel, and the number was measured rather than chosen.** In the
 * original project the baselines were recorded on macOS and compared on Linux.
 * The first such run differed on 9 of 44 digests, and analysing every one of
 * the 19 differing pairs gave: zero differences in any painted property, and a
 * maximum delta of 1px — sub-pixel text advances accumulating to a different
 * integer under a different rasteriser.
 *
 * **That measurement has a precondition, and it is not optional: the site
 * self-hosted its fonts.** The glyph metrics then come from identical files on
 * both machines and only the rounding drifts. A site on a system font stack —
 * which is what this kit ships until you measure a real design — renders text
 * in a DIFFERENT TYPEFACE on each operating system, and no tolerance can
 * reconcile that. `research/render-digest/README.md` says what to do about it,
 * and it is why the kit ships no baselines.
 *
 * This is a tolerance on GEOMETRY ONLY. Every colour, fill, gradient, radius,
 * size, weight and string still has to match exactly, and so does the presence
 * of every element. None of the defects that escaped to that project's owner
 * would slip through it: a missing background, a missing tab, a panel painted
 * twice and a bar overflowing its box are all property or element changes, or
 * geometry shifts far larger than a pixel.
 *
 * Re-verify it after changing the digest, the way that project did: revert a
 * real fix and confirm this still reports it.
 */
export const GEOMETRY_TOLERANCE = 1;

/** A line split into the part that must match exactly and the part that may drift. */
interface ParsedLine {
  readonly raw: string;
  /** Indent, label, painted properties and text — compared exactly. */
  readonly key: string;
  /** The numbers in the geometry field, or `undefined` when it carries none. */
  readonly geometry: readonly number[] | undefined;
}

/**
 * The separator between a line's label and the rest of its key.
 *
 * A character that cannot occur in a digest line, so two different lines
 * cannot collide into one bucket by concatenation. A space would: a label
 * ending in one and a property list starting with one produce the same key as
 * the pair shifted by a character.
 */
const KEY_SEPARATOR = "␟";

const parseLine = (raw: string): ParsedLine => {
  const parts = raw.split(" | ");
  if (parts.length < 2) return { raw, key: raw, geometry: undefined };
  const [label, geometry, ...rest] = parts;
  const numbers = geometry!.match(/-?\d+/g);
  return {
    raw,
    key: `${label}${KEY_SEPARATOR}${rest.join(" | ")}`,
    // `display:none` carries no numbers and must match exactly, so it stays in
    // the key rather than becoming an empty tolerance.
    geometry: numbers === null ? undefined : numbers.map(Number),
  };
};

const withinTolerance = (
  left: readonly number[] | undefined,
  right: readonly number[] | undefined,
): boolean => {
  if (left === undefined || right === undefined) return left === right;
  if (left.length !== right.length) return false;
  return left.every(
    (value, index) => Math.abs(value - right[index]!) <= GEOMETRY_TOLERANCE,
  );
};

/**
 * The line differences between two digests.
 *
 * Lines are grouped by everything except their geometry, and within a group
 * the boxes are matched greedily inside `GEOMETRY_TOLERANCE`. What is left
 * over on either side is the difference.
 *
 * Not a longest-common-subsequence diff: an element that moved in document
 * order shows as one removal and one addition, which is exactly what happened,
 * and `git diff` on the baseline file is where a reviewer reads it in context.
 *
 * Lines are compared as a MULTISET, not a set. Thirty cards on one page share
 * a signature, and a set difference would report nothing when one of them
 * disappeared.
 */
export function lineDifference(
  before: string,
  after: string,
): { added: string[]; removed: string[] } {
  const parse = (text: string): ParsedLine[] =>
    text
      .split("\n")
      .filter((line) => line !== "")
      .map(parseLine);

  const byKey = new Map<string, { left: ParsedLine[]; right: ParsedLine[] }>();
  const bucket = (
    line: ParsedLine,
  ): { left: ParsedLine[]; right: ParsedLine[] } => {
    const existing = byKey.get(line.key);
    if (existing !== undefined) return existing;
    const created = { left: [] as ParsedLine[], right: [] as ParsedLine[] };
    byKey.set(line.key, created);
    return created;
  };

  for (const line of parse(before)) bucket(line).left.push(line);
  for (const line of parse(after)) bucket(line).right.push(line);

  const removed: string[] = [];
  const added: string[] = [];
  for (const { left, right } of byKey.values()) {
    const taken = new Set<number>();
    for (const candidate of left) {
      const match = right.findIndex(
        (other, index) =>
          !taken.has(index) &&
          withinTolerance(candidate.geometry, other.geometry),
      );
      if (match === -1) removed.push(candidate.raw);
      else taken.add(match);
    }
    right.forEach((line, index) => {
      if (!taken.has(index)) added.push(line.raw);
    });
  }
  return { added: added.sort(), removed: removed.sort() };
}

/**
 * Compare a build's digests against the recorded baselines.
 *
 * Both directions, deliberately. A route that disappears from the build is as
 * much a change as one that differs, and a baseline nobody prunes is how a
 * stale record survives.
 */
export function compareDigests(
  recorded: readonly DigestFile[],
  built: readonly DigestFile[],
): Change[] {
  const baseline = new Map(recorded.map((entry) => [entry.file, entry.text]));
  const current = new Map(built.map((entry) => [entry.file, entry.text]));
  const changes: Change[] = [];

  for (const [file, text] of current) {
    const before = baseline.get(file);
    if (before === undefined) {
      changes.push({ kind: "unrecorded", file });
      continue;
    }
    const { added, removed } = lineDifference(before, text);
    // The DIFFERENCE decides, not raw text equality. Two digests that differ
    // only inside `GEOMETRY_TOLERANCE` are not a change, and comparing the
    // text first reported nine files as changed with nothing under them.
    if (added.length === 0 && removed.length === 0) continue;
    changes.push({ kind: "changed", file, added, removed });
  }

  for (const file of baseline.keys())
    if (!current.has(file)) changes.push({ kind: "vanished", file });

  return changes.sort((left, right) => left.file.localeCompare(right.file));
}

/** A change, as one readable block. `limit` caps the lines quoted per side. */
export function describe(change: Change, limit = 6): string {
  if (change.kind === "unrecorded")
    return (
      `  ! ${change.file}\n` +
      "      no baseline recorded. LOOK at the route first, then run " +
      "`pnpm render:digest --update` and read the diff."
    );
  if (change.kind === "vanished")
    return (
      `  ! ${change.file}\n` +
      "      a baseline exists and the build no longer produces this route."
    );
  const quote = (lines: readonly string[], mark: string): string =>
    lines
      .slice(0, limit)
      .map((line) => `      ${mark} ${line.trim()}`)
      .join("\n") +
    (lines.length > limit
      ? `\n      ${mark} … ${lines.length - limit} more`
      : "");
  const parts = [`  ✗ ${change.file}`];
  if (change.removed.length > 0) parts.push(quote(change.removed, "-"));
  if (change.added.length > 0) parts.push(quote(change.added, "+"));
  return parts.join("\n");
}

/** One line summarising a comparison, for the end of a run. */
export function summarize(changes: readonly Change[]): string {
  if (changes.length === 0)
    return "Every route renders exactly as it was recorded.";
  const changed = changes.filter((change) => change.kind === "changed").length;
  const unrecorded = changes.filter(
    (change) => change.kind === "unrecorded",
  ).length;
  const vanished = changes.filter(
    (change) => change.kind === "vanished",
  ).length;
  return (
    `${changes.length} route/width digest(s) differ — ` +
    `${changed} changed, ${unrecorded} unrecorded, ${vanished} vanished`
  );
}
