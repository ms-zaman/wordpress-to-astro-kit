// Which page builder built the source site, and what that means for reading it.
//
// ## Why this is a table and not a constant
//
// WordPress is not one editor. A marketing site in the wild is built with
// Gutenberg, or Elementor, or Divi, or WPBakery, or Beaver Builder, or the
// classic editor, or two of them in different eras of the same site. The first
// version of this reconciler hard-coded Elementor's four hidden-at-every-width
// classes because Elementor was the site in front of it, and that made the
// tool quietly wrong for every other site: a Gutenberg site got Elementor's
// rules, which match nothing, and a Divi site got no rules at all while the
// report claimed to have removed the unpainted sections.
//
// So the builder is **configuration** (`migration.config.ts`'s `sourceMarkup`),
// the profiles below are what has been MEASURED, and a site whose builder is
// not here declares its own sets rather than getting somebody else's.
//
// ## The rule these profiles obey
//
// A profile only contains class names read off a real stylesheet or a real
// rendered page. Inventing plausible ones is the exact failure this kit warns
// about everywhere else: a wrong marker either deletes real content from the
// comparison (a false pass) or matches nothing (a silent no-op), and both look
// identical in the report.

/**
 * How to read one page builder's markup.
 *
 * `hiddenEverywhere`: class SETS, not classes. An element counts as hidden
 * only when it carries EVERY class in one set, because builders express
 * per-breakpoint hiding as one class per breakpoint and a section that hides
 * at three of four widths still paints at the fourth.
 *
 * `notPartOfThePage`: `[attribute, value]` pairs marking a subtree the
 * document carries but the page is not — a popup, a modal, a drawer.
 */
export interface BuilderProfile {
  readonly name: string;
  readonly hiddenEverywhere: readonly (readonly string[])[];
  readonly notPartOfThePage: readonly (readonly [string, string])[];
  /** What was read to produce this, so a later reader can re-check it. */
  readonly measuredFrom: string;
}

/**
 * Gutenberg — the block editor, WordPress core.
 *
 * **`hiddenEverywhere` is empty, and that is the measurement, not a gap.**
 * WordPress core's block-library stylesheet (10.5.0, 164,935 bytes) contains
 * no responsive-hide utility at all: the only `.hide` rule in it is
 * `.wp-block-image img.hide`, an internal of the image block's lightbox, and
 * there is no `hidden-on-mobile` family of any spelling. Core hides nothing by
 * class, so there is nothing here to drop.
 *
 * If your Gutenberg site hides sections at a breakpoint, the classes come from
 * your theme or a block plugin, not from core — put them in `sourceMarkup`'s
 * own `hiddenEverywhere`, having inspected a section you know is hidden.
 *
 * `screen-reader-text` is core's, and is deliberately NOT listed: it is a real
 * accessible name that a reader genuinely gets, and dropping it would hide a
 * real difference. That is the same ruling the `aria-hidden` rule already
 * makes.
 */
export const GUTENBERG: BuilderProfile = {
  name: "gutenberg",
  hiddenEverywhere: [],
  notPartOfThePage: [],
  measuredFrom: "@wordpress/block-library@10.5.0 build-style/style.css",
};

/**
 * Elementor.
 *
 * The four markers are one per breakpoint, and all four are required: measured
 * on a real site, a support page's FAQ band carried `desktop`, `tablet` and
 * `mobile` but not `laptop`, so it painted at exactly one width and is real
 * content. Treating three as four would have deleted it from the comparison.
 */
export const ELEMENTOR: BuilderProfile = {
  name: "elementor",
  hiddenEverywhere: [
    [
      "elementor-hidden-desktop",
      "elementor-hidden-laptop",
      "elementor-hidden-tablet",
      "elementor-hidden-mobile",
    ],
  ],
  notPartOfThePage: [["data-elementor-type", "popup"]],
  measuredFrom: "a live Elementor 3.x site, 2026-09",
};

/**
 * The builders this kit has NOT measured.
 *
 * Divi, WPBakery and Beaver Builder are named in `content-capture`'s marker
 * table because a wrapper class in a captured body is enough to identify them.
 * Identifying a builder and knowing how it hides a section are different
 * facts, and only the first one has been established here. Rather than ship a
 * guess, the kit names them and says what to do:
 *
 *   1. Open a section you know your source site does not paint at any width.
 *   2. Read the classes off the element that carries the hiding.
 *   3. Put the full set in `sourceMarkup.hiddenEverywhere`.
 *
 * A profile contributed with the page it was read from is welcome.
 */
export const UNMEASURED = ["divi", "wpbakery", "beaver-builder"] as const;

export const PROFILES: readonly BuilderProfile[] = [GUTENBERG, ELEMENTOR];

/** The markup rules for reading one source site. */
export interface SourceMarkup {
  readonly hiddenEverywhere: readonly (readonly string[])[];
  readonly notPartOfThePage: readonly (readonly [string, string])[];
}

/**
 * A subtree that is a dialog is not part of the page, whatever built it.
 *
 * This is a role, not a builder's class: Gutenberg's responsive navigation
 * overlay, Elementor's popup, a theme's search drawer and a plugin's cookie
 * modal all mark themselves the same way, because the accessibility contract
 * says to. It is applied for every configuration, so a site whose builder has
 * no profile still gets the one rule that holds everywhere.
 */
export const DIALOG_IS_NOT_THE_PAGE: readonly (readonly [string, string])[] = [
  ["role", "dialog"],
];

export interface MarkupSelection {
  /** Builder names, matched against `PROFILES`. */
  readonly builders: readonly string[];
  /** Sets this site adds, from its theme or its plugins. */
  readonly hiddenEverywhere?: readonly (readonly string[])[];
  readonly notPartOfThePage?: readonly (readonly [string, string])[];
}

/**
 * The rules for a site, from its configuration.
 *
 * Throws on a builder name with no profile. A typo that silently selected
 * nothing would produce a report that claims to have dropped the hidden
 * sections and did not — the failure mode this whole module exists to prevent,
 * reintroduced one level up.
 */
export function resolveMarkup(selection: MarkupSelection): SourceMarkup {
  const hidden: (readonly string[])[] = [];
  const notPart: (readonly [string, string])[] = [...DIALOG_IS_NOT_THE_PAGE];

  for (const name of selection.builders) {
    const profile = PROFILES.find((candidate) => candidate.name === name);
    if (profile === undefined) {
      const known = PROFILES.map((candidate) => candidate.name).join(", ");
      throw new Error(
        `sourceMarkup.builders names "${name}", which has no profile. ` +
          `Measured: ${known}. Named but not measured: ${UNMEASURED.join(", ")} ` +
          `— for those, read the classes off a section your source site hides ` +
          `and put the set in sourceMarkup.hiddenEverywhere.`,
      );
    }
    hidden.push(...profile.hiddenEverywhere);
    notPart.push(...profile.notPartOfThePage);
  }

  hidden.push(...(selection.hiddenEverywhere ?? []));
  notPart.push(...(selection.notPartOfThePage ?? []));
  return { hiddenEverywhere: hidden, notPartOfThePage: notPart };
}
