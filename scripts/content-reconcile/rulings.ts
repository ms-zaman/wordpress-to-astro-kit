// Why a string one page paints and the other does not.
//
// `surface.ts` asks the question; this answers it. Anything the source site
// paints that your build does not say, and anything your build says that the
// source has no trace of, needs a row here or `pnpm content:reconcile` fails.
//
// That is the whole point. In the project this kit came from, a plan bar
// shipped with two tabs where the source had three. Fourteen gates passed it
// and a person caught it — and an eye does not scale to 400 URLs.
//
// ## A ruling is a claim about evidence
//
// Each row says what was looked at and what it said. A `reworded` row MUST
// name what you say instead: a row that only says "we say it differently" is a
// row that hides a defect.
//
// ## "Hidden" is not a verdict here
//
// Whether the source paints a string at any width is derived from its own
// markup, per element, by ancestry (`surface.ts`). It needs no human claim and
// cannot go stale. If the source un-hides something, the reconciler sees a
// painted string with no ruling and fails — which is correct.
//
// ## Scope
//
// A key may be global, or scoped to one route as `"/pricing:the string"`.
// Route scope exists because one string can mean different things on different
// pages: a plan description on a pricing page can be the heading of a shared
// feature list elsewhere. A flat map can only rule a string everywhere, so the
// first page to start painting it reports the others CONTRADICTED.
//
// Route-scoped wins; global is the fallback.

/** Why a string is not matched on the other side. */
export type Verdict =
  /** You say the same thing in different words. `why` MUST name yours. */
  | "reworded"
  /** Deliberately not built, with the decision that says so. */
  | "declined"
  /** A known difference, recorded and deliberately open. */
  | "recorded"
  /** Yours, and the source has none — a commitment this project made. */
  | "ours";

export interface Ruling {
  readonly verdict: Verdict;
  /** What was looked at, and what it said. Evidence first. */
  readonly why: string;
}

/**
 * The rulings, by key.
 *
 * **Empty, and that is the starting state.** Every row you add is a difference
 * between your site and the one you are migrating that somebody decided was
 * correct. A row with a vague `why` is worse than no row: it silences a
 * finding without recording anything a later reader can check.
 */
export const RULINGS: ReadonlyMap<string, Ruling> = new Map<string, Ruling>([
  // ["/pricing:enterprise", {
  //   verdict: "reworded",
  //   why: "Live's third plan tab reads `Enterprise`; this build labels it " +
  //     "`Enterprise plan` so the tab list reads as a set. Measured on the " +
  //     "2026-09-07 crawl of /pricing.",
  // }],
]);

/** Every ruling that applies to a key on a route, most specific first. */
export function rulingFor(
  route: string,
  key: string,
): { key: string; ruling: Ruling } | undefined {
  const scoped = `${route}:${key}`;
  const scopedRuling = RULINGS.get(scoped);
  if (scopedRuling !== undefined) return { key: scoped, ruling: scopedRuling };
  const global = RULINGS.get(key);
  return global === undefined ? undefined : { key, ruling: global };
}

/** Ways the ruling table can be wrong about itself. */
export function rulingViolations(
  rulings: ReadonlyMap<string, Ruling> = RULINGS,
): string[] {
  const violations: string[] = [];
  for (const [key, ruling] of rulings) {
    if (ruling.why.trim().length < 40)
      violations.push(
        `${key}: the reason is ${ruling.why.trim().length} characters. A ruling ` +
          "is a claim about evidence — say what was looked at and what it said.",
      );
    if (
      ruling.verdict === "reworded" &&
      !/\b(reads|says|labels|calls|renders)\b/i.test(ruling.why)
    )
      violations.push(
        `${key}: a "reworded" ruling must name what THIS build says instead. ` +
          'A row that only says "we say it differently" hides a defect.',
      );
  }
  return violations;
}
