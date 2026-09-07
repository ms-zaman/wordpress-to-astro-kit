// The accessibility audit, composed.
//
// One function over a build output. It runs the checks, resolves each finding
// against the known baseline, and reports the counts — because a run that
// prints only "OK" tells an operator nothing about whether it looked at
// nineteen pages or at none, which is how a vacuous pass survives for a month.
//
// Deliberately NOT a general-purpose accessibility framework. It knows this
// kit's layouts, its component classes and its token names, and it is worth
// much more for knowing them. What it cannot answer — focus ORDER, live
// regions, target size, reflow at 400% zoom, and which ground an element is
// actually painted on — needs a browser, and `scripts/contrast-audit` and
// `scripts/browser-tests` are the two halves that have one.
import { pageFamilies } from "../lib/manifest.ts";
import { KNOWN_BASELINE, type BaselineEntry } from "./baseline.ts";
import { error, sortFindings, warning, type Finding } from "./finding.ts";
import {
  contrastReport,
  CONTRAST_PAIRS,
  parsePalette,
  type Palette,
} from "./model.ts";
import { isReviewOnly, readPages, type Page } from "./pages.ts";
import {
  checkFocus,
  checkFocusSystemRule,
  checkHeadings,
  checkLandmarks,
  checkListSemantics,
  checkNavigation,
  checkSectionNaming,
  checkSkipTarget,
  routeToFile,
} from "./rules.ts";

export interface AuditCounts {
  readonly pages: number;
  readonly productionPages: number;
  readonly reviewPages: number;
  readonly headings: number;
  readonly interactiveElements: number;
  readonly navLandmarks: number;
  /** Colour tokens read out of the CSS the build actually shipped. */
  readonly paletteTokens: number;
  readonly contrastPairs: number;
}

export interface AuditResult {
  readonly root: string;
  readonly findings: readonly Finding[];
  readonly counts: AuditCounts;
  /** True when nothing at `error` severity was found. */
  readonly ok: boolean;
}

/**
 * The palette the build SHIPPED, not the one the source declares.
 *
 * Read from the emitted CSS, because that is the stylesheet a browser applies
 * and because a minifier rewrites values on the way — see `NAMED_COLOURS` in
 * `model.ts` for the token that vanished out of an audit entirely when it was
 * shipped as `snow` and read by a hex-only parser.
 */
export function shippedPalette(pages: readonly Page[]): Palette {
  return parsePalette(pages.map((page) => page.css).join("\n"));
}

/**
 * Every contrast pair the components composite, measured against the shipped
 * palette.
 *
 * A pair naming a token the build does not ship is its OWN finding rather than
 * a thrown error: a renamed token must be reported next to everything else a
 * reader has to fix, not stop the run before the other checks have spoken.
 */
export function checkTokenContrast(pages: readonly Page[]): Finding[] {
  let palette: Palette;
  try {
    palette = shippedPalette(pages);
  } catch (cause) {
    return [
      error(
        "contrast",
        "",
        "unreadable-palette",
        `the shipped stylesheet holds a --color- token this cannot read: ${(cause as Error).message}`,
      ),
    ];
  }

  if (Object.keys(palette).length === 0)
    return [
      warning(
        "contrast",
        "",
        "no-palette",
        "no --color- token was found in the CSS this build shipped, so no pair " +
          "was measured — the contrast half of this audit ran vacuously",
      ),
    ];

  const findings: Finding[] = [];
  const measurable = CONTRAST_PAIRS.filter((pair) => {
    const missing = [pair.foreground, pair.background].filter(
      (token) => palette[token] === undefined,
    );
    if (missing.length === 0) return true;
    findings.push(
      error(
        "contrast",
        "",
        `missing-token:${pair.id}`,
        `the pair "${pair.id}" names ${missing.map((token) => `--color-${token}`).join(" and ")}, which this build does not ship — a renamed token silently drops its pair out of the audit`,
      ),
    );
    return false;
  });

  for (const result of contrastReport(palette, measurable)) {
    if (result.passes) continue;
    const pair = CONTRAST_PAIRS.find(
      (candidate) => candidate.id === result.id,
    )!;
    findings.push(
      error(
        "contrast",
        "",
        result.id,
        `--color-${result.foreground} on --color-${result.background} is ` +
          `${result.ratio}:1 and needs ${result.threshold}:1 — ${pair.where}`,
      ),
    );
  }
  return findings;
}

