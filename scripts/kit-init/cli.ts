#!/usr/bin/env node
// pnpm kit:init --name acme [--site-name "Acme"] [--origin https://acme.com]
//               [--live-origin https://old.acme.com] [--dry-run] [--root <dir>]
//
// Stamps your identity into the kit: renames the placeholder prefix on every
// class, data attribute, build variable and workspace package, and writes the
// site's name and origins where they live. See init.ts.
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { applyInit, planInit, remainingOccurrences } from "./init.ts";

const argv = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};
const dryRun = argv.includes("--dry-run");
const root = path.resolve(
  value("--root") ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const name = value("--name");

if (name === undefined) {
  console.error(
    "usage: pnpm kit:init --name <prefix> [--site-name <name>] [--origin <url>] [--live-origin <url>] [--dry-run]",
  );
  process.exit(2);
}

const plan = planInit(root, {
  name,
  siteName: value("--site-name"),
  origin: value("--origin"),
  liveOrigin: value("--live-origin"),
});

console.log(`kit:init — ${plan.currentPrefix} → ${plan.nextPrefix} in ${root}`);
console.log(`  ${plan.changes.length} file(s) would change`);
for (const change of plan.changes.slice(0, 40))
  console.log(`    ${path.relative(root, change.file)}`);
if (plan.changes.length > 40)
  console.log(`    … and ${plan.changes.length - 40} more`);
for (const warning of plan.warnings) console.log(`  warning: ${warning}`);

if (dryRun) {
  console.log("  dry run — nothing written.");
  process.exit(0);
}

applyInit(plan);
const remaining =
  plan.currentPrefix === plan.nextPrefix
    ? []
    : remainingOccurrences(root, plan.currentPrefix);
if (remaining.length > 0) {
  console.error(
    `  ${remaining.length} file(s) still carry "${plan.currentPrefix}": ${remaining.slice(0, 10).join(", ")}`,
  );
  process.exit(1);
}
console.log(
  `  done. Every class, variable and package now carries "${plan.nextPrefix}". Run \`pnpm install\` to refresh the workspace links, then \`pnpm build\`.`,
);
