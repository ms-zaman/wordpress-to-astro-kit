// Layout audit — horizontal overflow, in a real rendering engine.
//
// ## Why it needs a browser
//
// Horizontal overflow is not visible in the HTML. It is a property of computed
// styles, text metrics and the viewport, and the only thing that knows all
// three is a rendering engine. `render-contract/build-audit.ts` parses markup,
// which is why it structurally cannot check this and does not try.
//
// Fonts are awaited before measuring (`document.fonts.ready`). A webfont with
// different metrics from its fallback is exactly the kind of change that
// introduces overflow, so measuring before it loads would measure the wrong
// page — which is how this check would miss the defect it exists for.
//
// Zero new dependencies: `scripts/lib/cdp.ts` drives a Chrome already on the
// machine.
import { launch } from "../lib/cdp.ts";
import { routesIn } from "../lib/routes.ts";
import { serveStatic } from "../lib/serve.ts";
import { KNOWN_LAYOUT_BASELINE } from "./baseline.ts";
import { baseline, error, idOf, warning, type Finding } from "./finding.ts";

/**
 * The widths measured.
 *
 * The two narrow ones are where overflow actually happens; the wide ones are
 * where a container cap is exercised. 1440 and 1920 both matter because a cap
 * that is wrong shows up only above it.
 */
export const VIEWPORTS: readonly number[] = [
  320, 375, 768, 1024, 1440, 1920,
] as const;

/** One measured page at one width. */
export interface Measurement {
  readonly route: string;
  readonly viewport: number;
  readonly scrollWidth: number;
  /** The widest offending elements, for a reader who has to go fix it. */
  readonly offenders: readonly string[];
  /**
   * Form controls wider than the element that owns them.
   *
   * A second overflow, and the reason it needs its own measurement: it does
   * not reach `scrollWidth`. A control that overflows its grid cell by 34px
   * sits inside a panel wide enough to hold it, so the document never scrolls
   * sideways and the check above sees a clean page.
   *
   * What it cost the original project: no global reset, so an `<input>` kept
   * the user agent's `content-box` and `inline-size: 100%` meant 100% PLUS its
   * padding and border. Every text field on one page rendered 487px inside a
   * 453px cell and ate the gutter. Six screenshots of that band went past
   * without catching it, and the owner found it.
   *
   * **A control is never meant to be wider than its own field.** That is an
   * invariant, not a preference, so it is measured rather than looked at.
   */
  readonly controlOverflows: readonly string[];
}

const MEASURE = (viewport: number) => `(async () => {
  await document.fonts.ready;
  const offenders = [];
  for (const el of document.querySelectorAll("body *")) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.right <= ${viewport} + 1) continue;
    const cls = (el.getAttribute("class") ?? "").split(" ")[0];
    offenders.push(
      el.tagName.toLowerCase() + (cls ? "." + cls : "") +
      " (right " + Math.round(box.right) + ", width " + Math.round(box.width) + ")",
    );
  }
  // A control wider than the element that owns it. See \`controlOverflows\`.
  //
  // 1px of tolerance for the same reason \`render-digest\` takes it: sub-pixel
  // rounding differs between platforms, and a rule that fails on 0.4px is a
  // rule nobody can keep green.
  const controlOverflows = [];
  for (const el of document.querySelectorAll("input, select, textarea, button")) {
    const parent = el.parentElement;
    if (!parent) continue;
    const box = el.getBoundingClientRect();
    const owner = parent.getBoundingClientRect();
    if (box.width === 0 || owner.width === 0) continue;
    if (box.width <= owner.width + 1) continue;
    const cls = (el.getAttribute("class") ?? "").split(" ")[0];
    const owns = (parent.getAttribute("class") ?? "").split(" ")[0];
    controlOverflows.push(
      el.tagName.toLowerCase() + (cls ? "." + cls : "") +
      " is " + Math.round(box.width) + "px inside " +
      parent.tagName.toLowerCase() + (owns ? "." + owns : "") +
      " at " + Math.round(owner.width) + "px",
    );
  }

  return JSON.stringify({
    scrollWidth: document.documentElement.scrollWidth,
    offenders: offenders.slice(0, 5),
    controlOverflows: controlOverflows.slice(0, 8),
  });
})()`;

