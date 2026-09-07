// The known layout baseline.
//
// Every entry is a REAL defect this repository renders today and has
// deliberately not fixed. Asserted in BOTH directions by `audit.ts`:
//
//   - a finding whose id is here is reported as `baseline` and does not fail;
//   - **an id here that the audit no longer finds is an `error`**, because a
//     defect that quietly disappeared means behaviour changed without the
//     record changing.
//
// A list that only ever grows is a list nobody prunes.

export interface LayoutBaselineEntry {
  /** The finding id, `overflow|<route>|<viewport>`. */
  readonly id: string;
  /** What causes it, specifically enough to act on. */
  readonly cause: string;
  /** Why it is open rather than fixed. */
  readonly reason: string;
}

/**
 * Known overflow defects.
 *
 * **Empty, and the emptiness is the assertion.** An entry belongs here only
 * when the fix genuinely waits on a person — a design ruling, somebody else's
 * embed. A defect you can fix is fixed, not recorded.
 */
export const KNOWN_LAYOUT_BASELINE: readonly LayoutBaselineEntry[] =
  [] as const;
