// Turning measurements into a report, and deciding what fails.
import { baselineFor } from "./baseline.ts";
import type { ContrastFinding } from "./probe.ts";

/** The identity a baseline entry is keyed on. Not the ratio — see `baseline.ts`. */
export const idOf = (finding: ContrastFinding): string =>
  `${finding.route}|${finding.element}|${finding.text}`;

export interface Classified {
  readonly failures: readonly ContrastFinding[];
  readonly baselined: readonly ContrastFinding[];
  /** A baseline entry nothing measured any more — a claim that has gone stale. */
  readonly stale: readonly string[];
}

/**
 * Split what was measured into what fails and what has been decided about.
 *
 * Both directions: an unexplained finding fails, and a baseline entry for a
 * finding that no longer occurs fails too, because a repository asserting
 * something untrue about itself is a defect rather than a status.
 */
export function classify(
  findings: readonly ContrastFinding[],
  baselineIds: readonly string[],
): Classified {
  // The ids come in as an argument and are the ONLY source consulted. Reading
  // the module's own set for membership while taking the argument for
  // staleness gives the function two sources of truth, which this module's own
  // suite caught the first time it ran: a caller could baseline a finding and
  // still be told it fails.
  const accepted = new Set(baselineIds);
  const failures: ContrastFinding[] = [];
  const baselined: ContrastFinding[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    const id = idOf(finding);
    seen.add(id);
    if (accepted.has(id)) baselined.push(finding);
    else failures.push(finding);
  }
  return {
    failures,
    baselined,
    stale: baselineIds.filter((id) => !seen.has(id)),
  };
}

/** One finding, in the words a person needs to act on it. */
export function describe(finding: ContrastFinding): string {
  const decision = baselineFor(idOf(finding))?.decision;
  return (
    `  ${String(finding.ratio).padStart(6)}:1  needs ${finding.required}  ` +
    `${finding.route} @${finding.viewport}\n` +
    `      ${finding.element}  ${Math.round(finding.size)}px/${finding.weight}  ` +
    `${finding.color} on ${finding.ground}\n` +
    `      "${finding.text}"` +
    (decision ? `\n      accepted: ${decision}` : "")
  );
}