/** Measure every route at every viewport. Opens one browser for the run. */
export async function measure(
  distDirectory: string,
  viewports: readonly number[] = VIEWPORTS,
): Promise<Measurement[]> {
  const routes = routesIn(distDirectory);
  const server = await serveStatic(distDirectory);
  const browser = await launch();
  const measurements: Measurement[] = [];
  try {
    for (const route of routes) {
      for (const viewport of viewports) {
        const page = await browser.page();
        try {
          await page.send("Emulation.setDeviceMetricsOverride", {
            width: viewport,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await page.send("Page.enable");
          await page.send("Page.navigate", { url: `${server.origin}${route}` });
          const result = (await page.send("Runtime.evaluate", {
            expression: MEASURE(viewport),
            awaitPromise: true,
            returnByValue: true,
          })) as {
            result?: { value?: string };
            exceptionDetails?: Record<string, unknown>;
          };
          if (result.exceptionDetails)
            throw new Error(
              `${route} @${viewport}: ${JSON.stringify(result.exceptionDetails).slice(0, 300)}`,
            );
          const value = result.result?.value;
          if (value === undefined)
            throw new Error(`${route} @${viewport}: the page returned nothing`);
          const parsed = JSON.parse(value) as {
            scrollWidth: number;
            offenders: string[];
            controlOverflows: string[];
          };
          measurements.push({ route, viewport, ...parsed });
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return measurements;
}

/**
 * Findings for a set of measurements, with the baseline applied in BOTH
 * directions.
 */
export function findingsFor(
  measurements: readonly Measurement[],
  known: readonly { id: string; cause: string }[] = KNOWN_LAYOUT_BASELINE,
): Finding[] {
  const findings: Finding[] = [];
  const knownIds = new Map(known.map((entry) => [entry.id, entry]));
  const produced = new Set<string>();

  if (measurements.length === 0)
    findings.push(
      warning(
        "viewport-coverage",
        "",
        "",
        "no page was measured — the build output is empty or unreadable",
      ),
    );

  for (const m of measurements) {
    if (m.scrollWidth <= m.viewport) continue;
    const finding = error(
      "overflow",
      m.route,
      String(m.viewport),
      `scrollWidth ${m.scrollWidth} exceeds the ${m.viewport}px viewport` +
        (m.offenders.length > 0 ? ` — widest: ${m.offenders.join("; ")}` : ""),
    );
    const id = idOf(finding);
    produced.add(id);
    findings.push(
      knownIds.has(id)
        ? baseline(
            "overflow",
            m.route,
            String(m.viewport),
            `${finding.detail} — known: ${knownIds.get(id)!.cause}`,
          )
        : finding,
    );
  }

  // A control wider than the box that owns it. Its own finding kind, so the
  // detail names the control and the owner rather than a scrollWidth that
  // never moved — and so the two never mask each other in a baseline.
  for (const m of measurements) {
    if (m.controlOverflows.length === 0) continue;
    const finding = error(
      "control-overflow",
      m.route,
      String(m.viewport),
      "a form control is wider than the element that owns it — " +
        m.controlOverflows.join("; "),
    );
    const id = idOf(finding);
    produced.add(id);
    findings.push(
      knownIds.has(id)
        ? baseline(
            "control-overflow",
            m.route,
            String(m.viewport),
            `${finding.detail} — known: ${knownIds.get(id)!.cause}`,
          )
        : finding,
    );
  }

  // The other direction. A recorded defect this build no longer produces means
  // somebody changed behaviour without changing the record.
  for (const entry of known)
    if (!produced.has(entry.id))
      findings.push(
        error(
          "overflow",
          entry.id,
          "",
          "recorded in the layout baseline but this build does not produce it — " +
            "remove the entry in the same change that fixed it",
        ),
      );

  return findings;
}
