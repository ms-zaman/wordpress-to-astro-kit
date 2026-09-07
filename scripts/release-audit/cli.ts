#!/usr/bin/env node
// `pnpm release:review` — is this build a release candidate?
//
// It answers one question about a build that already exists, and refuses to
// answer a second:
//
//   - **Is it a release candidate?** `RC_READY` / `RC_REVIEW_REQUIRED` /
//     `RC_BLOCKED`, with the failing check ids as the work list.
//   - **May it be deployed?** Not answered here, and never will be. Hosting,
//     environment and repository policy are not properties of a build.
//
// **Read-only.** Nothing is written. It never builds — `pnpm build` produces
// the artifact and this reports on it, the same contract `preview-audit` has,
// so a run against a stale `dist/` audits that stale output. `pnpm
// release:review` builds first.
//
// **It approves nothing and resolves nothing.** There is no code path here
// that writes to `apps/website/src/`, so it cannot record a sign-off or close
// a decision. Both are a person's to do, by editing the file.
//
// ## Exit codes
//
// `RC_BLOCKED` exits 1: at least one check FAILED, and that is a defect.
// `RC_REVIEW_REQUIRED` exits 0, because "a person has not looked yet" is the
// correct state of most builds and a command that failed when it reported the
// truth is a command nobody runs. `--require-rc-ready` turns the verdict into
// an exit code for a caller that wants one.
//
// Usage:
//   node scripts/release-audit/cli.ts [dist-dir] [--json] [--quiet]
//                                     [--with-gates] [--require-rc-ready]
import path from "node:path";
import process from "node:process";

import { VERDICT_MEANING } from "../../apps/website/src/release/release-candidate.ts";
import { DEFAULT_OUTPUT, gather } from "./gather.ts";

const argv = process.argv.slice(2);
const has = (flag: string): boolean => argv.includes(flag);

const json = has("--json");
const quiet = has("--quiet");
const requireReady = has("--require-rc-ready");
const withGates = has("--with-gates");

const repositoryRoot = process.cwd();
const output =
  argv.find((argument) => !argument.startsWith("--")) ?? DEFAULT_OUTPUT;

const result = gather({ repositoryRoot, output, withGates });
const { rc } = result;

if (json) {
  console.log(
    JSON.stringify(
      {
        verdict: rc.verdict,
        meaning: VERDICT_MEANING[rc.verdict],
        counts: rc.counts,
        blocking: rc.blocking,
        unresolved: rc.unresolved,
        checks: rc.checks,
        git: result.git,
        digest: result.digest,
        summary: result.summary,
      },
      null,
      2,
    ),
  );
  process.exit(exitCode());
}

const relative = path.relative(repositoryRoot, result.root) || ".";

if (!quiet) {
  console.log(`\nRelease audit — ${relative}\n`);
  console.log(
    `  revision        : ${result.git.sha}${
      result.git.source === "git"
        ? ` on ${result.git.branch}, ${result.git.clean ? "clean" : "DIRTY"}`
        : ""
    }`,
  );
  console.log(
    `  routes          : ${result.summary.routesEmitted} of ${result.summary.routesPromised} emitted, ` +
      `${result.summary.pages} page(s), ${result.summary.internalLinks} internal link(s)`,
  );
  console.log(
    `  render digest   : ${result.digestBaselines} baseline(s), fingerprint ${result.digest.slice(0, 12)}`,
  );
  if (!withGates)
    console.log(
      "\n  The content contract, the rendering contract and the build audit were\n" +
        "  NOT run by this evaluation. Pass --with-gates to run them. A check that\n" +
        "  did not run is not a check that passed.",
    );
  console.log("");
}

console.log(`  Release candidate: ${rc.verdict}`);
console.log(`    ${VERDICT_MEANING[rc.verdict]}\n`);
for (const check of rc.checks) {
  const marker =
    check.state === "pass"
      ? "✓"
      : check.state === "fail"
        ? "✗"
        : check.state === "review-required"
          ? "?"
          : "◦";
  console.log(`    ${marker} ${check.id} — ${check.detail}`);
}
console.log(
  `\n    ${rc.counts.pass} pass, ${rc.counts.fail} fail, ` +
    `${rc.counts["review-required"]} awaiting a person, ` +
    `${rc.counts["not-evaluated"]} not evaluated\n`,
);

process.exit(exitCode());

function exitCode(): number {
  if (rc.verdict === "RC_BLOCKED") return 1;
  if (requireReady && rc.verdict !== "RC_READY") return 1;
  return 0;
}
