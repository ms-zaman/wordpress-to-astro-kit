// The release-candidate evaluator.
//
// One question: **is this build ready to be called a release candidate?**
//
// It is emphatically NOT "can this be deployed?". Deployment needs a host, an
// environment, a repository policy and a person, and none of those is a
// property of a build. The evaluator is scoped to what a build can prove about
// itself, and the states it can return say so.
//
// ## Why three states and not a boolean
//
// Because a build has three genuinely different ways of not being a candidate,
// and a boolean folds two of them into the third:
//
//   - **`RC_BLOCKED`** — something is WRONG. A promised route is missing, an
//     audit found an error, a blocking decision is open. There is work to do.
//   - **`RC_REVIEW_REQUIRED`** — nothing is wrong and something is UNKNOWN. A
//     gate did not run; a person has not looked. There is nothing to fix, and
//     it is not a candidate either.
//   - **`RC_READY`** — every check that can run, ran and passed, and every
//     check that needs a person, has one.
//
// A boolean makes "we did not check" indistinguishable from "we checked and it
// is fine", which is the specific failure this whole layer is written against.
//
// ## The rules live here; the facts are passed in
//
// Nothing in this module reads a filesystem, spawns a process, or knows what
// `dist/` is. It takes OBSERVATIONS and applies rules to them, which is what
// makes every rule testable by handing it a fact it has never seen.
import {
  decisionsByStatus,
  type Decision,
} from "../review/decision-registry.ts";
import type { SignoffStatus } from "./signoff.ts";

export type RcVerdict = "RC_READY" | "RC_REVIEW_REQUIRED" | "RC_BLOCKED";

/**
 * What one check concluded.
 *
 * `not-evaluated` and `review-required` are separated deliberately: the first
 * is a machine that did not run, the second is a person who has not answered.
 * They lead to the same verdict and they are not the same fact.
 */
export type RcCheckState =
  "pass" | "fail" | "review-required" | "not-evaluated";

export type RcCheckId =
  | "build"
  | "routes-expected"
  | "routes-complete"
  | "internal-links"
  | "assets"
  | "client-js"
  | "content-contract"
  | "render-contract"
  | "build-audit"
  | "preview-audit"
  | "accessibility-audit"
  | "seo-audit"
  | "render-digest"
  | "open-decisions"
  | "stakeholder-review"
  | "git-state";

export interface RcCheck {
  readonly id: RcCheckId;
  /** What the check asks, as a question a non-engineer can read. */
  readonly question: string;
  readonly state: RcCheckState;
  /** The observation behind the state. Always populated. */
  readonly detail: string;
}

export interface RcResult {
  readonly verdict: RcVerdict;
  readonly checks: readonly RcCheck[];
  readonly counts: Readonly<Record<RcCheckState, number>>;
  /** Check ids at `fail`, sorted. The work list. */
  readonly blocking: readonly RcCheckId[];
  /** Check ids at `review-required` or `not-evaluated`, sorted. */
  readonly unresolved: readonly RcCheckId[];
}

/** What one gate or audit did. `ran: false` means it was not executed. */
export interface GateObservation {
  readonly ran: boolean;
  readonly errors: number;
  readonly warnings?: number;
  /** How it was run, or why it was not. */
  readonly note?: string;
}

/** Git state at the moment a build was evaluated. */
export interface GitState {
  /** Full SHA, or `"unavailable"`. */
  readonly sha: string;
  readonly branch: string;
  /** True when the working tree has no uncommitted change, tracked or not. */
  readonly clean: boolean;
  /**
   * `"git"` when the values were read from a repository. `"unavailable"` when
   * they could not be — a tarball, a sandbox with no git. An unavailable git
   * state is `not-evaluated`, never a failure: a guard that cannot run outside
   * a checkout is a guard nobody runs on the artifact that matters.
   */
  readonly source: "git" | "unavailable";
}

export interface ReleaseCandidateInput {
  /** A build output was found and read. */
  readonly buildPresent: boolean;
  /** Inventory rows the manifest promised, and how many are on disk. */
  readonly routesPromised: number;
  readonly routesEmitted: number;
  /** Emitted HTML no inventory row claims. */
  readonly unexpectedPages: readonly string[];
  readonly previewAudit: GateObservation;
  readonly accessibilityAudit: GateObservation;
  readonly seoAudit: GateObservation;
  readonly contentContract: GateObservation;
  readonly renderContract: GateObservation;
  readonly buildAudit: GateObservation;
  /** Broken internal links the preview audit found. */
  readonly brokenLinks: number;
  /** Referenced assets the build did not emit. */
  readonly missingAssets: number;
  /** Pages that acquired undeclared client-side JavaScript. */
  readonly clientScriptPages: number;
  /** How many render-digest baselines are on record. */
  readonly digestBaselines: number;
  readonly decisions: readonly Decision[];
  /** Rows contradicting the registry's own rules. */
  readonly registryViolations: readonly string[];
  readonly git: GitState;
  /**
   * Whether a person recorded a review of THIS build.
   *
   * Passed in rather than read here, because this module is pure:
   * measurements in, verdict out, no filesystem and no module state. The
   * gatherer resolves it.
   */
  readonly signoff: SignoffStatus;
}

