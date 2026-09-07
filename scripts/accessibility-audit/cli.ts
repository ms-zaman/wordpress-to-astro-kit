#!/usr/bin/env node
// accessibility-audit CLI.
//
// Reads a build output and reports the semantic accessibility contract:
// heading outlines, landmark sets, list semantics, focus coverage, the skip
// link's target, the navigation, and the contrast of every token pair the
// components composite.
//
// Read-only. It never builds and never repairs — `pnpm a11y:audit` builds
// first.
//
//   ERROR          a regression. Exits 1.
//   KNOWN BASELINE a real, owned, deliberately unfixed defect. Never fails,
//                  and CANNOT silently disappear.
//   WARNING        visible, and not callable as a defect without a ruling.
//
// Usage:
//   node scripts/accessibility-audit/cli.ts [dist-directory] [--json] [--quiet]
import path from "node:path";
import process from "node:process";

import { auditAccessibility } from "./audit.ts";
import { bySeverity } from "./finding.ts";

const DEFAULT_OUTPUT = "apps/website/dist";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const quiet = argv.includes("--quiet");
const target =
  argv.find((argument) => !argument.startsWith("--")) ?? DEFAULT_OUTPUT;
const root = path.resolve(process.cwd(), target);

let result;
try {
  result = auditAccessibility(root);
} catch (cause) {
  console.error(
    `Accessibility audit could not run: ${(cause as Error).message}`,
  );
  process.exit(1);
}

const errors = bySeverity(result.findings, "error");
const baselines = bySeverity(result.findings, "baseline");
const warnings = bySeverity(result.findings, "warning");

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (!quiet) {
  const { counts } = result;
  console.log(
    `\naccessibility-audit — ${path.relative(process.cwd(), root) || root}\n`,
  );
  console.log(
    `  ${counts.pages} page(s): ${counts.productionPages} production, ` +
      `${counts.reviewPages} review-only`,
  );
  console.log(
    `  ${counts.headings} heading(s), ${counts.interactiveElements} interactive ` +
      `element(s), ${counts.navLandmarks} nav landmark(s)`,
  );
  console.log(
    `  ${counts.contrastPairs} token contrast pair(s) against ` +
      `${counts.paletteTokens} shipped colour token(s)`,
  );

  if (result.findings.length > 0) console.log("");
  for (const finding of result.findings) {
    const mark =
      finding.severity === "error"
        ? "✗"
        : finding.severity === "baseline"
          ? "◦"
          : "!";
    const where = finding.at === "" ? "(build)" : finding.at;
    console.log(
      `  ${mark} [${finding.check}] ${where}\n      ${finding.detail}`,
    );
  }

  console.log(
    `\n${errors.length} error(s), ${warnings.length} warning(s), ` +
      `${baselines.length} known baseline finding(s)`,
  );
  if (baselines.length > 0)
    console.log(
      "  Known baseline findings are real defects, owned and deliberately " +
        "unfixed.\n  They do not fail this run and they are not resolved.",
    );
}

console.log(
  errors.length === 0 ? "Accessibility audit OK" : "Accessibility audit FAILED",
);
process.exit(errors.length === 0 ? 0 : 1);
