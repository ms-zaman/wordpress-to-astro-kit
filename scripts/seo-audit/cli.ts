#!/usr/bin/env node
// seo-audit CLI.
//
// Reads a build output and reports the on-page SEO contract: titles,
// descriptions, the social head, canonicals, the robots directive the launch
// switch decided, structured data, and head hygiene.
//
// Read-only. It never builds and never repairs — `pnpm seo:audit` builds first.
//
// Usage:
//   node scripts/seo-audit/cli.ts [dist-directory] [--json] [--quiet]
import path from "node:path";
import process from "node:process";

import { auditSeo } from "./audit.ts";
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
  result = auditSeo(root);
} catch (cause) {
  console.error(`SEO audit could not run: ${(cause as Error).message}`);
  process.exit(1);
}

const errors = bySeverity(result.findings, "error");
const warnings = bySeverity(result.findings, "warning");

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (!quiet) {
  console.log(`\nSEO audit — ${path.relative(process.cwd(), root) || root}\n`);
  console.log(
    `  ${result.counts.pages} page(s): ${result.counts.productionPages} production, ${result.counts.reviewPages} review-only`,
  );
  console.log(
    `  ${result.counts.titles} title(s), ${result.counts.descriptions} description(s), ${result.counts.canonicals} canonical(s), ${result.counts.structuredDataBlocks} structured-data block(s)`,
  );
  console.log(`  built as: ${result.environment}`);

  // Stated every run, not only when something fails. Half of what this audit
  // asserts is conditional on it, and a clean run means something different
  // depending on which half applied.
  if (result.origin === undefined)
    console.log(
      "\n  No production origin is decided (content/config/site.json).\n" +
        "  Canonicals, og:url, absolute og:image and sitemap.xml are asserted ABSENT.\n" +
        "  That is the contract today, not a gap this audit is ignoring.",
    );
  else console.log(`\n  Origin: ${result.origin}`);

  if (result.findings.length > 0) console.log("");
  for (const finding of result.findings)
    console.log(
      `  ${finding.severity === "error" ? "✗" : "!"} [${finding.check}] ${finding.at}\n      ${finding.detail}`,
    );
}

if (!quiet)
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
console.log(errors.length === 0 ? "SEO audit OK" : "SEO audit FAILED");
process.exit(errors.length === 0 ? 0 : 1);
