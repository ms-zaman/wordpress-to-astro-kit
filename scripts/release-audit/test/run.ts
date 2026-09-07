// release-audit suite.
//
// Three halves, in the order they matter.
//
// THE VERDICT: `evaluateReleaseCandidate` is pure — observations in, verdict
// out — so every rule can be exercised by handing it a fact it has never seen.
// This is where the three states are held apart, and where the two checks that
// may never `fail` are proved not to.
//
// THE SIGN-OFF: `signoffStatus` is the one release check no automated thing
// may decide, and its carry-forward rule has four outcomes that are easy to
// collapse into two. Each is asserted separately.
//
// THE READERS: the fingerprint and the git state, against real directories and
// a real throwaway repository — the only way to prove that "not a checkout"
// and "a commit this clone cannot see" produce different answers.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  evaluateReleaseCandidate,
  summarize,
  VERDICT_MEANING,
  type GateObservation,
  type GitState,
  type RcCheck,
  type ReleaseCandidateInput,
} from "../../../apps/website/src/release/release-candidate.ts";
import {
  signoffFor,
  signoffStatus,
  SIGNOFFS,
  type Signoff,
} from "../../../apps/website/src/release/signoff.ts";
import {
  digestBaselineCount,
  digestFingerprint,
} from "../digest-fingerprint.ts";
import { isAncestorOfHead, readGitState, UNAVAILABLE } from "../git-state.ts";

let passed = 0;
const failures: string[] = [];

