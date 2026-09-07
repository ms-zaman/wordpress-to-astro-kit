// Findings.
//
// Same reporting shape as the other audits: report the whole list, do not
// throw on the first item, because an operator fixing SEO wants to see every
// page at once.
//
// ## Two severities, not three
//
// The accessibility audit has a third, `baseline`, for a defect that is real,
// owned by a decision, and deliberately unfixed. This audit has no such state
// and should not grow one speculatively. Everything it checks is either
// correct or a defect — including the tags that are **correctly absent** while
// no production origin exists, which are asserted as absent rather than
// excused. See `checkCanonical`.
//
//   - `error`   — a defect. Fails the run.
//   - `warning` — visible, and not callable as a defect without a ruling.

export type Severity = "error" | "warning";

/** The areas this audit covers. */
export type CheckId =
  | "title"
  | "description"
  | "social"
  | "canonical"
  | "robots"
  | "structured-data"
  | "head";

export interface Finding {
  readonly check: CheckId;
  readonly severity: Severity;
  /** Dist-relative page file, or `""` for a whole-build finding. */
  readonly at: string;
  readonly detail: string;
  /** Stable identity: `check|at|key`. Two findings with one id are one defect. */
  readonly id: string;
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

export const bySeverity = (
  findings: readonly Finding[],
  severity: Severity,
): Finding[] => findings.filter((finding) => finding.severity === severity);

/** Findings in a stable order, so two runs of one build print identically. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  const order: readonly CheckId[] = [
    "title",
    "description",
    "social",
    "canonical",
    "robots",
    "structured-data",
    "head",
  ];
  return [...findings].sort(
    (left, right) =>
      order.indexOf(left.check) - order.indexOf(right.check) ||
      left.at.localeCompare(right.at) ||
      left.detail.localeCompare(right.detail),
  );
}
