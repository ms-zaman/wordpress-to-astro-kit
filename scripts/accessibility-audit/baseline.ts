// The known accessibility baseline.
//
// Every entry is a defect that is REAL, is owned by a decision, and was
// deliberately not fixed because fixing it needs a ruling nobody has made.
//
// ## This list is not a suppression file
//
// It is asserted in both directions by `audit.ts`:
//
//   - a finding whose id is here is reported as `baseline` and does not fail;
//   - **an id here that the audit no longer finds is reported as an `error`**,
//     because a defect that quietly disappeared means somebody changed
//     behaviour without changing the record.
//
// A list that only ever grows is a list nobody prunes.
//
// ## What belongs here in a migration, and what never does
//
// **Belongs:** the source site's own editorial, carried across verbatim. Fifteen
// articles that skip a heading level, one that carries three `<h1>` elements —
// those were the shape of it in the project this kit came from, and every one
// of them was live's own. Repairing them means renumbering somebody else's
// document, which is an editorial judgement a migration has no standing to
// make; and the body is carried byte-for-byte precisely so a reconciler can
// compare it to the source. Record the row, name the decision, and let the
// fix happen in WordPress — the next capture drops the row, and the
// both-direction contract fails until it does.
//
// **Never belongs:** a defect in a component YOU wrote. A control with no
// focus ring is a rule to add, not a row to file. If you find yourself
// baselining your own chrome, the entry is hiding work rather than recording a
// decision.
//
// **The kit ships with none**, and that is a result rather than a default: the
// sample site has no such defect. The suite exercises both directions against
// a synthetic list, which is exactly what an empty record needs — a mechanism
// that can only be tested against real entries is a mechanism nothing tests on
// the day the last entry is fixed.

export interface BaselineEntry {
  /** The finding id, `check|at|key`. */
  readonly id: string;
  /** The decision that owns it. */
  readonly decision: string;
  /** Why it is open rather than fixed. */
  readonly reason: string;
}

export const KNOWN_BASELINE: readonly BaselineEntry[] = [] as const;

const ids = new Set(KNOWN_BASELINE.map((entry) => entry.id));

/** Is this finding a known, owned, open defect? */
export const isBaselined = (id: string): boolean => ids.has(id);

export const baselineFor = (id: string): BaselineEntry | undefined =>
  KNOWN_BASELINE.find((entry) => entry.id === id);

export const baselineIds = (): string[] => [...ids].sort();
