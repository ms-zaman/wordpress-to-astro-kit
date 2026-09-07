// The checks, each one over the BUILT output rather than the source, because
// the built output is what a reader receives.
//
// What these add over `model.ts` is the part only a whole build can see: every
// page at once, the CSS each page actually applies, and the relationship
// between an element and the rule that styles it.
import { migration } from "../../migration.config.ts";
import { error, warning, type Finding } from "./finding.ts";
import {
  describeViolation,
  headingLevels,
  landmarksOf,
  landmarkViolations,
  outlineViolations,
  type LandmarkTag,
} from "./model.ts";
import { isReviewOnly, type Page } from "./pages.ts";

/* ------------------------------------------------------------------ */
/* Heading hierarchy                                                   */
/* ------------------------------------------------------------------ */

/**
 * Every outline violation on every page, as findings.
 *
 * All four kinds are errors here. A clean outline on every emitted page is an
 * unqualified claim, and anything else is either a regression or — in a
 * migration — a row in `baseline.ts` naming the decision that owns it.
 */
export function checkHeadings(pages: readonly Page[]): Finding[] {
  const findings: Finding[] = [];
  for (const page of pages) {
    const levels = headingLevels(page.html);
    for (const violation of outlineViolations(levels))
      findings.push(
        error(
          "headings",
          page.file,
          violation.kind,
          `${describeViolation(violation)} — sequence [${levels.join(" ")}]`,
        ),
      );
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* Landmarks                                                           */
/* ------------------------------------------------------------------ */

/**
 * The template family a page came from, when the build's manifest is not
 * available to say.
 *
 * A fallback, and a deliberately coarse one: the first path segment, plus one
 * bucket for everything at the top level. It exists so the majority rule below
 * still does something on an arbitrary directory — the mutation suite hands it
 * one — and it is NOT what a real build uses.
 *
 * Why it is not good enough on its own: it puts `/`, `/404` and `/about` in
 * one bucket, so a breadcrumb every real page carries and the home page
 * correctly does not becomes a majority, and the rule then demands a
 * breadcrumb on the home page. Measured on this kit's own sample site.
 * `scripts/lib/manifest.ts` reads the answer the route table already knows.
 */
export function templateFamily(file: string): string {
  const segments = file.split("/");
  if (segments.length < 3) return "top-level";
  if (segments.includes(migration.permalinks.paginationSegment))
    return `${segments[0]!}-pagination`;
  return segments[0]!;
}

/**
 * Landmark structure, by semantic identity rather than by tag count.
 *
 * `landmarkViolations` covers the structural rules — exactly one `main`, every
 * `nav` named, no two navs on a page sharing a name. Two rules are added here
 * that only a whole build can check:
 *
 *   - a production page carries the three site landmarks, and a review-only
 *     page carries `main` and none of the site chrome;
 *   - **nav names are consistent across pages.** A nav labelled `Main` on one
 *     page and `Primary` on the next is not a per-page violation and is still
 *     a defect: a screen-reader user navigating by landmark loses the ability
 *     to recognise the same region twice.
 */
export function checkLandmarks(
  pages: readonly Page[],
  /**
   * File to template family, from the build's own route inventory. Defaults to
   * the path-shape fallback above, which is what an arbitrary directory gets.
   */
  families: ReadonlyMap<string, string> = new Map(),
): Finding[] {
  const findings: Finding[] = [];
  const namesByPage = new Map<string, string[]>();

  for (const page of pages) {
    const review = isReviewOnly(page.file);
    const landmarks = landmarksOf(page.html);

    // The two layouts legitimately require different sets: a site page has
    // header/main/footer, a review page has `main` and must NOT have chrome.
    const required: readonly LandmarkTag[] = review
      ? ["main"]
      : ["header", "main", "footer"];
    for (const violation of landmarkViolations(landmarks, required))
      findings.push(
        error("landmarks", page.file, violation.kind, violation.detail),
      );

    namesByPage.set(
      page.file,
      landmarks
        .filter((landmark) => landmark.tag === "nav")
        .map((landmark) => landmark.label ?? "(unnamed)")
        .sort(),
    );

    if (review)
      for (const tag of ["header", "footer"] as const)
        if (landmarks.some((landmark) => landmark.tag === tag))
          findings.push(
            error(
              "landmarks",
              page.file,
              `review-${tag}`,
              `a review-only page carries a <${tag}> landmark — it must not have site chrome`,
            ),
          );
  }

  // Nav-name consistency across production pages.
  //
  // Pages legitimately carry DIFFERENT nav sets: a breadcrumb trail appears
  // only on entry pages, an entry pager only where there is a next entry.
  // Comparing whole sets would call that drift, which is why the rule is a
  // majority one instead: **a nav name carried by more than half of the pages
  // is site chrome, and site chrome is on every page.**
  //
  // The majority is per TEMPLATE FAMILY, not site-wide, and that was learned
  // the expensive way. Site-wide it was calibrated against eighteen pages,
  // where a breadcrumb sat on seven and was correctly a minority. Then a
  // migrated blog arrived and one template became 79% of the site: `Breadcrumb`
  // and `Post` — genuinely contextual, on entry pages and nowhere else —
  // crossed the site-wide majority, and the audit demanded them on the pricing
  // page, on `/404` and on every author archive. 112 errors, none of them a
  // defect.
  //
  // Requiring a majority within EVERY family restores the original property: a
  // nav that only entry pages carry is absent from the top-level family and so
  // is never chrome, however many entry pages there are — while keeping a
  // rename detectable, because one renamed page still leaves its own family in
  // the majority.
  const production = [...namesByPage].filter(([file]) => !isReviewOnly(file));
  if (production.length > 0) {
    const byFamily = new Map<string, Array<readonly [string, string[]]>>();
    for (const [file, names] of production) {
      const family = families.get(file) ?? templateFamily(file);
      byFamily.set(family, [...(byFamily.get(family) ?? []), [file, names]]);
    }

    const majorityIn = (
      members: Array<readonly [string, string[]]>,
    ): Set<string> => {
      const frequency = new Map<string, number>();
      for (const [, names] of members)
        for (const name of new Set(names))
          frequency.set(name, (frequency.get(name) ?? 0) + 1);
      return new Set(
        [...frequency]
          .filter(([, count]) => count * 2 > members.length)
          .map(([name]) => name),
      );
    };

    const perFamily = [...byFamily.values()].map(majorityIn);
    const chrome = [...(perFamily[0] ?? new Set<string>())]
      .filter((name) => perFamily.every((set) => set.has(name)))
      .sort();

    for (const [file, names] of production)
      for (const name of chrome)
        if (!names.includes(name))
          findings.push(
            error(
              "landmarks",
              file,
              `nav-missing:${name}`,
              `every other production page carries a nav landmark named "${name}" and this one does not — a renamed or dropped landmark is a region a reader can no longer recognise`,
            ),
          );
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/* Focus visibility                                                    */
/* ------------------------------------------------------------------ */

/**
 * Properties that actually draw a focus indicator.
 *
 * Before this list, "covered" meant a `:focus-visible` rule existed and said
 * nothing about what the rule DID — and a skip link proved those are not the
 * same question. A rule that sets `inset-block-start` and nothing else moves
 * the link into view and draws no ring, so the browser paints its own. The old
 * check called that covered.
 *
 * `border-radius` is excluded: it shapes an indicator's corners and draws
 * nothing by itself.
 */
const INDICATOR_PROPERTY =
  /(^|;)\s*(outline(-width|-style|-color)?|box-shadow|border(?!-radius)[a-z-]*|background(-color|-image)?|text-decoration[a-z-]*)\s*:/;

/** `outline: none` with nothing put back is a removal, not an indicator. */
const REMOVES_INDICATOR = (block: string): boolean =>
  /(^|;)\s*outline\s*:\s*(none|0)\s*(;|$)/.test(block) &&
  !/box-shadow|border|background|text-decoration/.test(block);

/**
 * Every class named in a `:focus-visible` selector in this CSS.
 *
 * The narrower question — does a rule exist at all — which is still a real one
 * and which the suite uses to prove the distinction below is doing work.
 */
export function focusVisibleClasses(css: string): Set<string> {
  const classes = new Set<string>();
  for (const rule of css.matchAll(/([^{}]+)\{/g))
    for (const selector of rule[1]!.split(","))
      if (/:focus-visible\b/.test(selector))
        for (const cls of selector.matchAll(/\.([A-Za-z0-9_-]+)/g))
          classes.add(cls[1]!);
  return classes;
}

/**
 * Classes whose `:focus-visible` rule declares a visible indicator.
 *
 * A strict subset of `focusVisibleClasses`. This is the set the coverage check
 * uses, because it is the one a keyboard user can see.
 */
export function focusIndicatorClasses(css: string): Set<string> {
  const classes = new Set<string>();
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectors, block] = rule;
    if (!INDICATOR_PROPERTY.test(block!) || REMOVES_INDICATOR(block!)) continue;
    for (const selector of selectors!.split(","))
      if (/:focus-visible\b/.test(selector))
        for (const cls of selector.matchAll(/\.([A-Za-z0-9_-]+)/g))
          classes.add(cls[1]!);
  }
  return classes;
}

/**
 * Does this page carry the design system's one universal focus rule?
 *
 * `packages/ui/src/foundation/focus.css` declares `:focus-visible` with no
 * selector in front of it, so it reaches every focusable element on the page —
 * including the ones no component class touches: a link inside a migrated
 * body, the skip link, anything added tomorrow. That is what lets `checkFocus`
 * below stop asking each control whether somebody remembered it.
 *
 * The same two disqualifiers as `focusIndicatorClasses` apply: the rule must
 * declare something that draws, and must not be a bare `outline: none`.
 */
export function hasUniversalFocusIndicator(css: string): boolean {
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectors, block] = rule;
    if (!INDICATOR_PROPERTY.test(block!) || REMOVES_INDICATOR(block!)) continue;
    for (const selector of selectors!.split(","))
      if (/^\s*\*?:focus-visible\s*$/.test(selector)) return true;
  }
  return false;
}

/**
 * The universal rule reached every page.
 *
 * This is the load-bearing focus check, and it must stay that way: `checkFocus`
 * passes vacuously on any page carrying the universal rule, so THIS is what
 * fails if the rule is deleted, renamed, scoped by accident, or dropped from a
 * bundle. A build where it goes missing produces one finding per page here and
 * then the full list of uncovered controls from `checkFocus`, in that order.
 */
export function checkFocusSystemRule(pages: readonly Page[]): Finding[] {
  return pages
    .filter((page) => !hasUniversalFocusIndicator(page.css))
    .map((page) =>
      error(
        "focus",
        page.file,
        "system-rule",
        "the design system's universal :focus-visible rule " +
          "(packages/ui/src/foundation/focus.css) is not in this page's CSS — " +
          "every control on it falls back to whatever ring the browser draws",
      ),
    );
}

/** The interactive elements a page renders, with their classes. */
export function interactiveElements(
  html: string,
): { tag: string; classes: string[] }[] {
  const out: { tag: string; classes: string[] }[] = [];
  for (const match of html.matchAll(/<(a|button|summary)\b([^>]*)>/g)) {
    const [, tag, attrs] = match;
    // An anchor with no href is not focusable and is not a control.
    if (tag === "a" && !/\shref=/.test(attrs!)) continue;
    const classes = (attrs!.match(/class="([^"]*)"/)?.[1] ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .filter((cls) => !cls.startsWith("data-astro-cid"));
    out.push({ tag: tag!, classes });
  }
  return out;
}

/**
 * Interactive elements that no `:focus-visible` rule reaches.
 *
 * **This deliberately does not count rules.** A count would catch a stale
 * comment claiming eleven rules where there are twelve, and would also fail
 * every time a component is legitimately added — which makes it the wrong
 * contract.
 *
 * The contract asserted instead is the one a keyboard user actually feels:
 * every focusable control the build emits is reached by a focus rule that
 * draws something. It is independent of how many rules there are and of which
 * file they live in.
 *
 * A page carrying the universal rule is skipped: the question "did somebody
 * remember this control?" has no meaning once no control has to be remembered.
 * This stays as that rule's fallback, and as what reports the damage if it
 * ever stops arriving.
 *
 * Reported per element KIND rather than per page, because the same omission on
 * eighteen pages is one defect, not eighteen.
 */
export function checkFocus(pages: readonly Page[]): Finding[] {
  const uncovered = new Map<string, Set<string>>();

  for (const page of pages) {
    if (hasUniversalFocusIndicator(page.css)) continue;
    const covered = focusIndicatorClasses(page.css);
    for (const element of interactiveElements(page.html)) {
      if (element.classes.some((cls) => covered.has(cls))) continue;
      const key =
        element.classes.length === 0
          ? element.tag
          : `${element.tag}.${element.classes.join(".")}`;
      if (!uncovered.has(key)) uncovered.set(key, new Set());
      uncovered.get(key)!.add(page.file);
    }
  }

  return [...uncovered]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, files]) =>
      error(
        "focus",
        "*",
        key,
        `<${key}> is reached by no :focus-visible rule that draws an indicator on ${files.size} page(s), e.g. ${[...files].sort()[0]} — it falls back to the browser default ring`,
      ),
    );
}