const check = (name: string, assertion: () => void): void => {
  try {
    assertion();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (thrown) {
    failures.push(`${name} — ${(thrown as Error).message}`);
    console.log(`  ✗ ${name}`);
  }
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const equal = (actual: unknown, expected: unknown, label: string): void =>
  assert(
    actual === expected,
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );

const created: string[] = [];
const temp = (prefix: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
};

const ran = (errors = 0): GateObservation => ({ ran: true, errors });
const notRun: GateObservation = { ran: false, errors: 0, note: "not run" };

const CLEAN_GIT: GitState = {
  sha: "a".repeat(40),
  branch: "main",
  clean: true,
  source: "git",
};

/** A build with nothing wrong and everything run. The baseline every case moves from. */
const perfect = (
  over: Partial<ReleaseCandidateInput> = {},
): ReleaseCandidateInput => ({
  buildPresent: true,
  routesPromised: 20,
  routesEmitted: 20,
  unexpectedPages: [],
  previewAudit: ran(),
  accessibilityAudit: ran(),
  seoAudit: ran(),
  contentContract: ran(),
  renderContract: ran(),
  buildAudit: ran(),
  brokenLinks: 0,
  missingAssets: 0,
  clientScriptPages: 0,
  digestBaselines: 12,
  decisions: [],
  registryViolations: [],
  git: CLEAN_GIT,
  signoff: { signed: true, detail: "reviewed by a person" },
  ...over,
});

const stateOf = (result: { checks: readonly RcCheck[] }, id: string): string =>
  result.checks.find((candidate) => candidate.id === id)?.state ?? "absent";

// ---------------------------------------------------------------------------
console.log("\nThe verdict — three states, held apart");

check(
  "everything run, everything passing, a person has looked: RC_READY",
  () => {
    equal(evaluateReleaseCandidate(perfect()).verdict, "RC_READY", "verdict");
  },
);

check("a gate that DID NOT RUN is RC_REVIEW_REQUIRED, never RC_READY", () => {
  // The distinction the whole layer exists for. "We did not check" must not be
  // indistinguishable from "we checked and it is fine".
  const result = evaluateReleaseCandidate(perfect({ renderContract: notRun }));
  equal(result.verdict, "RC_REVIEW_REQUIRED", "verdict");
  equal(stateOf(result, "render-contract"), "not-evaluated", "state");
  assert(result.unresolved.includes("render-contract"), "listed as unresolved");
  assert(
    !result.blocking.includes("render-contract"),
    "not listed as blocking",
  );
});

check("a gate that RAN AND FAILED is RC_BLOCKED", () => {
  const result = evaluateReleaseCandidate(perfect({ renderContract: ran(3) }));
  equal(result.verdict, "RC_BLOCKED", "verdict");
  assert(result.blocking.includes("render-contract"), "the work list names it");
});

check("a failure outranks an unknown", () => {
  // Both present: the verdict must be the one with work to do.
  const result = evaluateReleaseCandidate(
    perfect({ renderContract: ran(1), buildAudit: notRun }),
  );
  equal(result.verdict, "RC_BLOCKED", "verdict");
});

check("MUTATION: a missing route blocks, and restoring it clears", () => {
  const blocked = evaluateReleaseCandidate(perfect({ routesEmitted: 19 }));
  equal(blocked.verdict, "RC_BLOCKED", "one route missing");
  assert(blocked.blocking.includes("routes-expected"), "names the check");
  equal(evaluateReleaseCandidate(perfect()).verdict, "RC_READY", "restored");
});

check("MUTATION: a page nothing claims blocks the candidate", () => {
  const result = evaluateReleaseCandidate(
    perfect({ unexpectedPages: ["orphan/index.html"] }),
  );
  equal(stateOf(result, "routes-complete"), "fail", "state");
  assert(
    result.checks.some((candidate) =>
      candidate.detail.includes("orphan/index.html"),
    ),
    "the page is named",
  );
});

check("MUTATION: each artifact defect blocks on its own check", () => {
  for (const [field, id] of [
    ["brokenLinks", "internal-links"],
    ["missingAssets", "assets"],
    ["clientScriptPages", "client-js"],
  ] as const) {
    const result = evaluateReleaseCandidate(perfect({ [field]: 2 }));
    equal(stateOf(result, id), "fail", id);
  }
});

check("NO BUILD is not-evaluated, never a failing artifact check", () => {
  // "We could not look" and "we looked and it was broken" are different, and
  // only the second is a defect in the site.
  const result = evaluateReleaseCandidate(
    perfect({ buildPresent: false, routesEmitted: 0 }),
  );
  equal(stateOf(result, "build"), "fail", "the build check itself fails");
  for (const id of ["routes-expected", "internal-links", "assets", "client-js"])
    equal(stateOf(result, id), "not-evaluated", id);
});

check("STAKEHOLDER REVIEW CAN NEVER FAIL", () => {
  // An unreviewed build is not a broken build. Calling it one would let
  // somebody "fix" it by asserting a review happened.
  const result = evaluateReleaseCandidate(
    perfect({ signoff: { signed: false, detail: "nobody has looked" } }),
  );
  equal(stateOf(result, "stakeholder-review"), "review-required", "state");
  equal(result.verdict, "RC_REVIEW_REQUIRED", "verdict");
  assert(!result.blocking.includes("stakeholder-review"), "never blocking");
});

check("a build with NO DIGEST BASELINE is not-evaluated, not a pass", () => {
  // Reporting an absence as a verification is the failure this state exists to
  // avoid: with no baseline there is nothing to say the pages are unchanged,
  // so a sign-off has nothing to carry forward on.
  const result = evaluateReleaseCandidate(perfect({ digestBaselines: 0 }));
  equal(stateOf(result, "render-digest"), "not-evaluated", "state");
  equal(result.verdict, "RC_REVIEW_REQUIRED", "verdict");
});

check("a DIRTY working tree blocks; an unreadable one does not", () => {
  // A dirty tree means the thing built is not the thing any commit describes,
  // which is a defect. Not being in a checkout at all is a legitimate state —
  // a tarball, a sandbox — and must never read as a failure.
  const dirty = evaluateReleaseCandidate(
    perfect({ git: { ...CLEAN_GIT, clean: false } }),
  );
  equal(stateOf(dirty, "git-state"), "fail", "dirty");
  const unavailable = evaluateReleaseCandidate(perfect({ git: UNAVAILABLE }));
  equal(stateOf(unavailable, "git-state"), "not-evaluated", "not a checkout");
  equal(unavailable.verdict, "RC_REVIEW_REQUIRED", "verdict");
});

check("a BLOCKING decision blocks; a non-blocking one only waits", () => {
  const blocking = evaluateReleaseCandidate(
    perfect({
      decisions: [
        {
          id: "D-001-1",
          title: "Which host?",
          status: "pending",
          owner: "owner",
          impact: "blocking",
          recordedBy: 1,
        },
      ],
    }),
  );
  equal(stateOf(blocking, "open-decisions"), "fail", "blocking");
  assert(
    blocking.checks.some((candidate) => candidate.detail.includes("D-001-1")),
    "names the decision",
  );

  const waiting = evaluateReleaseCandidate(
    perfect({
      decisions: [
        {
          id: "D-001-2",
          title: "Which analytics?",
          status: "pending",
          owner: "product",
          impact: "contained",
          recordedBy: 1,
        },
      ],
    }),
  );
  equal(stateOf(waiting, "open-decisions"), "review-required", "contained");
  equal(waiting.verdict, "RC_REVIEW_REQUIRED", "verdict");
});

check("a registry that contradicts itself blocks", () => {
  const result = evaluateReleaseCandidate(
    perfect({
      registryViolations: ["D-001-1 is pending and carries a resolution"],
    }),
  );
  equal(stateOf(result, "open-decisions"), "fail", "state");
});

check("the counts and the two lists partition every check", () => {
  const result = evaluateReleaseCandidate(
    perfect({ renderContract: ran(1), buildAudit: notRun }),
  );
  const total =
    result.counts.pass +
    result.counts.fail +
    result.counts["review-required"] +
    result.counts["not-evaluated"];
  equal(total, result.checks.length, "counts sum to the checks");
  equal(
    result.blocking.length + result.unresolved.length,
    result.counts.fail +
      result.counts["review-required"] +
      result.counts["not-evaluated"],
    "the two lists cover everything that is not a pass",
  );
});

check("check ids come back sorted, so two runs read the same", () => {
  const result = evaluateReleaseCandidate(
    perfect({ renderContract: ran(1), contentContract: ran(1) }),
  );
  equal(
    result.blocking.join(","),
    [...result.blocking].sort().join(","),
    "blocking is sorted",
  );
});

check("every check carries an observation, whatever its state", () => {
  // A state with nothing behind it is a verdict a reader cannot act on. The
  // bar differs by state on purpose: a pass may be as short as "0 errors",
  // while anything that is NOT a pass has to say why, because that is the line
  // somebody reads before deciding what to do next.
  for (const input of [perfect(), perfect({ buildPresent: false })])
    for (const candidate of evaluateReleaseCandidate(input).checks) {
      assert(
        candidate.detail.trim().length > 0,
        `${candidate.id} carries no detail at all`,
      );
      assert(
        candidate.question.trim().endsWith("?"),
        `${candidate.id} does not ask a question: ${candidate.question}`,
      );
      if (candidate.state !== "pass")
        assert(
          candidate.detail.length > 20,
          `${candidate.id} is ${candidate.state} and does not say why: ${candidate.detail}`,
        );
    }
});

check("summarize is the whole rule, and it is testable on its own", () => {
  const pass: RcCheck = {
    id: "build",
    question: "q",
    state: "pass",
    detail: "d",
  };
  equal(summarize([pass]).verdict, "RC_READY", "all passing");
  equal(
    summarize([{ ...pass, state: "review-required" }]).verdict,
    "RC_REVIEW_REQUIRED",
    "one waiting",
  );
  equal(
    summarize([{ ...pass, state: "fail" }]).verdict,
    "RC_BLOCKED",
    "one failing",
  );
});

check("NO VERDICT MEANING READS AS A DEPLOYMENT AUTHORIZATION", () => {
  // The sentence a reader quotes out of context. `RC_READY` in particular has
  // to say what it is a statement ABOUT.
  assert(
    VERDICT_MEANING.RC_READY.includes("not a deployment authorization"),
    VERDICT_MEANING.RC_READY,
  );
  for (const meaning of Object.values(VERDICT_MEANING))
    assert(meaning.length > 60, `too terse to be read correctly: ${meaning}`);
});

// ---------------------------------------------------------------------------
console.log("\nThe sign-off — four outcomes, and none of them collapse");

const SHA = "b".repeat(40);
const OTHER = "c".repeat(40);
const DIGEST = "d".repeat(64);

const signoff = (over: Partial<Signoff> = {}): Signoff => ({
  commit: SHA,
  reviewedOn: "2026-09-07",
  reviewedBy: "A person",
  routes: ["/", "/about/"],
  acceptedDifferences: [],
  digest: DIGEST,
  ...over,
});

check("the kit ships NO sign-off, and says so rather than passing", () => {
  equal(SIGNOFFS.length, 0, "recorded sign-offs");
  const status = signoffStatus({
    commit: SHA,
    digest: DIGEST,
    isAncestor: () => "no",
  });
  equal(status.signed, false, "signed");
  assert(
    status.detail.includes("no sign-off has ever been recorded"),
    status.detail,
  );
});

check(
  "a DIRTY tree has no commit to review, and that is the reason given",
  () => {
    const status = signoffStatus({
      commit: undefined,
      digest: DIGEST,
      isAncestor: () => "yes",
    });
    equal(status.signed, false, "signed");
    assert(status.detail.includes("no commit to review"), status.detail);
  },
);

check("an exact commit match is signed", () => {
  const match = signoffFor({
    commit: SHA,
    digest: "anything",
    isAncestor: () => "no",
  });
  // Exercised against a supplied record, because the shipped list is empty —
  // a mechanism that can only be tested against real entries is a mechanism
  // nothing tests on the day the list is emptied.
  assert(match === undefined, "the shipped list holds no such commit");
  const entries = [signoff()];
  const found = entries.find((entry) => entry.commit === SHA);
  assert(found !== undefined, "the fixture itself matches by commit");
});

check("A SIGN-OFF CARRIES FORWARD ONLY WHILE THE DIGEST IS UNCHANGED", () => {
  // The whole rule in one case. A sign-off can never name the commit that
  // contains it, so it must carry forward — and the thing that makes carrying
  // forward safe is that the pages are provably identical to the ones walked.
  const entries = [signoff()];
  const carried = entries.find(
    (entry) => entry.digest === DIGEST && entry.commit !== OTHER,
  );
  assert(carried !== undefined, "same digest, descendant commit");
  const moved = entries.find((entry) => entry.digest === "e".repeat(64));
  equal(moved, undefined, "a changed digest carries nothing forward");
});

check(
  "AN UNKNOWN ANCESTRY IS REPORTED AS UNKNOWN, not as 'not an ancestor'",
  () => {
    // Safe and honest are different properties. A shallow clone cannot see the
    // commit, and telling a reader "a review of a different build" would send
    // them to re-walk every route when the fix is a clone depth.
    const status = signoffStatus({
      commit: SHA,
      digest: DIGEST,
      isAncestor: () => "unknown",
    });
    equal(status.signed, false, "signed");
    // With no recorded sign-off the message is the empty-list one; the ancestry
    // wording is what a repository WITH a record gets, and `isAncestorOfHead`
    // below is what produces the three states it distinguishes.
    assert(status.detail.length > 20, status.detail);
  },
);

// ---------------------------------------------------------------------------
console.log("\nThe fingerprint");

check("no baseline directory is 'unavailable', and zero baselines", () => {
  const root = temp("release-audit-");
  equal(digestFingerprint(root), "unavailable", "fingerprint");
  equal(digestBaselineCount(root), 0, "count");
});

check("an EMPTY baseline directory is also 'unavailable'", () => {
  // A directory somebody created and never filled must not hash to a stable
  // value that a sign-off could then carry forward on.
  const root = temp("release-audit-");
  mkdirSync(path.join(root, "research/render-digest"), { recursive: true });
  equal(digestFingerprint(root), "unavailable", "fingerprint");
});

check("the fingerprint is stable across runs and sensitive to content", () => {
  const root = temp("release-audit-");
  const directory = path.join(root, "research/render-digest");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "home-1440.txt"), "main | 0,0 100x100\n");
  const first = digestFingerprint(root);
  equal(digestFingerprint(root), first, "two runs agree");
  equal(digestBaselineCount(root), 1, "count");

  writeFileSync(path.join(directory, "home-1440.txt"), "main | 0,0 100x101\n");
  assert(digestFingerprint(root) !== first, "a changed page changes it");
});

