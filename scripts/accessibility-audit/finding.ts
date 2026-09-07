// Findings.
//
// The audit reports rather than throws, because an operator wants the whole
// list and not the first item on it.
//
// ## Three severities, and the third one is the point
//
// `preview-audit` has two — a warning is something it can see but cannot call
// a defect. This audit needs a third, because accessibility work has a state
// those two cannot express: **a defect that is real, known, owned by a named
// decision, and deliberately not fixed.** In a migration that is almost always
// the source site's own editorial, carried across verbatim.
//
//   - `error`    — a regression. Fails the run.
//   - `warning`  — visible, not callable as a defect without a ruling.
//   - `baseline` — a KNOWN open defect, matched against `baseline.ts` by an
//                  exact key. Does not fail the run.
//
// The distinction that makes `baseline` safe rather than a mute button: the
// list is asserted in BOTH directions by `audit.ts`. An entry that stops being
// found is reported as `error` ("stale"), so a known failure cannot be
// silently fixed and cannot silently spread — the only way to change the set
// is to edit the list on purpose.

export type Severity = "error" | "warning" | "baseline";

/** The areas this audit covers. */
export type CheckId =
  | "headings"
  | "landmarks"
  | "focus"
  | "navigation"
  | "lists"
  | "skip-link"
  | "contrast";

export interface Finding {
  readonly check: CheckId;
  readonly severity: Severity;
  /** Dist-relative page file, or `""` for a whole-build finding. */
  readonly at: string;
  readonly detail: string;
  /**
   * Stable identity for baseline matching: `check|at|key`. Two findings with
   * the same id are the same defect. Present on every finding so that any of
   * them CAN be baselined, not only the ones that are.
   */
  readonly id: string;
  /** The decision this is waiting on, for `baseline` findings. */
  readonly decision?: string;
}

const make =
  (severity: Severity) =>
  (check: CheckId, at: string, key: string, detail: string): Finding => ({
    check,
    severity,
    at,
    detail,
    id: `${check}|${at}|${key}`,
  });

export const error = make("error");
export const warning = make("warning");

export const errorsIn = (findings: readonly Finding[]): Finding[] =>
  findings.filter((finding) => finding.severity === "error");

export const bySeverity = (
  findings: readonly Finding[],
  severity: Severity,
): Finding[] => findings.filter((finding) => finding.severity === severity);

/** Findings in a stable order, so two runs of one build print identically. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  const order: readonly CheckId[] = [
    "contrast",
    "headings",
    "landmarks",
    "lists",
    "focus",
    "skip-link",
    "navigation",
  ];
  return [...findings].sort(
    (left, right) =>
      order.indexOf(left.check) - order.indexOf(right.check) ||
      left.at.localeCompare(right.at) ||
      left.detail.localeCompare(right.detail),
  );
}
