// Decision registry: every question the migration opened that only a person
// with the standing to answer can close — design, product, the owner — in
// one place, with its state and its owner.
//
// A module and not only a document because things cite these ids: a review
// note in a component, a mission record, the release audit. The rendering
// contract asserts every cited id exists, every pending row carries an owner
// and an impact, and no id is recorded twice — so the registry cannot quietly
// rot, and it can never become a to-do list an agent closes by itself.

/** Who can answer a question. Not who does the work afterwards. */
export type DecisionOwner =
  "design" | "product" | "engineering" | "owner" | "design+engineering";

export type DecisionStatus = "resolved" | "pending";

/** How much is blocked while a question stays open. */
export type DecisionImpact = "blocking" | "significant" | "contained";

export interface Decision {
  /** Stable id: `D-<mission>-<n>`. */
  readonly id: string;
  /** The question, as a question, in one line. */
  readonly title: string;
  readonly status: DecisionStatus;
  readonly owner: DecisionOwner;
  /** Present on a pending row; absent on a resolved one. */
  readonly impact?: DecisionImpact;
  readonly recordedBy: number;
  /** For a resolved row: what was decided, and on what evidence. */
  readonly resolution?: string;
}

/**
 * Every recorded decision, resolved first, then pending by impact.
 *
 * Empty in the kit. The first rows a migration records are the Day-0
 * questions in CHECKLIST.md — design source, URL shapes, the production
 * origin, form delivery, which surfaces are the product's — each with the
 * owner who can answer it.
 */
export const DECISIONS: readonly Decision[] = [];

export function decisionIds(
  decisions: readonly Decision[] = DECISIONS,
): string[] {
  return decisions.map((decision) => decision.id);
}

export function findDecision(
  id: string,
  decisions: readonly Decision[] = DECISIONS,
): Decision | undefined {
  return decisions.find((decision) => decision.id === id);
}

export function decisionsByStatus(
  status: DecisionStatus,
  decisions: readonly Decision[] = DECISIONS,
): Decision[] {
  return decisions.filter((decision) => decision.status === status);
}

/** Ways the registry can be wrong about itself. */
export function registryViolations(
  decisions: readonly Decision[] = DECISIONS,
): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (seen.has(decision.id))
      violations.push(`${decision.id}: recorded twice`);
    seen.add(decision.id);
    if (!/^D-\d{3}-\d+$/.test(decision.id))
      violations.push(`${decision.id}: id must be D-<mission>-<n>`);
    if (decision.status === "resolved") {
      if (!decision.resolution)
        violations.push(`${decision.id}: resolved without a resolution`);
      if (decision.impact !== undefined)
        violations.push(`${decision.id}: resolved rows carry no impact`);
    } else if (decision.impact === undefined) {
      violations.push(`${decision.id}: pending without an impact`);
    }
  }
  return violations;
}