/* ------------------------------------------------------------------ */
/* Section naming                                                      */
/* ------------------------------------------------------------------ */

/**
 * An anchored section is named by the heading it already renders.
 *
 * An unnamed `<section>` is correctly not a landmark, so nothing is violated
 * by leaving one alone. What it costs is arrival: a reader following an
 * in-page link is moved somewhere the page will not say the name of. A named
 * one is a `region` landmark that announces itself.
 *
 * Two things are asserted, and neither is "every section is named" — a section
 * with no heading has no name to take, and inventing one is worse than leaving
 * it:
 *
 *   1. **The convention holds.** A page carrying `id="x-title"` and a
 *      `<section id="x">` that does not point at it is a component rendering
 *      half the convention. That is the failure this catches, and the only
 *      shape it can take.
 *   2. **The reference resolves.** `aria-labelledby` naming an id no element
 *      on the page carries leaves the section unnamed AND announced as a
 *      region, which is worse than leaving it alone.
 */
export function checkSectionNaming(pages: readonly Page[]): Finding[] {
  const findings: Finding[] = [];

  for (const page of pages) {
    const ids = new Set(
      [...page.html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!),
    );

    for (const match of page.html.matchAll(/<section\b([^>]*)>/g)) {
      const attributes = match[1]!;
      const id = /\sid="([^"]+)"/.exec(attributes)?.[1];
      const labelledBy = /\saria-labelledby="([^"]+)"/.exec(attributes)?.[1];

      if (labelledBy !== undefined && !ids.has(labelledBy))
        findings.push(
          error(
            "landmarks",
            page.file,
            `dangling-name:${labelledBy}`,
            `a <section> is named by aria-labelledby="${labelledBy}" and no element on the page carries that id — it is announced as a region with no name`,
          ),
        );

      if (id === undefined) continue;
      const expected = `${id}-title`;
      if (ids.has(expected) && labelledBy !== expected)
        findings.push(
          error(
            "landmarks",
            page.file,
            `unnamed-section:${id}`,
            `<section id="${id}"> renders its heading as id="${expected}" and does not point at it with aria-labelledby — half of the convention, so a reader arriving by in-page link is not told where they landed`,
          ),
        );
    }
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/* Navigation semantics                                                */
/* ------------------------------------------------------------------ */