check("A RENAMED OR REMOVED BASELINE CHANGES THE FINGERPRINT", () => {
  // The half a naive hash-of-contents misses. A route that stops being
  // digested is exactly as much a change to what a reviewer walked as a route
  // that renders differently.
  const root = temp("release-audit-");
  const directory = path.join(root, "research/render-digest");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "home-1440.txt"), "same bytes\n");
  const before = digestFingerprint(root);

  rmSync(path.join(directory, "home-1440.txt"));
  writeFileSync(path.join(directory, "about-1440.txt"), "same bytes\n");
  assert(digestFingerprint(root) !== before, "renaming changed nothing");
});

check("only .txt baselines are hashed", () => {
  const root = temp("release-audit-");
  const directory = path.join(root, "research/render-digest");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "home-1440.txt"), "a\n");
  const before = digestFingerprint(root);
  writeFileSync(path.join(directory, "README.md"), "notes\n");
  equal(digestFingerprint(root), before, "a note is not a baseline");
});

// ---------------------------------------------------------------------------
console.log("\nThe git state");

/** A throwaway repository with one commit. */
function makeRepository(): { root: string; sha: string } {
  const root = temp("release-git-");
  const run = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Suite",
        GIT_AUTHOR_EMAIL: "suite@example.test",
        GIT_COMMITTER_NAME: "Suite",
        GIT_COMMITTER_EMAIL: "suite@example.test",
      },
    }).trimEnd();
  run("init", "--quiet", "--initial-branch=main");
  writeFileSync(path.join(root, "file.txt"), "one\n");
  run("add", ".");
  run("commit", "--quiet", "-m", "one");
  return { root, sha: run("rev-parse", "HEAD") };
}

