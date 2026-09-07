// The finding record and its ordering.
//
// Output determinism is a requirement, not a nicety: a validator whose output
// reorders between runs cannot be diffed, and a report that cannot be diffed
// cannot show whether a change fixed something or moved it.

export type Severity = "error" | "warning";

export interface Finding {
  readonly path: string;
  /** 1-indexed; 0 for a finding about the document as a whole. */
  readonly line: number;
  readonly rule: string;
  readonly severity: Severity;
  readonly detail: string;
}

/** Total order: path, then line, then rule, then detail. No ties left open. */
export const compareFindings = (a: Finding, b: Finding): number =>
  a.path.localeCompare(b.path) ||
  a.line - b.line ||
  a.rule.localeCompare(b.rule) ||
  a.detail.localeCompare(b.detail);

export const sortFindings = (findings: readonly Finding[]): Finding[] =>
  [...findings].sort(compareFindings);