/**
 * The site navigation, checked as a menu rather than as markup.
 *
 * Five properties, each of which a user loses something concrete by breaking:
 *
 *   - every nav is named, and no two on a page share a name;
 *   - the small-viewport disclosure is a native control, so it is operable
 *     with the keyboard and ships no script;
 *   - a page that IS a menu destination marks that item `aria-current="page"`;
 *   - no page marks an item current that points somewhere else;
 *   - every in-site nav link resolves to a page the build emitted.
 */
export function checkNavigation(
  pages: readonly Page[],
  emitted: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];

  for (const page of pages) {
    if (isReviewOnly(page.file)) continue;

    const navs = [...page.html.matchAll(/<nav\b([^>]*)>/g)];
    if (navs.length === 0) {
      findings.push(
        error(
          "navigation",
          page.file,
          "no-nav",
          "a production page carries no <nav> landmark",
        ),
      );
      continue;
    }

    // The toggle must stay native and script-free. A checkbox with a bound
    // label, chosen over a `<details open>` because `open` is a markup
    // attribute CSS cannot unset — so that version's menu opened over the
    // whole first screen on a phone. What is checked: a native control,
    // operable from a keyboard, with a visible trigger bound to it, and closed
    // on first paint.
    const toggle = /<input[^>]*type="checkbox"[^>]*id="([^"]+)"[^>]*>/.exec(
      page.html,
    );
    if (toggle === null)
      findings.push(
        error(
          "navigation",
          page.file,
          "disclosure",
          "the small-viewport menu has no native checkbox toggle — a scripted menu would end this site's no-JavaScript property",
        ),
      );
    else {
      if (!page.html.includes(`for="${toggle[1]}"`))
        findings.push(
          error(
            "navigation",
            page.file,
            "summary",
            "the menu toggle has no <label for>, so it has no keyboard-operable trigger",
          ),
        );
      if (/\bchecked\b/.test(toggle[0]))
        findings.push(
          error(
            "navigation",
            page.file,
            "toggle-open",
            "the menu toggle ships checked, so the small-viewport menu opens expanded over the first screen",
          ),
        );
    }

    // Current-item state. `aria-current="page"` appears on the menu item AND
    // on the last breadcrumb, so more than one is expected; what is not
    // expected is an item claiming to be a page that is not this one.
    for (const match of page.html.matchAll(
      /<a\b[^>]*aria-current="page"[^>]*>/g,
    )) {
      const href = match[0].match(/href="([^"]+)"/)?.[1];
      if (href === undefined) continue;
      if (routeToFile(href) !== page.file)
        findings.push(
          error(
            "navigation",
            page.file,
            "current-mismatch",
            `an item is marked aria-current="page" but points at ${href}, which is not this page`,
          ),
        );
    }

    // Dead references, scoped to nav regions only — `preview-audit` owns the
    // site-wide link check and this must not duplicate it.
    for (const region of navRegions(page.html))
      for (const match of region.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
        const href = match[1]!;
        if (/^(https?:|mailto:|tel:|#)/.test(href)) continue;
        if (!emitted.has(routeToFile(href)))
          findings.push(
            error(
              "navigation",
              page.file,
              `dead:${href}`,
              `a navigation link points at ${href}, which the build did not emit`,
            ),
          );
      }
  }

  // A nav name used on some production pages but not others is drift, and
  // `checkLandmarks` reports it. Here we only warn when a build has no
  // labelled navigation at all, which would mean the whole check was vacuous.
  const labelled = pages.some((page) =>
    /<nav\b[^>]*aria-label=/.test(page.html),
  );
  if (!labelled)
    findings.push(
      warning(
        "navigation",
        "",
        "vacuous",
        "no page in this build carries a labelled <nav> — the navigation checks matched nothing",
      ),
    );

  return findings;
}

