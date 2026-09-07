// Render digest — what every page LOOKED like, recorded as text.
//
// ## Why this exists
//
// The rest of the ladder is strong on structure and blind on paint. Nothing
// else in this kit compares what a page looked like yesterday with what it
// looks like today. In the project this was extracted from, every defect that
// reached the owner was a paint defect — a hero painting the wrong artwork, a
// panel painted twice from two rule sets, a plan tab missing — and every one
// of them passed fifteen green gates.
//
// ## Why a digest and not a screenshot diff
//
// It produces a **text diff a reviewer can read in the pull request** —
// `bg-image:none` becoming `bg-image:url(/assets/…)` on one element — rather
// than "4.2% of pixels changed". It is deterministic where an image diff
// fights antialiasing, and it needs no image decoding (Node ships none).
//
// Screenshots are still taken, with `--shots`, from the same page load. They
// are artifacts a person looks at and they never fail a build.
//
// ## What it does NOT do
//
// It finds CHANGE, not wrongness. A page that was badly built on its first
// render has nothing to differ from, so a baseline recorded before anybody
// looked records the defect as the reference. **Walk the route, then record
// it** — that ordering is the whole of PLAYBOOK.md §6's "walk it before you
// baseline it", and `describe()` says so on every unrecorded route.
//
// ## Determinism is the whole job
//
// A digest that is not byte-identical across two runs of one build is not a
// gate. Four things had to be pinned:
//
//  1. **Webfonts.** `document.fonts.ready` is awaited — measuring before they
//     load measures a different page.
//  2. **Images.** Awaited too, and this one was measured rather than assumed:
//     with fonts alone, one route in forty-four differed between two runs of
//     the same build, because an image whose box is not fully constrained by
//     CSS reflows the page under it. `fonts.ready` says nothing about images.
//  3. **Animation.** Reduced motion is emulated AND animations and transitions
//     are disabled outright: a scroll-driven animation mid-interpolation
//     reports a different computed value on every run.
//  4. **The server's port.** `serveStatic` binds an ephemeral one, so a
//     `background-image: url("http://127.0.0.1:53821/…")` differs on every
//     run. Origins are stripped to their path.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { launch } from "../lib/cdp.ts";
import { routesIn } from "../lib/routes.ts";
import { serveStatic } from "../lib/serve.ts";

/**
 * The two widths a digest is taken at.
 *
 * Not `layout-audit`'s six. That audit asks one cheap question per viewport;
 * this records every element, so six widths would be three times the file for
 * a class of change that shows at these two — the multi-column composition and
 * the single-column one.
 */
export const DIGEST_VIEWPORTS: readonly number[] = [1440, 375];

/**
 * The properties recorded, and the list is deliberately short and CLOSED.
 *
 * Every one of them is something a reader would notice: where a box is, what
 * colour it is, what it is filled with, how its text is set. Adding
 * `margin`/`padding` would double the file to say a second time what the boxes
 * already say, and adding everything would make the digest churn on internals
 * nobody looks at.
 */
const PROPERTIES: readonly (readonly [string, string])[] = [
  ["display", "display"],
  ["position", "position"],
  ["overflow", "overflow"],
  ["background-color", "bg"],
  ["background-image", "bg-image"],
  ["color", "color"],
  ["font-size", "size"],
  ["line-height", "lh"],
  ["font-weight", "weight"],
  ["border-radius", "radius"],
  ["opacity", "opacity"],
  ["visibility", "visibility"],
];

/** One route at one width. `lines` is the digest, in document order. */
export interface RouteDigest {
  readonly route: string;
  readonly viewport: number;
  readonly lines: readonly string[];
}

/**
 * The file one route/width digest is recorded in.
 *
 * `/` becomes `home`, and every other route's slashes become dashes, so the
 * directory is flat and sorts the way the routes do.
 */
