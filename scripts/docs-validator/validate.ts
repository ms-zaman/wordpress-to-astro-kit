// Validation orchestration.
//
// Pure over its inputs: documents in, report out. Everything that touches the
// filesystem is behind the resolver the caller supplies, which is what lets the
// same rules run over a repository, a review tool's in-memory buffer, or a
// test's fixture map.

import { sortFindings, type Finding } from "./finding.ts";
import { validateHeadings } from "./headings.ts";
import {
  countExternalLinks,
  validateLinks,
  type LinkResolver,
} from "./links.ts";
import { validateMetadata } from "./metadata.ts";
import type { Document } from "./markdown.ts";

export const toolVersion = "1.0.0";

export const ruleGroups = ["metadata", "headings", "links"] as const;
export type RuleGroup = (typeof ruleGroups)[number];

export interface Report {
  readonly tool: "docs-validator";
  readonly toolVersion: string;
  readonly groups: readonly RuleGroup[];
  readonly documents: number;
  readonly externalLinks: number;
  readonly errors: number;
  readonly warnings: number;
  /** Rule → count, key-sorted so two runs serialize identically. */
  readonly byRule: Readonly<Record<string, number>>;
  readonly findings: readonly Finding[];
}

export function validateDocument(
  document: Document,
  resolver: LinkResolver,
  groups: readonly RuleGroup[],
): readonly Finding[] {
  const findings: Finding[] = [];
  if (groups.includes("metadata")) findings.push(...validateMetadata(document));
  if (groups.includes("headings")) findings.push(...validateHeadings(document));
  if (groups.includes("links")) {
    findings.push(...validateLinks(document, resolver));
  }
  return findings;
}

export function validateDocuments(
  documents: readonly Document[],
  resolver: LinkResolver,
  groups: readonly RuleGroup[] = ruleGroups,
): Report {
  const findings = sortFindings(
    documents.flatMap((document) =>
      validateDocument(document, resolver, groups),
    ),
  );

  const byRule: Record<string, number> = {};
  for (const finding of findings) {
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
  }

  return {
    tool: "docs-validator",
    toolVersion,
    groups: [...groups],
    documents: documents.length,
    externalLinks: groups.includes("links")
      ? documents.reduce(
          (total, document) => total + countExternalLinks(document),
          0,
        )
      : 0,
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning")
      .length,
    byRule: Object.fromEntries(
      Object.entries(byRule).sort(([a], [b]) => a.localeCompare(b)),
    ),
    findings,
  };
}