/* ------------------------------------------------------------------ */
/* List semantics                                                      */
/* ------------------------------------------------------------------ */

/**
 * A `<ul>`/`<ol>` as the built output carries it.
 *
 * `scopes` are the `data-astro-cid-*` attribute names on the element. They are
 * what makes the CSS match below precise: Astro scopes a component's rules by
 * stamping the same token on the rule and on the elements it may style, so a
 * rule written `.nav[data-astro-cid-x] ul[data-astro-cid-x]` reaches the
 * navigation's lists and cannot reach a list in another component.
 */
export interface ListElement {
  readonly tag: "ul" | "ol";
  readonly classes: string[];
  readonly scopes: string[];
  readonly role: string | null;
}

export function listElements(html: string): ListElement[] {
  const out: ListElement[] = [];
  for (const match of html.matchAll(/<(ul|ol)\b([^>]*)>/g)) {
    const [, tag, attrs] = match;
    const classes = (attrs!.match(/class="([^"]*)"/)?.[1] ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .filter((cls) => !cls.startsWith("data-astro-cid"));
    out.push({
      tag: tag as "ul" | "ol",
      classes,
      scopes: [...attrs!.matchAll(/\b(data-astro-cid-[A-Za-z0-9_-]+)/g)].map(
        (scope) => scope[1]!,
      ),
      role: attrs!.match(/\brole="([^"]*)"/)?.[1] ?? null,
    });
  }
  return out;
}

