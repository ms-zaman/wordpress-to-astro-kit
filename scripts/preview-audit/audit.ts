// The preview audit, composed.
//
// One function over a build output, returning everything the five checks found
// plus the counts that make a passing run informative. A run that prints only
// "OK" tells an operator nothing about whether it looked at eighteen pages or
// at none, which is how a vacuous pass goes unnoticed for a month.
import {
  checkAssets,
  checkLinks,
  checkManifest,
  checkRoutes,
  checkScripts,
} from "./checks.ts";
import { errorsIn, sortFindings, type Finding } from "./finding.ts";
import { htmlPages, readBuildOutput, type BuildOutput } from "./output.ts";
import { collectReferences } from "./references.ts";

export interface AuditCounts {
  readonly files: number;
  readonly pages: number;
  /** Routes the manifest claims; `0` when there is no usable manifest. */
  readonly routes: number;
  readonly internalLinks: number;
  readonly externalLinks: number;
  readonly assetReferences: number;
}

export interface AuditResult {
  readonly root: string;
  readonly findings: readonly Finding[];
  readonly counts: AuditCounts;
  /** True when nothing at `error` severity was found. */
  readonly ok: boolean;
}

const countReferences = (
  output: BuildOutput,
): Pick<AuditCounts, "internalLinks" | "externalLinks" | "assetReferences"> => {
  let internalLinks = 0;
  let externalLinks = 0;
  let assetReferences = 0;

  for (const document of htmlPages(output)) {
    for (const reference of collectReferences(
      document.file,
      document.text ?? "",
    )) {
      if (reference.isAsset) assetReferences += 1;
      else if (reference.scope === "external") externalLinks += 1;
      else if (reference.scope !== "fragment") internalLinks += 1;
    }
  }

  return { internalLinks, externalLinks, assetReferences };
};

/** Audit an already-read build output. */
export function auditBuildOutput(output: BuildOutput): AuditResult {
  const manifestResult = checkManifest(output);

  const findings = sortFindings([
    ...manifestResult.findings,
    ...checkRoutes(output, manifestResult.manifest),
    ...checkLinks(output),
    ...checkAssets(output),
    ...checkScripts(output),
  ]);

  return {
    root: output.root,
    findings,
    counts: {
      files: output.files.size,
      pages: htmlPages(output).length,
      routes: manifestResult.manifest?.routes.inventory.length ?? 0,
      ...countReferences(output),
    },
    ok: errorsIn(findings).length === 0,
  };
}

/**
 * Audit a build output directory.
 *
 * Throws when there is nothing to audit — see `readBuildOutput`. Every other
 * condition is a finding, because a preview check should be able to say five
 * things are wrong in one run.
 */
export function auditPreview(root: string): AuditResult {
  return auditBuildOutput(readBuildOutput(root));
}
