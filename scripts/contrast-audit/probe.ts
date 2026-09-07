// What every piece of text on a page is ACTUALLY read against.
//
// `scripts/accessibility-audit` checks contrast between token PAIRS, and it is
// right to: it is static, pure Node, and it runs on every push. A pair check
// answers "is this foreground legible on that ground" and cannot answer "is
// this foreground ON that ground", because the second question needs a layout
// engine — an ancestor chain, a composited background, an inherited colour.
//
// In the project this came from, a homepage shipped for months with two 56px
// headings painting `#091439` on a `#0c0934` band. **1.06:1** — not low
// contrast, a heading nobody can see — through every green gate, on the most
// important page. Both token pairs were registered and both were fine; nothing
// had ever asked which ground those headings were actually on. It was found by
// looking at a screenshot, which is not a gate.
//
// So this is the other half, and it needs a browser, which is why it belongs
// beside `layout-audit` and `render-digest` rather than in the pure-Node
// ladder.
//
// **Composited, not read off one element.** A ground is built by walking
// ancestors until an opaque background is found and compositing them back
// down; a text colour is then composited over that. The first version of this
// probe parsed `color(srgb 1 1 1 / 0.898)` with a bare digit regex, read it as
// `rgb(1, 1, 1)`, and reported 64 phantom failures in a footer. Alpha is
// composited here, never ignored.
import { launch } from "../lib/cdp.ts";
import { routesIn } from "../lib/routes.ts";
import { serveStatic } from "../lib/serve.ts";

/** One piece of text that does not meet AA against the ground behind it. */
export interface ContrastFinding {
  readonly route: string;
  readonly viewport: number;
  /** A selector-ish label: tag plus its first class. */
  readonly element: string;
  /** The text itself, so a person can find it on the page. */
  readonly text: string;
  /** The computed colour, as authored. */
  readonly color: string;
  /** The opaque ground it was composited against. */
  readonly ground: string;
  readonly size: number;
  readonly weight: number;
  /** Measured ratio, two decimals. */
  readonly ratio: number;
  /** 3 for large text, 4.5 otherwise — WCAG 1.4.3. */
  readonly required: number;
}

/** The widths this runs at. The same two `render-digest` records. */
export const CONTRAST_VIEWPORTS: readonly number[] = [1440, 375];

/**
 * The page-side probe.
 *
 * Only elements with their OWN text are considered — a `<div>` wrapping a
 * paragraph inherits its colour and would be reported twice, naming a box
 * rather than the words a reader sees.
 */
const READ = `(() => {
  const parse = (s) => {
    let m = s.match(/^color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\)$/);
    if (m) return [ +m[1]*255, +m[2]*255, +m[3]*255, m[4] === undefined ? 1 : +m[4] ];
    m = s.match(/^rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+))?\\s*\\)$/);
    if (m) return [ +m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4] ];
    return null;
  };
  const over = (fg, bg) => [0,1,2].map((i) => fg[i]*fg[3] + bg[i]*(1-fg[3]));
  const groundOf = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) { stack.push(c); if (c[3] === 1) break; }
    }
    let out = [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
    return out;
  };
  const lum = (c) => { const [r,g,b] = c.slice(0,3).map((v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*r + 0.7152*g + 0.0722*b; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();

  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const text = ownText(el);
    if (text.length < 2) continue;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (parseFloat(cs.opacity) === 0) continue;
    const fg = parse(cs.color);
    if (!fg || fg[3] === 0) continue;
    const ground = groundOf(el);
    const painted = over(fg, ground);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    const r = ratio(painted, ground);
    if (r >= required) continue;
    out.push({
      element: el.tagName.toLowerCase() + (el.classList[0] ? "." + el.classList[0] : ""),
      text: text.slice(0, 60),
      color: cs.color,
      ground: "rgb(" + ground.map((v) => Math.round(v)).join(", ") + ")",
      size: Math.round(size * 100) / 100,
      weight,
      ratio: Math.round(r * 100) / 100,
      required,
    });
  }
  return JSON.stringify(out);
})()`;

/** Every text element below AA, across a build, at both widths. One browser. */
export async function probeContrast(
  distDirectory: string,
  viewports: readonly number[] = CONTRAST_VIEWPORTS,
): Promise<ContrastFinding[]> {
  const routes = routesIn(distDirectory);
  const server = await serveStatic(distDirectory);
  const browser = await launch();
  const findings: ContrastFinding[] = [];
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
          // Fonts only. A webfont changes which glyphs are measured for
          // `large`, and nothing here depends on an image having decoded —
          // which is why this does not carry `render-digest`'s image settling.
          await page.send("Runtime.evaluate", {
            expression: "document.fonts.ready.then(() => true)",
            awaitPromise: true,
            returnByValue: true,
          });
          const result = (await page.send("Runtime.evaluate", {
            expression: READ,
            returnByValue: true,
          })) as {
            result?: { value?: string };
            exceptionDetails?: Record<string, unknown>;
          };
          if (result.exceptionDetails)
            throw new Error(
              `${route} @${viewport}: ${JSON.stringify(result.exceptionDetails).slice(0, 300)}`,
            );
          for (const found of JSON.parse(result.result?.value ?? "[]") as Omit<
            ContrastFinding,
            "route" | "viewport"
          >[])
            findings.push({ route, viewport, ...found });
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return findings;
}