/**
 * The two CSS mechanisms that take list semantics away.
 *
 * `list-style: none` is the documented one. `display: flex` and `display: grid`
 * are the second, and they are easy to miss: replacing a list's box removes
 * its list box just as removing its markers does. Either alone is enough for
 * some screen readers to stop announcing a list.
 */
const STRIPS_LIST =
  /(^|;)\s*(list-style(-type)?\s*:\s*[^;]*\bnone\b|display\s*:\s*(inline-)?(flex|grid))/;

/**
 * Selectors that strip list semantics, split into the two ways they can match.
 *
 * Only the LAST compound selector is read, because that is the one describing
 * the element the rule lands on. Ancestor constraints are deliberately not
 * modelled: honouring them would need a DOM, and dropping them can only ever
 * OVER-report — a list in the same component scope that the rule does not in
 * fact reach. An over-report is a visible failure rather than a silent gap.
 */
export function listStrippingSelectors(css: string): {
  classes: Set<string>;
  scopedTags: Set<string>;
} {
  const classes = new Set<string>();
  const scopedTags = new Set<string>();
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectors, block] = rule;
    if (!STRIPS_LIST.test(block!)) continue;
    for (const selector of selectors!.split(",")) {
      const compound =
        selector
          .trim()
          .split(/[\s>+~]+/)
          .pop() ?? "";
      const named = [...compound.matchAll(/\.([A-Za-z0-9_-]+)/g)].map(
        (cls) => cls[1]!,
      );
      for (const cls of named) classes.add(cls);
      const tag = /^(ul|ol)\b/.exec(compound)?.[1];
      if (tag !== undefined && named.length === 0) {
        const scopes = [
          ...compound.matchAll(/\[(data-astro-cid-[A-Za-z0-9_-]+)\]/g),
        ].map((scope) => scope[1]!);
        // A bare `ul { … }` with no scope reaches every list on the page.
        if (scopes.length === 0) scopedTags.add(`${tag}@*`);
        for (const scope of scopes) scopedTags.add(`${tag}@${scope}`);
      }
    }
  }
  return { classes, scopedTags };
}

