// The recorded human pass on a build.
//
// The one release check no automated thing may decide is "a person walked the
// pages". It is a tracked record naming the commit it was performed against,
// and it is checked against what this build measures rather than against
// what somebody typed — so a sign-off for an unrelated commit does not pass.
//
// Who edits this: a person, or an agent on a person's explicit word — and
// only after actually walking the review map. Writing a SHA in here without
// doing that is falsifying a record, not passing a gate. "Go ahead" is
// permission to proceed, not a statement that the person looked; record the
// name of whoever LOOKED.
//
// A sign-off can never name the commit that contains it, so the rule is: a
// sign-off carries forward to a descendant commit for exactly as long as the
// render digest is unchanged. The digest is the fingerprint of what every
// route looks like — the same scope a reviewer walked — so the check is exact.

export interface Signoff {
  /** The full 40-character commit SHA that was reviewed. */
  readonly commit: string;
  /** ISO 8601 date the review was performed. */
  readonly reviewedOn: string;
  /** Who performed it. A name, not a role. */
  readonly reviewedBy: string;
  /** The routes walked, as published paths. */
  readonly routes: readonly string[];
  /** Anything seen and accepted anyway. Empty is a real answer. */
  readonly acceptedDifferences: readonly string[];
  /** The render digest's fingerprint when the walk was performed. */
  readonly digest: string;
}

/** Ancestry, in three values: a shallow clone cannot answer, and says so. */
export type Ancestry = "yes" | "no" | "unknown";

export interface BuildIdentity {
  /** The build's commit, or `undefined` when the tree is dirty or not a checkout. */
  readonly commit: string | undefined;
  /** This tree's render-digest fingerprint. */
  readonly digest: string;
  readonly isAncestor: (sha: string) => Ancestry;
}

/** The sign-offs on record, newest first. Empty until a person walks the site. */
export const SIGNOFFS: readonly Signoff[] = [];

/** The sign-off that applies to a build, if one does. */
export function signoffFor(build: BuildIdentity): Signoff | undefined {
  if (build.commit === undefined || build.commit === "") return undefined;
  const exact = SIGNOFFS.find((entry) => entry.commit === build.commit);
  if (exact !== undefined) return exact;
  return SIGNOFFS.find(
    (entry) =>
      entry.digest === build.digest && build.isAncestor(entry.commit) === "yes",
  );
}

export interface SignoffStatus {
  readonly signed: boolean;
  readonly detail: string;
}

/** Why a build is not signed off, in words a reader can act on. */
export function signoffStatus(build: BuildIdentity): SignoffStatus {
  if (build.commit === undefined || build.commit === "")
    return {
      signed: false,
      detail:
        "no commit to review — the working tree does not correspond to one, " +
        "so nothing could have been reviewed",
    };

  const match = signoffFor(build);
  if (match !== undefined) {
    const carried = match.commit !== build.commit;
    return {
      signed: true,
      detail:
        `reviewed by ${match.reviewedBy} on ${match.reviewedOn}, ` +
        `${match.routes.length} route(s) walked` +
        (match.acceptedDifferences.length > 0
          ? `, ${match.acceptedDifferences.length} difference(s) accepted`
          : "") +
        (carried
          ? ` — recorded against ${match.commit.slice(0, 7)}, an ancestor, ` +
            "and every route still renders exactly as it did then"
          : ""),
    };
  }

  if (SIGNOFFS.length === 0)
    return {
      signed: false,
      detail:
        "no sign-off has ever been recorded — see apps/website/src/release/signoff.ts",
    };

  const ancestors = SIGNOFFS.filter(
    (entry) => build.isAncestor(entry.commit) === "yes",
  );
  if (ancestors.length > 0)
    return {
      signed: false,
      detail:
        `the newest sign-off (${ancestors[0]!.commit.slice(0, 7)}, an ancestor) ` +
        "was recorded against a different render digest — at least one route " +
        "renders differently now. Walk the routes again and record a new one",
    };

  const unreadable = SIGNOFFS.filter(
    (entry) => build.isAncestor(entry.commit) === "unknown",
  );
  if (unreadable.length > 0)
    return {
      signed: false,
      detail:
        `this checkout cannot tell whether the recorded sign-off ` +
        `(${unreadable[0]!.commit.slice(0, 7)}) is an ancestor of ` +
        `${build.commit.slice(0, 7)} — which is what a shallow clone looks like. ` +
        "Fetch the history and evaluate it again",
    };

  return {
    signed: false,
    detail:
      `the recorded sign-off is for ${SIGNOFFS[0]!.commit.slice(0, 7)}, which is ` +
      `not an ancestor of ${build.commit.slice(0, 7)} — a review of a different ` +
      "build is not a review of this one",
  };
}