export function digestFileName(route: string, viewport: number): string {
  const slug =
    route === "/"
      ? "home"
      : route.replace(/^\//, "").replace(/\/$/, "").replace(/\//g, "-");
  return `${slug}-${viewport}.txt`;
}

/**
 * Settle the page: fonts loaded, images decoded, scrolled to the top.
 *
 * Split out from the measurement below for one reason, and it was found by
 * LOOKING at the screenshots rather than by reasoning: the measurement rewrites
 * the DOM (see the emoji note there), so a screenshot taken after it shows
 * glyphs no reader will ever see. The kit's own footer came back reading
 * "# 2026 Example Site" because `©` is `Extended_Pictographic` and matched.
 *
 * A screenshot exists for a person to look at. It has to be the page.
 */
const SETTLE = `(async () => {
  await document.fonts.ready;

  // Every image is forced EAGER first, and a version of this without that hung
  // forever: a lazy image below the fold never starts loading, so it fires
  // neither \`load\` nor \`error\` and \`complete\` stays false. It is also the
  // more correct thing to measure — whether a lazy image has loaded depends on
  // scroll position and timing, which is exactly the non-determinism this
  // function exists to remove.
  //
  // The timeout is a backstop, not the mechanism, and it is thirty seconds
  // rather than two because a migrated body carries its images at the SOURCE
  // site's URLs, verbatim. Those are network fetches, dozens of them on an
  // archive page, and a two-second budget expired part-way through: the same
  // page measured 5,594px on one run and 6,314px on the next, and 24 of 74
  // routes disagreed with themselves. A flaky baseline is worse than no
  // baseline, because every real diff after it reads as noise.
  await Promise.all(
    [...document.images].map((image) => {
      if (image.loading === "lazy") image.loading = "eager";
      if (image.complete) return null;
      return new Promise((resolve) => {
        const done = () => resolve(null);
        image.addEventListener("load", done, { once: true });
        image.addEventListener("error", done, { once: true });
        setTimeout(done, 30000);
      });
    }),
  );

  window.scrollTo(0, 0);
  // Two frames: the first flushes the scroll and any style invalidation the
  // image loads caused, the second lets layout settle before anything reads or
  // photographs the page.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  return true;
})()`;

/**
 * Read one page, in the page's own context. Run AFTER `SETTLE`.
 *
 * The walk is `body *` in document order, with depth as indentation, so an
 * inserted element shows as an inserted line rather than as a renumbering of
 * everything after it.
 *
 * `data-astro-cid-*` is never read: it changes when a component's source
 * changes, which would churn the digest on edits that alter no pixel.
 */
const READ = `(async () => {
  // Emoji are the one glyph set that does NOT come from the site's own fonts —
  // the operating system supplies them, and the emoji fonts on a Mac and on a
  // Linux runner have different advances and line boxes. That broke this
  // module's measured premise the day a migrated post carried emoji in its
  // headings: the same page measured 27px taller on CI, because wrap points
  // moved. So every emoji cluster is replaced with "#" BEFORE measuring, and
  // layout is then driven by identical font files on every platform. The pages
  // readers see are untouched; only this capture's DOM is rewritten, and the
  // digest's job is geometry and paint, not content.
  {
    const EMOJI = /(?:\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic}(?:\\uFE0F|\\u200D\\p{Extended_Pictographic}\\uFE0F?)*|[\\u20E3\\uFE0F])/gu;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      node.nodeValue = node.nodeValue.replace(EMOJI, "#");
  }

  // One frame, to flush the invalidation the rewrite above caused. The page was
  // already settled and scrolled to the top by the settle pass.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

  const PROPERTIES = ${JSON.stringify(PROPERTIES)};
  const ORIGIN = new RegExp(location.origin.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "g");
  const round = (n) => String(Math.round(n));

  const clean = (value) => value.replace(ORIGIN, "").replace(/\\s+/g, " ").trim();

  const label = (el) => {
    const tag = el.tagName.toLowerCase();
    const classes = (el.getAttribute("class") || "")
      .split(/\\s+/)
      .filter((name) => name && !name.startsWith("data-astro-cid-"));
    return classes.length > 0 ? tag + "." + classes[0] : tag;
  };

  const ownText = (el) => {
    let text = "";
    for (const node of el.childNodes)
      if (node.nodeType === 3) text += node.nodeValue;
    return text.replace(/\\s+/g, " ").trim().slice(0, 80);
  };

  const depthOf = (el) => {
    let depth = 0;
    let node = el.parentElement;
    while (node && node !== document.body) { depth += 1; node = node.parentElement; }
    return depth;
  };

  // A pseudo reports "18px"; the elements above report plain numbers. One
  // format, so a reader comparing the two lines is not doing unit arithmetic.
  const size = (value) => {
    const number = Number.parseFloat(clean(value));
    return Number.isFinite(number) ? round(number) : clean(value);
  };

  const paintedFrom = (styles) =>
    PROPERTIES
      .map(([property, short]) => short + ":" + clean(styles.getPropertyValue(property)))
      .join(" ");

  const lines = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    const indent = "  ".repeat(depthOf(el));
    const name = label(el);
    const styles = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const geometry =
      styles.display === "none"
        ? "display:none"
        : round(box.x + window.scrollX) + "," + round(box.y + window.scrollY) +
          " " + round(box.width) + "x" + round(box.height);
    const text = ownText(el);
    lines.push(
      indent + name +
      " | " + geometry +
      " | " + paintedFrom(styles) +
      (text ? ' | "' + text + '"' : ""),
    );

    // The pseudo-elements, and they are not an extra. A hero's artwork, a
    // decorative rule, a breadcrumb separator and a gradient ring are all
    // commonly painted on ::before and ::after. Reading the element alone
    // reported "every route renders exactly as it was recorded" with a hero
    // background deleted — measured, not imagined.
    //
    // A pseudo has no box to measure, so its declared width and height stand
    // in; a content of none means it does not render at all.
    for (const pseudo of ["::before", "::after"]) {
      const shadow = getComputedStyle(el, pseudo);
      const content = shadow.getPropertyValue("content");
      if (content === "none" || content === "normal") continue;
      lines.push(
        indent + name + pseudo +
        " | " + size(shadow.getPropertyValue("width")) + "x" +
        size(shadow.getPropertyValue("height")) +
        " | " + paintedFrom(shadow) +
        " | content:" + clean(content),
      );
    }
  }
  return lines.join("\\n");
})()`;

/**
 * Animation and transition, off.
 *
 * Emulating reduced motion is not enough on its own: a site may honour it for
 * one effect and drive another from scroll position, and a scroll-driven
 * animation mid-interpolation reports a different computed value every run.
 */
const STILL = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
}`;

/**
 * Digest routes in a build at every digest viewport. One browser for the run.
 *
 * `screenshotDirectory` opts into a full-page PNG per route per width, written
 * beside the digest from the SAME page load. One pass rather than two, because
 * the settling above — fonts, images, two frames — is the expensive part and
 * doing it twice would double a CI step to produce the same pixels.
 *
 * Screenshots never fail anything. They are uploaded as artifacts for a person
 * to look at, and they are gitignored: full-page PNGs are megabytes, and a
 * committed binary nobody can diff is not a baseline.
 */
export async function capture(
  distDirectory: string,
  viewports: readonly number[] = DIGEST_VIEWPORTS,
  routeFilter?: (route: string) => boolean,
  screenshotDirectory?: string,
): Promise<RouteDigest[]> {
  const routes = routesIn(distDirectory).filter(routeFilter ?? (() => true));
  const server = await serveStatic(distDirectory);
  const browser = await launch();
  const digests: RouteDigest[] = [];
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
          await page.send("Emulation.setEmulatedMedia", {
            features: [{ name: "prefers-reduced-motion", value: "reduce" }],
          });
          await page.send("Page.enable");
          await page.send("Page.addScriptToEvaluateOnNewDocument", {
            source: `document.addEventListener("DOMContentLoaded", () => {
              const style = document.createElement("style");
              style.textContent = ${JSON.stringify(STILL)};
              document.head.append(style);
            });`,
          });
          await page.send("Page.navigate", { url: `${server.origin}${route}` });

          const evaluate = async (expression: string): Promise<unknown> => {
            const result = (await page.send("Runtime.evaluate", {
              expression,
              awaitPromise: true,
              returnByValue: true,
            })) as {
              result?: { value?: unknown };
              exceptionDetails?: Record<string, unknown>;
            };
            if (result.exceptionDetails)
              throw new Error(
                `${route} @${viewport}: ${JSON.stringify(result.exceptionDetails).slice(0, 300)}`,
              );
            return result.result?.value;
          };

          await evaluate(SETTLE);

          // The screenshot comes BEFORE the measurement, because the
          // measurement rewrites the DOM. Same page load, so the expensive part
          // — fonts, images, two frames — is still paid once.
          if (screenshotDirectory !== undefined) {
            mkdirSync(screenshotDirectory, { recursive: true });
            const shot = (await page.send("Page.captureScreenshot", {
              format: "png",
              captureBeyondViewport: true,
            })) as { data: string };
            writeFileSync(
              path.join(
                screenshotDirectory,
                digestFileName(route, viewport).replace(/\.txt$/, ".png"),
              ),
              Buffer.from(shot.data, "base64"),
            );
          }

          const value = await evaluate(READ);
          if (typeof value !== "string")
            throw new Error(`${route} @${viewport}: the page returned nothing`);
          digests.push({
            route,
            viewport,
            lines: value === "" ? [] : value.split("\n"),
          });
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return digests;
}

/** The text a digest is stored as — one element per line, trailing newline. */
export function serialize(digest: RouteDigest): string {
  return `${digest.lines.join("\n")}\n`;
}
