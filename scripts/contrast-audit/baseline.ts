// Rendered-contrast findings this repository has SEEN and decided about.
//
// **Empty, and that is the assertion.**
// `scripts/accessibility-audit/baseline.ts` carries the same shape and the
// same emptiness for the same reason: a baseline is a place a real finding
// goes to be forgotten, so every entry needs a decision behind it and the
// healthy state of this file is nothing in it.
//
// An entry is keyed on route + element + text, NOT on the ratio, so a finding
// that gets WORSE stays baselined rather than reappearing as a new one. That
// is deliberate and it is the reason each entry names a decision: the check
// that the ratio has not moved is a person re-reading the decision, not a
// number comparison.
//
// ## What belongs here in a migration
//
// One thing, and it is common: a colour pair the SOURCE site already fails,
// carried across verbatim inside a migrated body. Recolouring somebody else's
// article is an editorial act, and a migration that silently improves content
// is as untrue to the source as one that silently loses it. Measure the pair
// on the live site, record the measurement in the decision, and record the
// row. Fixed at the source, the next capture drops the row and the
// both-direction check makes you delete it.
//
// What does NOT belong here is a pair YOU authored. That is a token to change.

/** One accepted rendered-contrast finding. */
export interface BaselineEntry {
  /** `route|element|text` — exactly as the report prints it. */
  readonly id: string;
  /** Why it is accepted, and by whom. Name the decision. */
  readonly decision: string;
}

export const KNOWN_BASELINE: readonly BaselineEntry[] = [] as const;

const ids = new Set(KNOWN_BASELINE.map((entry) => entry.id));

export const isBaselined = (id: string): boolean => ids.has(id);

export const baselineFor = (id: string): BaselineEntry | undefined =>
  KNOWN_BASELINE.find((entry) => entry.id === id);
