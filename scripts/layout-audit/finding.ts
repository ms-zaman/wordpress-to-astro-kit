// Finding shape for the layout audit.
//
// Three severities, the same three the accessibility audit uses and for the
// same reason: a defect that is real, owned and deliberately unfixed is a
// different thing from a regression, and collapsing them makes one of the two
// invisible.

export type Severity = "error" | "warning" | "baseline";

export type CheckId =
  | "overflow"
  /**
   * A form control wider than the element that owns it.
   *
   * Separate from `overflow` because it is a different measurement, not a
   * different cause: a control can overflow its own grid cell by 34px inside a
   * panel wide enough to hold it, and the document never scrolls sideways. One
   * kind for both would let a clean `scrollWidth` stand in for a clean form.
   */
  | "control-overflow"
  | "viewport-coverage";

export interface Finding {
  readonly severity: Severity;
  readonly check: CheckId;
  /** The route, e.g. `/about/`. */
  readonly at: string;
  /** The viewport width in px, or `""` for a whole-run finding. */
  readonly key: string;
  readonly detail: string;
}

/** Stable identity, so a baseline entry and a finding name the same thing. */
export const idOf = (finding: Finding): string =>
  `${finding.check}|${finding.at}|${finding.key}`;

const make =
  (severity: Severity) =>
  (check: CheckId, at: string, key: string, detail: string): Finding => ({
    severity,
    check,
    at,
    key,
    detail,
  });

export const error = make("error");
export const warning = make("warning");
export const baseline = make("baseline");

export const bySeverity = (
  findings: readonly Finding[],
  severity: Severity,
): Finding[] => findings.filter((finding) => finding.severity === severity);

export const sortFindings = (findings: readonly Finding[]): Finding[] =>
  [...findings].sort(
    (a, b) =>
      a.at.localeCompare(b.at) ||
      Number(a.key || 0) - Number(b.key || 0) ||
      a.check.localeCompare(b.check),
  );