/**
 * Findings, with baselined ones reclassified and stale baselines reported.
 *
 * Both directions, and the second is what makes a baseline safe:
 *
 *   - a finding whose id is in the baseline becomes `baseline` severity and
 *     stops failing the run;
 *   - **a baseline id the audit did not produce becomes an `error`** — the
 *     defect was fixed, or moved, or renamed, and the record no longer
 *     describes the build.
 */
export interface BaselineOptions {
  /**
   * The baseline to resolve against. Defaults to `KNOWN_BASELINE`, which is
   * what every caller outside the test suite wants.
   *
   * A parameter for one reason: `KNOWN_BASELINE` ships EMPTY, and a mechanism
   * that can only be exercised against real entries is a mechanism nothing
   * tests on the day the last entry is fixed. The suite passes its own list
   * and proves both directions still work.
   */
  readonly baseline?: readonly BaselineEntry[];
  /**
   * Report a baseline entry this build did not produce as a stale `error`.
   *
   * True for the real build, which is the only output `baseline.ts` describes.
   * False when auditing an ARBITRARY directory — a synthetic fixture does not
   * contain this repository's components, so every entry would read as stale
   * and the run would fail for a reason that says nothing about the directory
   * being audited.
   *
   * Defaulted to true so that forgetting it fails loudly rather than quietly
   * disabling the half of the mechanism that has teeth.
   */
  readonly reportStale?: boolean;
}

export function applyBaseline(
  findings: readonly Finding[],
  { reportStale = true, baseline = KNOWN_BASELINE }: BaselineOptions = {},
): Finding[] {
  const entries = new Map(baseline.map((entry) => [entry.id, entry]));
  const seen = new Set(findings.map((finding) => finding.id));
  const resolved: Finding[] = findings.map((finding) => {
    const entry = entries.get(finding.id);
    if (finding.severity !== "error" || entry === undefined) return finding;
    return {
      ...finding,
      severity: "baseline" as const,
      decision: entry.decision,
      detail: `${finding.detail} [known: ${entry.decision}]`,
    };
  });

  if (!reportStale) return resolved;

  for (const entry of baseline) {
    if (seen.has(entry.id)) continue;
    const [check, at, key] = entry.id.split("|");
    resolved.push(
      error(
        check as Finding["check"],
        at ?? "",
        `stale:${key}`,
        `the baseline records "${key}" as a known open defect (${entry.decision}) ` +
          "and this build does not produce it — the defect was fixed, moved or " +
          "renamed, and baseline.ts no longer describes the build",
      ),
    );
  }
  return resolved;
}

function countOf(pages: readonly Page[]): AuditCounts {
  let headings = 0;
  let interactiveElements = 0;
  let navLandmarks = 0;
  for (const page of pages) {
    headings += (page.html.match(/<h[1-6][\s>]/g) ?? []).length;
    interactiveElements += (
      page.html.match(/<(a\b[^>]*\shref=|button\b|summary\b)/g) ?? []
    ).length;
    navLandmarks += (page.html.match(/<nav\b/g) ?? []).length;
  }
  let paletteTokens = 0;
  try {
    paletteTokens = Object.keys(shippedPalette(pages)).length;
  } catch {
    /* reported as a finding by checkTokenContrast */
  }
  return {
    pages: pages.length,
    productionPages: pages.filter((page) => !isReviewOnly(page.file)).length,
    reviewPages: pages.filter((page) => isReviewOnly(page.file)).length,
    headings,
    interactiveElements,
    navLandmarks,
    paletteTokens,
    contrastPairs: CONTRAST_PAIRS.length,
  };
}

/**
 * Audit a build output. Throws only when there is nothing to audit.
 *
 * `reportStale` defaults to true: the baseline describes THIS repository's
 * build, and an entry that build stops producing is a record that no longer
 * matches reality. Pass `false` only when auditing a directory the baseline
 * was never written about — the synthetic fixtures in the suite do.
 */
export function auditAccessibility(
  root: string,
  options: BaselineOptions = {},
): AuditResult {
  const pages = readPages(root);
  const emitted = new Set(pages.map((page) => page.file));

  const findings = applyBaseline(
    [
      ...checkTokenContrast(pages),
      ...checkHeadings(pages),
      ...checkLandmarks(pages, pageFamilies(root)),
      ...checkListSemantics(pages),
      ...checkFocusSystemRule(pages),
      ...checkFocus(pages),
      ...checkSectionNaming(pages),
      ...checkSkipTarget(pages),
      ...checkNavigation(pages, emitted),
    ],
    options,
  );

  return {
    root,
    findings: sortFindings(findings),
    counts: countOf(pages),
    ok: !findings.some((finding) => finding.severity === "error"),
  };
}

export { routeToFile };
