# `release-audit`

The layer between "the build works" and "a person may look at it".

```
pnpm release:review     # build, then evaluate
pnpm release:rc         # …and run the contract suites too
pnpm release:audit-test # the suite
```

It answers one question about a build that already exists, and refuses to answer
a second.

| Question                           |                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Is this build a release candidate? | `RC_READY` / `RC_REVIEW_REQUIRED` / `RC_BLOCKED`                                                                    |
| **May it be deployed?**            | **Not answered here, and never will be.** Hosting, environment and repository policy are not properties of a build. |

## Three states, not a boolean

A build has three genuinely different ways of not being a candidate:

| Verdict              | Means                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `RC_READY`           | Every check that can run, ran and passed; every check that needs a person, has one. A statement about the **build**.    |
| `RC_REVIEW_REQUIRED` | Nothing is known to be wrong and something is unknown — a gate did not run, or a person has not looked. Nothing to fix. |
| `RC_BLOCKED`         | At least one check failed. The failing ids are the work list.                                                           |

A boolean makes "we did not check" indistinguishable from "we checked and it is
fine", which is the failure this whole layer is written against.

Two checks can never `fail`. **`stakeholder-review`** stays `review-required`,
because an unreviewed build is not a broken build and calling it one would let
somebody "fix" it by asserting a review happened. **`render-digest`** reports
`not-evaluated` when no baseline exists, because reporting an absence as a
verification is the same error one level down.

## The contract suites are opt-in, and the default is the honest one

`pnpm content`, `pnpm render` and the build audit are separate processes that
call `process.exit`; they cannot be imported. By default they are reported
`not-evaluated` — a statement that this run did not execute them — and
`--with-gates` spawns them and records their exit codes.

A report that quietly claimed a suite passed because it usually does is exactly
what the three states exist to prevent.

## The sign-off

`apps/website/src/release/signoff.ts` is the one release check no automated
thing may decide. A sign-off names the commit that was reviewed, and it carries
forward to a descendant commit **for exactly as long as the render digest is
unchanged** — the digest being the fingerprint of what every route looks like,
which is the same scope a reviewer walked.

Three readers make that rule work, and none of them lives in `signoff.ts`
(which is pure and reads nothing):

- `digest-fingerprint.ts` hashes `research/render-digest/`. A **renamed or
  removed** baseline changes the fingerprint too: a route that stops being
  digested is as much a change to what a reviewer walked as one that renders
  differently.
- `git-state.ts` reads the commit, the branch, and whether the tree is clean.
  `clean` counts **untracked** files: an untracked file is a source the build
  may have read and the commit does not carry.
- `isAncestorOfHead` answers in **three** states. It was a boolean, and a
  shallow clone that could not see the commit answered `false` — safe, and
  false. The refusal was right and the reason given was wrong, and a reader
  acting on it would have re-walked every route to fix a clone depth.

## Exit codes

| Condition                                              | Exit |
| ------------------------------------------------------ | ---- |
| `RC_BLOCKED`                                           | 1    |
| `--require-rc-ready` and the verdict is not `RC_READY` | 1    |
| Anything else, including `RC_REVIEW_REQUIRED`          | 0    |

`RC_REVIEW_REQUIRED` exits 0 on purpose: it is the correct state of most builds,
and a command that fails when it reports the truth is a command nobody runs.

## What it cannot do, by construction

- **It cannot record a sign-off or resolve a decision.** There is no code path
  here that writes to `apps/website/src/`. Both are a person's, by editing the
  file.
- **It cannot deploy, and it does not know how.** No adapter, no provider, no
  host, no environment.
