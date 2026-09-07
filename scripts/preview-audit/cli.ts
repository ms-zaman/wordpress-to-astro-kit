#!/usr/bin/env node
// preview-audit CLI.
//
// Verifies a build before anyone looks at it: the output exists, every route
// the manifest promised was emitted, no internal link is broken, no asset is
// missing, and no page acquired client-side JavaScript.
//
// Read-only. It never builds, never writes, and never repairs — `pnpm build`
// produces the artifact and this reports on it. Running it against a stale
// `dist/` audits that stale output, exactly as the build audit does, which is
// why `pnpm preview:audit` builds first.
//
// Exit code 1 on any `error` finding; warnings never fail a run — a warning is
// a fact the audit can see but cannot call a defect without a ruling nobody
// has made.
//
// Usage:
//   node scripts/preview-audit/cli.ts [dist-directory] [--json] [--quiet]
import path from "node:path";
import process from "node:process";

import { auditPreview } from "./audit.ts";
import { errorsIn } from "./finding.ts";

const DEFAULT_OUTPUT = "apps/website/dist";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const quiet = argv.includes("--quiet");
const target =
  argv.find((argument) => !argument.startsWith("--")) ?? DEFAULT_OUTPUT;
const root = path.resolve(process.cwd(), target);

let result;
try {
  result = auditPreview(root);
} catch (cause) {
  // The two unrecoverable conditions: no output directory, or an empty one.
  // Both mean there is nothing to report on, so this is the one place the tool
  // fails instead of finding.
  console.error((cause as Error).message);
  process.exit(1);
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const relative = path.relative(process.cwd(), result.root) || ".";
const { counts } = result;

if (!quiet) {
  console.log(`\nPreview audit — ${relative}\n`);
  console.log(
    `  ${counts.files} file(s), ${counts.pages} page(s), ` +
      `${counts.routes} route(s) in the manifest`,
  );
  console.log(
    `  ${counts.internalLinks} internal link(s), ${counts.assetReferences} asset ` +
      `reference(s), ${counts.externalLinks} external link(s) recorded and not followed\n`,
  );
}

for (const finding of result.findings) {
  const marker = finding.severity === "error" ? "✗" : "!";
  const where = finding.at === "" ? relative : finding.at;
  console.log(`  ${marker} [${finding.check}] ${where}`);
  console.log(`      ${finding.detail}`);
}

const errors = errorsIn(result.findings);
const warnings = result.findings.length - errors.length;

console.log(
  `\n${errors.length} error(s), ${warnings} warning(s) across ${counts.pages} page(s)`,
);

if (errors.length > 0) {
  console.error("\nPreview audit FAILED\n");
  process.exit(1);
}
console.log("Preview audit OK\n");
