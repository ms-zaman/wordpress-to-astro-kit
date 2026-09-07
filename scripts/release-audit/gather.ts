// Gathering the evidence.
//
// The one module in the release audit that touches a filesystem. Everything it
// composes is pure and lives under `apps/website/src/release/`; this is the
// seam where a repository becomes an observation.
//
// ## It runs the audits, it does not re-implement them
//
// `auditPreview`, `auditAccessibility` and `auditSeo` are imported and called.
// A release audit that re-checked links would be a second link checker to keep
// in step, and the two would disagree within a week. So every fact here traces
// to the tool that already owns it, and this module's job is to say which
// facts are which KIND.
//
// ## The contract suites are a separate question
//
// `pnpm content`, `pnpm render` and the build audit are standalone processes
// that call `process.exit`. They cannot be imported. By default they are
// reported as `not-evaluated` — an honest statement that this run did not
// execute them — and `--with-gates` spawns them and records their exit codes.
//
// The default is the conservative one on purpose: a report that quietly
// claimed a suite passed because it usually does is the exact failure the
// three-state verdict exists to prevent.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  evaluateReleaseCandidate,
  type GateObservation,
  type GitState,
  type RcResult,
} from "../../apps/website/src/release/release-candidate.ts";
import {
  DECISIONS,
  registryViolations,
} from "../../apps/website/src/review/decision-registry.ts";
import { signoffStatus } from "../../apps/website/src/release/signoff.ts";
import { auditAccessibility } from "../accessibility-audit/audit.ts";
import { auditPreview } from "../preview-audit/audit.ts";
import { errorsIn as previewErrors } from "../preview-audit/finding.ts";
import { auditSeo } from "../seo-audit/audit.ts";
import { bySeverity as seoBySeverity } from "../seo-audit/finding.ts";
import {
  digestBaselineCount,
  digestFingerprint,
} from "./digest-fingerprint.ts";
import { isAncestorOfHead, readGitState } from "./git-state.ts";

export const DEFAULT_OUTPUT = "apps/website/dist";

