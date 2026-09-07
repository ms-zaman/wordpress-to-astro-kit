// Findings.
//
// The audit reports rather than throws, for the reason the docs validator gives
// for the same shape: an operator running a preview check wants the whole list,
// not the first item on it. Only two conditions throw, and both are recorded
// where they happen — a missing output directory and an unreadable manifest,
// because neither leaves anything to audit.
//
// `severity` is a real distinction here, not decoration. A `warning` is a fact
// the audit can see but cannot call a defect without a ruling that has not been
// made — an external link it did not follow, a build with a placeholder
// timestamp. Only `error` fails the run.

export type Severity = "error" | "warning";

/** The five checks Task D specifies, plus the manifest that ties them together. */
export type CheckId =
  "build" | "manifest" | "routes" | "links" | "assets" | "scripts";

export interface Finding {
  readonly check: CheckId;
  readonly severity: Severity;
  /** Dist-relative file, a route path, or `""` for a whole-build finding. */
  readonly at: string;
  readonly detail: string;
}

export const error = (check: CheckId, at: string, detail: string): Finding => ({
  check,
  severity: "error",
  at,
  detail,
});

export const warning = (
  check: CheckId,
  at: string,
  detail: string,
): Finding => ({ check, severity: "warning", at, detail });

export const errorsIn = (findings: readonly Finding[]): Finding[] =>
  findings.filter((finding) => finding.severity === "error");

/** Findings in a stable order: by check, then by location, then by detail. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  const order: readonly CheckId[] = [
    "build",
    "manifest",
    "routes",
    "links",
    "assets",
    "scripts",
  ];
  return [...findings].sort(
    (left, right) =>
      order.indexOf(left.check) - order.indexOf(right.check) ||
      left.at.localeCompare(right.at) ||
      left.detail.localeCompare(right.detail),
  );
}