/** Does this page's CSS take the list semantics off this element? */
export function stripsListSemantics(
  element: ListElement,
  stripping: ReturnType<typeof listStrippingSelectors>,
): boolean {
  if (element.classes.some((cls) => stripping.classes.has(cls))) return true;
  if (stripping.scopedTags.has(`${element.tag}@*`)) return true;
  return element.scopes.some((scope) =>
    stripping.scopedTags.has(`${element.tag}@${scope}`),
  );
}

/**
 * Every list whose CSS removes its semantics without `role="list"` restoring
 * them.
 *
 * The contract is structural, not a count. Putting the attribute on seventeen
 * elements and asserting nothing afterwards means the whole fix can be
 * reverted with every gate still green. What this asserts is the property:
 * **a list styled so a screen reader stops announcing it as a list must say
 * that it is one.** A list that keeps its markers needs no role and is not
 * reported.
 *
 * Reported per element kind, not per page: the same component on eighteen
 * pages is one defect.
 */
export function checkListSemantics(pages: readonly Page[]): Finding[] {
  const offenders = new Map<string, Set<string>>();
  for (const page of pages) {
    const stripping = listStrippingSelectors(page.css);
    for (const element of listElements(page.html)) {
      if (!stripsListSemantics(element, stripping)) continue;
      if (element.role === "list") continue;
      const key =
        element.classes.length === 0
          ? element.tag
          : `${element.tag}.${element.classes.join(".")}`;
      if (!offenders.has(key)) offenders.set(key, new Set());
      offenders.get(key)!.add(page.file);
    }
  }
  return [...offenders]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, files]) =>
      error(
        "lists",
        "*",
        key,
        `<${key}> is styled so it stops being announced as a list on ${files.size} page(s), e.g. ${[...files].sort()[0]} — it needs an explicit role="list" to restore what the CSS removed`,
      ),
    );
}