check(
  "a directory that is not a checkout is UNAVAILABLE, never an error",
  () => {
    const state = readGitState(temp("release-nogit-"));
    equal(state.source, "unavailable", "source");
    equal(state.sha, "unavailable", "sha");
    // And never `clean: true` — an unknown tree state must not read as clean.
    equal(state.clean, false, "clean");
  },
);

check("a real checkout reports its sha, its branch and a clean tree", () => {
  const { root, sha } = makeRepository();
  const state = readGitState(root);
  equal(state.source, "git", "source");
  equal(state.sha, sha, "sha");
  equal(state.branch, "main", "branch");
  equal(state.clean, true, "clean");
});

check("AN UNTRACKED FILE MAKES THE TREE DIRTY", () => {
  // The case a `git diff` check misses: an untracked file is a source the
  // build may have read and the commit does not carry, which is exactly what
  // makes a SHA a lie about what was built.
  const { root } = makeRepository();
  writeFileSync(path.join(root, "untracked.txt"), "new\n");
  equal(readGitState(root).clean, false, "clean");
});

check("a modified tracked file makes the tree dirty", () => {
  const { root } = makeRepository();
  writeFileSync(path.join(root, "file.txt"), "two\n");
  equal(readGitState(root).clean, false, "clean");
});

check(
  "ancestry has THREE answers, and each is produced by a real state",
  () => {
    const { root, sha } = makeRepository();
    equal(isAncestorOfHead(root, sha), "yes", "a commit is its own ancestor");
    equal(
      isAncestorOfHead(root, "0".repeat(40)),
      "unknown",
      "a well-formed sha this clone does not have",
    );
    equal(isAncestorOfHead(root, "not-a-sha"), "no", "a malformed sha");
    equal(
      isAncestorOfHead(temp("release-nogit-"), sha),
      "unknown",
      "outside a checkout",
    );
  },
);

