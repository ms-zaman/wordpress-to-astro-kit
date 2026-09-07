// Content reconciliation: does your page say what the source page says?
//
// Pure. Surfaces in, findings out — no filesystem and no network, so the whole
// judgement is testable by handing it two strings.
//
// Four ways to fail, each a different mistake:
//
//   UNPAINTED     the source paints it, you never say it, nobody said why.
//                 The defect this exists for: a missing plan tab is exactly
//                 one absent label.
//   INVENTED      you paint it and the source has no trace of it. Copy nobody
//                 approved.
//   STALE         a ruling for a string neither page paints any more.
//   CONTRADICTED  a ruling for a string that IS matched. One of the two is
//                 wrong and there is no way to tell which from here.
//
// The comparison is deliberately asymmetric: a page's headings and labels are
// looked for in the OTHER page's whole text. `surface.ts` says why comparing
// markup to markup does not work.
import { rulingFor, RULINGS, type Ruling } from "./rulings.ts";
import { says, type Asked, type Surface } from "./surface.ts";

export type ProblemKind = "unpainted" | "invented" | "stale" | "contradicted";

export interface Problem {
  readonly kind: ProblemKind;
  readonly route: string;
  readonly key: string;
  readonly detail: string;
}

export interface RouteReport {
  readonly route: string;
  /** Strings the source paints, and you say. */
  readonly matched: number;
  /** Strings the source paints that you do not, each with a ruling. */
  readonly ruled: number;
  /** Strings you paint that the source does not, each with a ruling. */
  readonly oursRuled: number;
  readonly liveAsked: number;
  readonly oursAsked: number;
}

export interface Reconciliation {
  readonly routes: readonly RouteReport[];
  readonly problems: readonly Problem[];
  /** Ruling keys that were used, so a caller can find the ones that were not. */
  readonly used: ReadonlySet<string>;
}

/** One route's two documents, already read into surfaces. */
export interface RoutePairSurfaces {
  readonly route: string;
  readonly live: Surface;
  readonly ours: Surface;
}

export interface ReconcileOptions {
  /**
   * Report a ruling no route needed as `stale`.
   *
   * True for a full run over every configured pair, which is the only time
   * "no route needed it" means anything. False when reconciling a SUBSET —
   * every ruling for the routes you left out would otherwise read as stale.
   */
  readonly reportStale?: boolean;
  readonly rulings?: ReadonlyMap<string, Ruling>;
}

/**
 * Reconcile a set of route pairs.
 *
 * Total: every asked string on either side produces a match, a ruling, or a
 * problem. A string that fell out would be content nobody had to account for.
 */
export function reconcile(
  pairs: readonly RoutePairSurfaces[],
  options: ReconcileOptions = {},
): Reconciliation {
  const rulings = options.rulings ?? RULINGS;
  const routes: RouteReport[] = [];
  const problems: Problem[] = [];
  const used = new Set<string>();

  for (const pair of pairs) {
    let matched = 0;
    let ruled = 0;
    let oursRuled = 0;
    // A contradiction is a fact about a (route, string, ruling) triple, and
    // both directions meet it: a string both pages paint is asked on each
    // side. Reporting it twice would make one wrong ruling read as two.
    const contradictionsReported = new Set<string>();

    const account = (
      asked: Map<string, Asked>,
      corpus: string,
      kind: "unpainted" | "invented",
      onRuled: () => void,
    ): void => {
      for (const [key, entry] of asked) {
        const said = says(corpus, key);
        const found =
          options.rulings === undefined
            ? rulingFor(pair.route, key)
            : rulingLookup(rulings, pair.route, key);
        if (found !== undefined) used.add(found.key);

        if (said && found !== undefined && !contradictionsReported.has(key)) {
          contradictionsReported.add(key);
          problems.push({
            kind: "contradicted",
            route: pair.route,
            key,
            detail: `matched on both pages AND ruled "${found.ruling.verdict}" — one of the two is wrong`,
          });
        }

        if (said) {
          if (kind === "unpainted") matched += 1;
          continue;
        }
        if (found !== undefined) {
          onRuled();
          continue;
        }
        problems.push({
          kind,
          route: pair.route,
          key,
          detail:
            kind === "unpainted"
              ? `the source paints it (${entry.kind}); this build never says it`
              : `this build paints it (${entry.kind}); the source never says it`,
        });
      }
    };

    account(pair.live.asked, pair.ours.said, "unpainted", () => {
      ruled += 1;
    });
    account(pair.ours.asked, pair.live.said, "invented", () => {
      oursRuled += 1;
    });

    routes.push({
      route: pair.route,
      matched,
      ruled,
      oursRuled,
      liveAsked: pair.live.asked.size,
      oursAsked: pair.ours.asked.size,
    });
  }

  // A ruling no route needed is a ruling describing a page that has moved.
  if (options.reportStale !== false)
    for (const key of rulings.keys())
      if (!used.has(key))
        problems.push({
          kind: "stale",
          route: "—",
          key,
          detail:
            "ruled on, but neither page paints it on any reconciled route — the " +
            "page moved and the record did not",
        });

  return { routes, problems, used };
}

/** The same precedence `rulingFor` uses, over a supplied table. */
function rulingLookup(
  rulings: ReadonlyMap<string, Ruling>,
  route: string,
  key: string,
): { key: string; ruling: Ruling } | undefined {
  const scoped = `${route}:${key}`;
  const scopedRuling = rulings.get(scoped);
  if (scopedRuling !== undefined) return { key: scoped, ruling: scopedRuling };
  const global = rulings.get(key);
  return global === undefined ? undefined : { key, ruling: global };
}

/** Findings of one kind, for a report. */
export const problemsOfKind = (
  problems: readonly Problem[],
  kind: ProblemKind,
): Problem[] => problems.filter((problem) => problem.kind === kind);