/* ------------------------------------------------------------------ */
/* Skip-link target                                                    */
/* ------------------------------------------------------------------ */

/** Elements that can take focus with no `tabindex` of their own. */
const NATIVELY_FOCUSABLE = /^(a|button|input|select|textarea|summary|iframe)$/;

/**
 * The element each skip link points at can actually receive focus.
 *
 * The build audit already asserts that the target EXISTS and is the `main`
 * landmark. Existing is not the same as being focusable, and the difference is
 * the whole defect: `href="#main"` on a plain `<main>` moves the scroll
 * position and leaves focus on the link, so the next Tab returns to the second
 * item of the navigation the user was trying to skip. `tabindex` is what makes
 * the jump real.
 *
 * The skip link is found by its `href="#…"` plus the class the layout gives
 * it. `skip` in a class name is the convention every layout in this kit uses;
 * a project that renames it renames the pattern here too.
 */
const SKIP_LINK =
  /<a[^>]*class="[^"]*\bskip[a-z-]*\b[^"]*"[^>]*href="#([^"]+)"/;

export function checkSkipTarget(pages: readonly Page[]): Finding[] {
  const findings: Finding[] = [];
  for (const page of pages) {
    const link = SKIP_LINK.exec(page.html);
    if (link === null) continue; // no skip link — not this check's question
    const id = link[1]!;
    const target = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bid="${id}"[^>]*>`).exec(
      page.html,
    );
    if (target === null) continue; // an absent target is the build audit's finding
    const [element, tag] = target;
    if (NATIVELY_FOCUSABLE.test(tag!) || /\btabindex="/.test(element)) continue;
    findings.push(
      error(
        "skip-link",
        page.file,
        `unfocusable:${id}`,
        `the skip link targets #${id}, which is a <${tag}> with no tabindex — activating it moves the scroll position and leaves focus behind, so the next Tab goes back into the navigation the link was meant to skip`,
      ),
    );
  }
  return findings;
}

/** `<nav>…</nav>` regions, matched non-greedily. */
function navRegions(html: string): string[] {
  return [...html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)].map(
    (match) => match[1]!,
  );
}

/** A site route as the file the build would emit for it. */
export function routeToFile(href: string): string {
  const clean = href.split(/[?#]/)[0]!.replace(/^\//, "");
  if (clean === "") return "index.html";
  if (clean.endsWith(".html")) return clean;
  return `${clean.replace(/\/$/, "")}/index.html`;
}