const gateCheck = (
  id: RcCheckId,
  question: string,
  observation: GateObservation,
): RcCheck => {
  if (!observation.ran)
    return {
      id,
      question,
      state: "not-evaluated",
      detail:
        observation.note ??
        "not run in this evaluation — a check that did not run is not a check that passed",
    };
  const warnings =
    observation.warnings !== undefined && observation.warnings > 0
      ? `, ${observation.warnings} warning(s)`
      : "";
  const note = observation.note === undefined ? "" : ` — ${observation.note}`;
  if (observation.errors > 0)
    return {
      id,
      question,
      state: "fail",
      detail: `${observation.errors} error(s)${warnings}${note}`,
    };
  return { id, question, state: "pass", detail: `0 errors${warnings}${note}` };
};

/**
 * Evaluate one build.
 *
 * Total: every check returns a state for every input, including inputs that
 * describe a build that does not exist. A missing build makes the artifact
 * checks `not-evaluated` rather than `fail`, because "we could not look" and
 * "we looked and it was broken" are different, and only the second is a defect
 * in the site.
 */
export function evaluateReleaseCandidate(
  input: ReleaseCandidateInput,
): RcResult {
  const pending = decisionsByStatus("pending", input.decisions);
  const blockingDecisions = pending.filter(
    (decision) => decision.impact === "blocking",
  );

  const notBuilt = (id: RcCheckId, question: string): RcCheck => ({
    id,
    question,
    state: "not-evaluated",
    detail:
      "no build output was read, so nothing about the artifact was observed",
  });

  const artifact = (check: RcCheck): RcCheck =>
    input.buildPresent ? check : notBuilt(check.id, check.question);

  const missing = input.routesPromised - input.routesEmitted;

  const checks: RcCheck[] = [
    {
      id: "build",
      question: "Did the build produce an output that could be read?",
      state: input.buildPresent ? "pass" : "fail",
      detail: input.buildPresent
        ? `build output read; ${input.routesEmitted} of ${input.routesPromised} inventory row(s) present on disk`
        : "no build output — run `pnpm build` before evaluating a candidate",
    },
    artifact({
      id: "routes-expected",
      question: "Was every route the route model promises emitted?",
      state: missing === 0 ? "pass" : "fail",
      detail:
        missing === 0
          ? `all ${input.routesPromised} promised route(s) are on disk`
          : `${missing} promised route(s) were not emitted`,
    }),
    artifact({
      id: "routes-complete",
      question: "Does the inventory account for every page the build emitted?",
      state: input.unexpectedPages.length === 0 ? "pass" : "fail",
      detail:
        input.unexpectedPages.length === 0
          ? `${input.routesPromised} row(s), no unaccounted page`
          : `${input.unexpectedPages.length} emitted page(s) no inventory row claims: ${input.unexpectedPages.slice(0, 5).join(", ")}`,
    }),
    artifact({
      id: "internal-links",
      question: "Does every internal link resolve to a page that exists?",
      state: input.brokenLinks === 0 ? "pass" : "fail",
      detail:
        input.brokenLinks === 0
          ? "no broken internal link"
          : `${input.brokenLinks} broken internal link(s)`,
    }),
    artifact({
      id: "assets",
      question: "Is every referenced asset present in the output?",
      state: input.missingAssets === 0 ? "pass" : "fail",
      detail:
        input.missingAssets === 0
          ? "no missing asset reference"
          : `${input.missingAssets} referenced asset(s) are not in the output`,
    }),
    artifact({
      id: "client-js",
      question: "Did any page acquire undeclared client-side JavaScript?",
      state: input.clientScriptPages === 0 ? "pass" : "fail",
      detail:
        input.clientScriptPages === 0
          ? "no page ships undeclared client-side JavaScript"
          : `${input.clientScriptPages} page(s) do, which needs a decision first`,
    }),
    gateCheck(
      "content-contract",
      "Does every content entry satisfy its schema and its contract?",
      input.contentContract,
    ),
    gateCheck(
      "render-contract",
      "Do the route and rendering models still hold?",
      input.renderContract,
    ),
    gateCheck(
      "build-audit",
      "Does the built HTML carry what the routes composed?",
      input.buildAudit,
    ),
    gateCheck(
      "preview-audit",
      "Does the build output pass the preview audit?",
      input.previewAudit,
    ),
    gateCheck(
      "accessibility-audit",
      "Does the build pass the accessibility audit, with its baseline asserted in both directions?",
      input.accessibilityAudit,
    ),
    gateCheck(
      "seo-audit",
      "Does every page carry the head a crawler needs?",
      input.seoAudit,
    ),
    {
      // Not a pass/fail on the pages themselves — `render:digest` is the gate
      // that compares them. What this asks is whether there is anything to
      // compare AGAINST, because a sign-off carries forward only for as long
      // as the digest is unchanged. With no baselines the sign-off rule has
      // nothing to hold on to, and saying "pass" would be reporting an absence
      // as a verification.
      id: "render-digest",
      question: "Is there a recorded baseline of what every page looks like?",
      state: input.digestBaselines > 0 ? "pass" : "not-evaluated",
      detail:
        input.digestBaselines > 0
          ? `${input.digestBaselines} route/width digest(s) on record in research/render-digest`
          : "no digest baseline has been recorded — walk the routes, then run `pnpm render:digest --update`. Until then a sign-off cannot carry forward, because there is nothing to say the pages are unchanged",
    },
    {
      id: "open-decisions",
      question: "Is any decision with blocking impact still open?",
      state:
        input.registryViolations.length > 0
          ? "fail"
          : blockingDecisions.length > 0
            ? "fail"
            : pending.length > 0
              ? "review-required"
              : "pass",
      detail:
        input.registryViolations.length > 0
          ? `${input.registryViolations.length} registry rule violation(s): ${input.registryViolations.join("; ")}`
          : blockingDecisions.length > 0
            ? `${blockingDecisions.length} blocking decision(s) open: ${blockingDecisions.map((decision) => decision.id).join(", ")}`
            : pending.length > 0
              ? `${pending.length} pending decision(s), none blocking — each is somebody's to answer`
              : "no pending decision in the registry",
    },
    {
      id: "stakeholder-review",
      question: "Has a person walked THIS build?",
      // Never `fail`. An unreviewed build is not a broken build, and calling
      // it one would let somebody "fix" it by asserting a review happened.
      //
      // It is tied to a COMMIT rather than to a flag. A flag means "somebody
      // typed --reviewed once" and says nothing about which build they looked
      // at; `signoffStatus` matches the recorded sign-off against the build
      // being evaluated.
      state: input.signoff.signed ? "pass" : "review-required",
      detail: input.signoff.signed
        ? input.signoff.detail
        : `${input.signoff.detail} — only a person can move this, and no automated check may`,
    },
    {
      id: "git-state",
      question: "Can this evaluation be tied to an identifiable commit?",
      state:
        input.git.source !== "git"
          ? "not-evaluated"
          : input.git.clean
            ? "pass"
            : "fail",
      detail:
        input.git.source !== "git"
          ? "git state could not be read, so nothing ties this build to a revision"
          : input.git.clean
            ? `${input.git.sha} on ${input.git.branch}, clean working tree`
            : `${input.git.sha} on ${input.git.branch}, but the working tree has uncommitted changes — the build does not correspond to any commit`,
    },
  ];

  return summarize(checks);
}