/** One contract suite, run as a child process. Read-only; records the exit code. */
function runGate(
  repositoryRoot: string,
  label: string,
  script: string,
  environment: Readonly<Record<string, string>> = {},
): GateObservation {
  const file = path.join(repositoryRoot, script);
  if (!existsSync(file))
    return { ran: false, errors: 0, note: `${script} is not in this tree` };
  const result = spawnSync(process.execPath, [file], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
  if (result.error !== undefined)
    return { ran: false, errors: 0, note: `${label} could not be started` };
  return {
    ran: true,
    errors: result.status === 0 ? 0 : 1,
    note: `${label} exited ${result.status}`,
  };
}

const NOT_RUN = (label: string): GateObservation => ({
  ran: false,
  errors: 0,
  note: `${label} was not run by this evaluation — pass --with-gates to run it`,
});

export interface GatherOptions {
  readonly repositoryRoot: string;
  /** Build output directory, absolute or repository-relative. */
  readonly output?: string;
  /** Spawn the contract suites instead of reporting them not-evaluated. */
  readonly withGates?: boolean;
}

export interface GatherResult {
  readonly root: string;
  readonly rc: RcResult;
  readonly git: GitState;
  /** The render-digest fingerprint, or `"unavailable"`. */
  readonly digest: string;
  readonly digestBaselines: number;
  /** Whether a build output was found and read. */
  readonly buildPresent: boolean;
  /** Counts a reader wants next to the verdict. */
  readonly summary: {
    readonly pages: number;
    readonly routesPromised: number;
    readonly routesEmitted: number;
    readonly internalLinks: number;
  };
}

/**
 * Read a repository and a build output, and evaluate the build as a release
 * candidate.
 *
 * Total. A missing build output is an observation, not an exception — the
 * evaluation says so, and every artifact check reports `not-evaluated` rather
 * than `fail`.
 */
export function gather(options: GatherOptions): GatherResult {
  const repositoryRoot = options.repositoryRoot;
  const root = path.resolve(repositoryRoot, options.output ?? DEFAULT_OUTPUT);

  let previewAudit: GateObservation = NOT_RUN("the preview audit");
  let accessibilityAudit: GateObservation = NOT_RUN("the accessibility audit");
  let seoAudit: GateObservation = NOT_RUN("the SEO audit");
  let brokenLinks = 0;
  let missingAssets = 0;
  let clientScriptPages = 0;
  let unexpectedPages: string[] = [];
  let pages = 0;
  let routesPromised = 0;
  let routesEmitted = 0;
  let internalLinks = 0;
  let buildPresent = false;

  try {
    const preview = auditPreview(root);
    buildPresent = true;
    const errors = previewErrors(preview.findings);
    brokenLinks = errors.filter((finding) => finding.check === "links").length;
    missingAssets = errors.filter(
      (finding) => finding.check === "assets",
    ).length;
    clientScriptPages = errors.filter(
      (finding) => finding.check === "scripts",
    ).length;
    // A route finding whose detail says the inventory does not claim it is an
    // emitted page nothing knows about; one that says "not emitted" is the
    // other direction and is counted by the route totals instead.
    unexpectedPages = errors
      .filter(
        (finding) =>
          finding.check === "routes" &&
          finding.detail.includes("does not claim"),
      )
      .map((finding) => finding.at);
    pages = preview.counts.pages;
    routesPromised = preview.counts.routes;
    routesEmitted =
      routesPromised -
      errors.filter(
        (finding) =>
          finding.check === "routes" && finding.detail.includes("not emitted"),
      ).length;
    internalLinks = preview.counts.internalLinks;
    previewAudit = {
      ran: true,
      errors: errors.length,
      warnings: preview.findings.length - errors.length,
      note: `${preview.counts.pages} page(s), ${preview.counts.internalLinks} internal link(s)`,
    };
  } catch {
    // No build output, or an empty one. Every artifact check stays
    // `not-evaluated`, which is what `buildPresent: false` produces.
  }

  if (buildPresent) {
    const result = auditAccessibility(root);
    const errors = result.findings.filter(
      (finding) => finding.severity === "error",
    );
    const baselined = result.findings.filter(
      (finding) => finding.severity === "baseline",
    );
    accessibilityAudit = {
      ran: true,
      errors: errors.length,
      warnings: result.findings.filter(
        (finding) => finding.severity === "warning",
      ).length,
      note: `${result.counts.pages} page(s), ${baselined.length} known baseline finding(s)`,
    };

    const seo = auditSeo(root);
    seoAudit = {
      ran: true,
      errors: seoBySeverity(seo.findings, "error").length,
      warnings: seoBySeverity(seo.findings, "warning").length,
      note: `built as ${seo.environment}, origin ${seo.origin ?? "undecided"}`,
    };
  }

  // The three that cannot be imported.
  const contentContract = options.withGates
    ? runGate(
        repositoryRoot,
        "the content contract",
        "apps/website/content-contract/run.ts",
      )
    : NOT_RUN("the content contract");
  const renderContract = options.withGates
    ? runGate(
        repositoryRoot,
        "the rendering contract",
        "apps/website/render-contract/run.ts",
      )
    : NOT_RUN("the rendering contract");
  const buildAudit = options.withGates
    ? runGate(
        repositoryRoot,
        "the build audit",
        "apps/website/render-contract/build-audit.ts",
      )
    : NOT_RUN("the build audit");

  const git = readGitState(repositoryRoot);
  const digest = digestFingerprint(repositoryRoot);
  const digestBaselines = digestBaselineCount(repositoryRoot);

  const rc = evaluateReleaseCandidate({
    buildPresent,
    routesPromised,
    routesEmitted,
    unexpectedPages,
    previewAudit,
    accessibilityAudit,
    seoAudit,
    contentContract,
    renderContract,
    buildAudit,
    brokenLinks,
    missingAssets,
    clientScriptPages,
    digestBaselines,
    decisions: DECISIONS,
    registryViolations: registryViolations(),
    git,
    // Resolved here, not inside `evaluateReleaseCandidate`: that module is
    // pure and stays that way. Only a CLEAN tree can be signed off — the thing
    // reviewed and the thing built would otherwise not be the same thing.
    //
    // The digest fingerprint and the ancestry test are read here for the same
    // reason: `signoff.ts` runs no commands and reads no files, so the two
    // facts its carry-forward rule needs are handed to it.
    signoff: signoffStatus({
      commit: git.source === "git" && git.clean ? git.sha : undefined,
      digest,
      isAncestor: (sha) => isAncestorOfHead(repositoryRoot, sha),
    }),
  });

  return {
    root,
    rc,
    git,
    digest,
    digestBaselines,
    buildPresent,
    summary: { pages, routesPromised, routesEmitted, internalLinks },
  };
}