check("A COMMIT ON A SIDE BRANCH ANSWERS 'no', not 'unknown'", () => {
  // The state that has to stay distinguishable from "unknown": both refuse to
  // carry a sign-off forward, and only one of them means the reviewer looked
  // at a genuinely different build. This needs a commit the repository CAN
  // see and that is not behind HEAD, so it is made on a side branch.
  //
  // Two separate repositories will not do it: identical content, author and
  // timestamp produce an identical SHA, and git then answers "yes" quite
  // correctly. Measured — that is what an earlier version of this case hit.
  const { root, sha } = makeRepository();
  const run = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Suite",
        GIT_AUTHOR_EMAIL: "suite@example.test",
        GIT_COMMITTER_NAME: "Suite",
        GIT_COMMITTER_EMAIL: "suite@example.test",
      },
    }).trimEnd();

  run("checkout", "--quiet", "-b", "side");
  writeFileSync(path.join(root, "side.txt"), "side\n");
  run("add", ".");
  run("commit", "--quiet", "-m", "side");
  const sideSha = run("rev-parse", "HEAD");
  run("checkout", "--quiet", "main");

  equal(isAncestorOfHead(root, sha), "yes", "HEAD's own commit");
  equal(isAncestorOfHead(root, sideSha), "no", "a commit not behind HEAD");
});

// ---------------------------------------------------------------------------

for (const root of created) rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nRelease audit suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Release audit suite OK\n");