/** Fold the checks into a verdict. Exported so the rule itself is testable. */
export function summarize(checks: readonly RcCheck[]): RcResult {
  const counts: Record<RcCheckState, number> = {
    pass: 0,
    fail: 0,
    "review-required": 0,
    "not-evaluated": 0,
  };
  for (const check of checks) counts[check.state] += 1;

  const blocking = checks
    .filter((check) => check.state === "fail")
    .map((check) => check.id)
    .sort();
  const unresolved = checks
    .filter(
      (check) =>
        check.state === "review-required" || check.state === "not-evaluated",
    )
    .map((check) => check.id)
    .sort();

  const verdict: RcVerdict =
    blocking.length > 0
      ? "RC_BLOCKED"
      : unresolved.length > 0
        ? "RC_REVIEW_REQUIRED"
        : "RC_READY";

  return { verdict, checks, counts, blocking, unresolved };
}

/**
 * What the verdict means, in one sentence, for a reader who did not write it.
 *
 * Kept next to the rule so the two cannot drift, and worded so that no line of
 * it could be quoted as a deployment authorization.
 */
export const VERDICT_MEANING: Readonly<Record<RcVerdict, string>> = {
  RC_READY:
    "Every check that can run has run and passed, and every check that needs a person has one. This is a statement about the BUILD. It is not a deployment authorization: hosting, environment and repository policy are separate and are not evaluated here.",
  RC_REVIEW_REQUIRED:
    "Nothing is known to be wrong and something is unknown — a gate did not run, or a person has not looked. There is nothing to fix and this is not a candidate.",
  RC_BLOCKED:
    "At least one check failed. The failing check ids are the work list; nothing else about the build is claimed either way.",
} as const;
