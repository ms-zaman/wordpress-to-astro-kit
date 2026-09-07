#!/usr/bin/env node
// layout-audit CLI.
//
// Reports horizontal overflow for every built route at every viewport, in a
// real rendering engine with webfonts loaded. See `audit.ts` for why this
// cannot be done by parsing markup.
//
// Read-only. It never builds and never repairs — `pnpm layout:audit` builds
// first.
//
//   ERROR          a page overflows and nothing owns it — exits 1
//   KNOWN BASELINE a real, owned, deliberately unfixed overflow — never fails,
//                  and CANNOT silently disappear
//
// Usage:
//   node scripts/layout-audit/cli.ts [dist-directory] [--json] [--quiet]
import path from "node:path";
import process from "node:process";

import { findingsFor, measure, VIEWPORTS } from "./audit.ts";
import { bySeverity, sortFindings } from "./finding.ts";

const DEFAULT_OUTPUT = "apps/website/dist";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const quiet = argv.includes("--quiet");
const positional = argv.filter((argument) => !argument.startsWith("--"));
const distDirectory = path.resolve(positional[0] ?? DEFAULT_OUTPUT);

const measurements = await measure(distDirectory);
const findings = sortFindings(findingsFor(measurements));
const errors = bySeverity(findings, "error");
const baselines = bySeverity(findings, "baseline");
const warnings = bySeverity(findings, "warning");

if (json) {
  console.log(
    JSON.stringify({ measured: measurements.length, findings }, null, 2),
  );
} else if (!quiet) {
  const routes = new Set(measurements.map((m) => m.route)).size;
  console.log(
    `layout-audit — ${routes} route(s) x ${VIEWPORTS.length} viewport(s), ` +
      `${measurements.length} measurement(s), webfonts loaded`,
  );
  for (const finding of findings) {
    const mark =
      finding.severity === "error"
        ? "✗"
        : finding.severity === "baseline"
          ? "◦"
          : "!";
    const where = finding.key ? `${finding.at} @${finding.key}` : finding.at;
    console.log(`${mark} ${where}  ${finding.detail}`);
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
  console.log(errors.length === 0 ? "Layout audit OK" : "Layout audit FAILED");
}

process.exit(errors.length === 0 ? 0 : 1);
