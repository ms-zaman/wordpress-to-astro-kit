// Reading the git state.
//
// A review is worth nothing if a reviewer's feedback cannot be tied to the
// build they saw. That tie is a commit SHA, and this is the only module that
// reads one.
//
// ## Three properties, each deliberate
//
// **It never throws.** Not being in a git checkout is a legitimate state — a
// released tarball, a CI runner with a shallow copy, a sandbox. So an
// unreadable repository returns `source: "unavailable"` and the evaluation
// records "not evaluated" rather than "failed". A guard that cannot run
// outside a checkout is a guard nobody runs on the artifact that matters.
//
// **It reads and never writes.** Three read-only plumbing calls. Nothing here
// commits, stages, fetches or checks anything out.
//
// **`clean` counts every uncommitted change, tracked and untracked.** An
// untracked file is a source the build may have read and the commit does not
// carry, which is exactly the condition that makes a SHA a lie about what was
// built.
import { spawnSync } from "node:child_process";

import type { GitState } from "../../apps/website/src/release/release-candidate.ts";
import type { Ancestry } from "../../apps/website/src/release/signoff.ts";

/** What an unreadable repository reports. Never an error. */
export const UNAVAILABLE: GitState = {
  sha: "unavailable",
  branch: "unavailable",
  clean: false,
  source: "unavailable",
};

/** Run one git command, or return `undefined`. Never throws. */
function git(cwd: string, args: readonly string[]): string | undefined {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    // A prompt would hang a non-interactive audit forever.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error !== undefined || result.status !== 0) return undefined;
  return result.stdout.trimEnd();
}

/**
 * Whether `sha` is an ancestor of `HEAD`.
 *
 * `merge-base --is-ancestor` answers with its exit status and prints nothing.
 * A commit is its own ancestor by git's definition, which is what the sign-off
 * rule wants: the exact-match case and the carried-forward case then need no
 * special handling between them.
 *
 * ## Why this is not a boolean
 *
 * It was one, and a checkout that could not see the commit answered `false` —
 * the safe reading, which it is: an unknown relationship must never carry a
 * sign-off forward.
 *
 * Safe and honest are different properties. `actions/checkout` clones at depth
 * 1, so on the first CI run after this rule landed, a recorded sign-off that
 * WAS a real ancestor was reported as "not an ancestor of". The refusal was
 * right and the reason given was false, and a reader acting on it would have
 * re-walked every route to fix a clone depth.
 *
 * So the three states git actually distinguishes are kept. `0` and `1` are
 * documented answers. Anything else — `128` for an object this checkout does
 * not have, a spawn that failed, no git at all — is a question that went
 * unanswered, and the caller is told that rather than told "no".
 *
 * A malformed SHA is `"no"` and not `"unknown"`: no depth of history makes a
 * string that is not a commit into one.
 */
export function isAncestorOfHead(cwd: string, sha: string): Ancestry {
  if (!/^[0-9a-f]{40}$/.test(sha)) return "no";
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", sha, "HEAD"],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
  );
  if (result.error !== undefined) return "unknown";
  if (result.status === 0) return "yes";
  if (result.status === 1) return "no";
  return "unknown";
}

/**
 * The git state at `cwd`, or `UNAVAILABLE`.
 *
 * A detached HEAD reports its branch as `"HEAD"`, which is what git itself
 * says and is more honest than inventing a name for a state that has none.
 */
export function readGitState(cwd: string): GitState {
  const sha = git(cwd, ["rev-parse", "HEAD"]);
  if (sha === undefined || !/^[0-9a-f]{40}$/.test(sha)) return UNAVAILABLE;

  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "HEAD";
  // `--porcelain` output is empty exactly when nothing is modified, staged or
  // untracked. `undefined` (git failed) is treated as DIRTY: an unknown tree
  // state must never read as clean.
  const status = git(cwd, ["status", "--porcelain"]);

  return {
    sha,
    branch: branch === "" ? "HEAD" : branch,
    clean: status === "",
    source: "git",
  };
}
