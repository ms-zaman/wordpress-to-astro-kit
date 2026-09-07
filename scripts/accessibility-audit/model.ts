// The pure models the accessibility audit reasons with: colour contrast
// between token pairs, heading outlines, and landmark sets.
//
// Separated from `rules.ts` because these three answer questions that have
// nothing to do with a build directory — hand them a string and they answer —
// and because that is what makes them testable by handing them a page shape
// they have never seen.
//
// **The HTML readers are regex readers, not a parser.** `dist/` is emitted by
// one generator from components in this repository, so the shapes they match
// are the shapes Astro emits. Pointed at arbitrary HTML they would be wrong,
// and they are never pointed at any.

/* ------------------------------------------------------------------ */
/* Colour and contrast                                                 */
/* ------------------------------------------------------------------ */

/** A colour, as the 0–255 channel values a hex token parses to. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * WCAG 2.1 §1.4.3 and §1.4.11 thresholds.
 *
 * `body` is the 4.5:1 normal-text ratio. `large` is 3:1 and applies only at
 * 18.66px bold or 24px regular and above. `nonText` is the 3:1 ratio for a UI
 * boundary or a focus indicator.
 */
export const WCAG_AA = {
  body: 4.5,
  large: 3,
  nonText: 3,
} as const;

/** Which threshold a pair is judged against. */
export type ContrastUse = keyof typeof WCAG_AA;

/** `#rrggbb` or `#rgb` to channels. `undefined` for anything else. */
export function parseHex(value: string): Rgb | undefined {
  const hex = value.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return undefined;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(color: Rgb): number {
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  );
}

/**
 * The contrast ratio between two hex colours, unrounded.
 *
 * Order-independent by construction — `(lighter + 0.05) / (darker + 0.05)` —
 * so a pair cannot be recorded backwards and read as a different number.
 * Throws on an unparseable colour rather than returning a plausible ratio for
 * a value nobody meant.
 */
export function contrastRatio(foreground: string, background: string): number {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (fg === undefined) throw new Error(`not a hex colour: ${foreground}`);
  if (bg === undefined) throw new Error(`not a hex colour: ${background}`);
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** A ratio at the two decimals every contrast report in this kit quotes. */
export const roundRatio = (ratio: number): number =>
  Math.round(ratio * 100) / 100;

/** Token name (without the `--color-` prefix) to hex value. */
export type Palette = Readonly<Record<string, string>>;

/**
 * The CSS named colours a minifier can substitute for a six-digit hex.
 *
 * A CSS minifier rewrites a colour to whichever form is SHORTER, so any named
 * colour that beats the hex it stands for replaces it in the shipped
 * stylesheet. The list below is MEASURED, not reasoned: it is the set a
 * current Lightning CSS actually emits.
 *
 * It was reasoned once and the reasoning was wrong. The note used to say that
 * names losing to a three-digit hex — `white`, `black`, `red`, `blue` — could
 * never appear, which holds for three of those four and not for `red`:
 * `#ff0000` minifies to `red`, three characters against `#f00`'s four.
 *
 * The failure this prevents is worse than it looks. A token shipped as `snow`
 * dropped out of the palette ENTIRELY under a hex-only parser, so the audit
 * measured no contrast against it and reported it as missing rather than as
 * unparsed. The throw in `parsePalette` is the other half of that fix: a
 * declaration this cannot read must stop the run, never quietly vanish.
 */
const NAMED_COLOURS: Readonly<Record<string, string>> = {
  azure: "#f0ffff",
  beige: "#f5f5dc",
  bisque: "#ffe4c4",
  brown: "#a52a2a",
  coral: "#ff7f50",
  gold: "#ffd700",
  gray: "#808080",
  green: "#008000",
  indigo: "#4b0082",
  ivory: "#fffff0",
  khaki: "#f0e68c",
  linen: "#faf0e6",
  maroon: "#800000",
  navy: "#000080",
  olive: "#808000",
  orange: "#ffa500",
  orchid: "#da70d6",
  peru: "#cd853f",
  pink: "#ffc0cb",
  plum: "#dda0dd",
  purple: "#800080",
  red: "#ff0000",
  salmon: "#fa8072",
  sienna: "#a0522d",
  silver: "#c0c0c0",
  snow: "#fffafa",
  tan: "#d2b48c",
  teal: "#008080",
  tomato: "#ff6347",
  violet: "#ee82ee",
  wheat: "#f5deb3",
};

/**
 * The colour tokens declared in a stylesheet, read from the CSS itself.
 *
 * Reading rather than restating is the whole point: a contrast baseline built
 * from values copied into TypeScript would keep passing after someone edited
 * `tokens.css`, which is precisely the regression this exists to catch.
 *
 * WordPress core's preset palette (`--wp-preset-*`) is deliberately outside
 * the `--color-` namespace and so is not read here: those are constants core
 * assigns to preset classes inside migrated bodies, not this site's design.
 */
export function parsePalette(css: string): Palette {
  const palette: Record<string, string> = {};
  for (const match of css.matchAll(
    /--color-([a-z0-9-]+)\s*:\s*([^;}]+?)\s*[;}]/g,
  )) {
    const token = match[1]!;
    const raw = match[2]!.toLowerCase();
    const value = raw.startsWith("#") ? raw : NAMED_COLOURS[raw];
    if (value === undefined || parseHex(value) === undefined)
      throw new Error(
        `parsePalette: --color-${token} is "${match[2]}", which is neither a ` +
          "hex colour nor a named colour this knows. A palette token that " +
          "cannot be read must fail here rather than drop silently out of the " +
          "contrast audit — add it to NAMED_COLOURS or author it as hex.",
      );
    palette[token] = value;
  }
  return palette;
}

/** One foreground/background pair the site actually composites. */
export interface ContrastPair {
  /** Stable id, so a report and a test name the same row. */
  readonly id: string;
  /** Colour token name, without the `--color-` prefix. */
  readonly foreground: string;
  readonly background: string;
  /** Which WCAG threshold applies. */
  readonly use: ContrastUse;
  /** Where this pair is rendered, for a reader who has to go look. */
  readonly where: string;
}

/**
 * Every token pair the kit's own components composite.
 *
 * Derived by reading the component stylesheets, not by enumerating the
 * palette: a pair no component renders is a ratio nobody has to decide about.
 * `use` records the size the pair is rendered AT — which is what decides
 * whether 4.5:1 or 3:1 is the bar, and it is the single most consequential
 * judgement in this table.
 *
 * **This table is yours to extend.** Every component you add that composites a
 * new pair belongs here, or its ratio is unmeasured. What this cannot do is
 * tell you which ground an element is actually ON — that needs a layout
 * engine, and `scripts/contrast-audit` is the half that has one.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  {
    id: "body-on-background",
    foreground: "text",
    background: "background",
    use: "body",
    where: "Body text on the page ground — every paragraph on the site",
  },
  {
    id: "body-on-surface",
    foreground: "text",
    background: "surface",
    use: "body",
    where: "Text inside a Card and inside a surface Section",
  },
  {
    id: "body-on-surface-band",
    foreground: "text",
    background: "surface-band",
    use: "body",
    where: "Text on a full-bleed tinted band",
  },
  {
    id: "muted-on-background",
    foreground: "text-muted",
    background: "background",
    use: "body",
    where: "Every date line, every card summary, the footer's scope statement",
  },
  {
    id: "muted-on-surface",
    foreground: "text-muted",
    background: "surface",
    use: "body",
    where: "Muted text inside a Card",
  },
  {
    id: "inverse-on-primary",
    foreground: "text-inverse",
    background: "primary",
    use: "body",
    where: "Button variant primary, at rest — the most-rendered filled control",
  },
  {
    id: "inverse-on-primary-strong",
    foreground: "text-inverse",
    background: "primary-strong",
    use: "body",
    where: "Button variant primary, on hover",
  },
  {
    id: "inverse-on-secondary",
    foreground: "text-inverse",
    background: "secondary",
    use: "body",
    where: "Text on the dark band",
  },
  {
    id: "link-on-background",
    foreground: "link",
    background: "background",
    use: "body",
    where: "Every link at body size: prose, navigation, the footer",
  },
  {
    id: "link-on-surface",
    foreground: "link",
    background: "surface",
    use: "body",
    where:
      "A link inside a Card — the pair `--color-link` exists for, separately from `--color-primary`, because a fill and a text colour need different floors",
  },
  {
    id: "control-border-on-background",
    foreground: "border-interactive",
    background: "background",
    use: "nonText",
    where:
      "The boundary of an input, a select and the menu toggle — §1.4.11, so 3:1 and not 4.5:1",
  },
  {
    id: "control-border-on-surface",
    foreground: "border-interactive",
    background: "surface",
    use: "nonText",
    where: "The same control boundaries inside a Card",
  },
  {
    // `--focus-color` indirects to `--color-primary`, so the ring's ratio IS
    // this pair. `parsePalette` skips the indirection (it is not a literal
    // colour), which is why the pair names the token it resolves to. Repoint
    // `--focus-color` and this row has to move with it.
    id: "focus-ring-on-background",
    foreground: "primary",
    background: "background",
    use: "nonText",
    where:
      "The design system's one focus ring (packages/ui/src/foundation/focus.css, via --focus-color) — the indicator a keyboard user navigates by",
  },
  {
    id: "focus-ring-on-surface",
    foreground: "primary",
    background: "surface",
    use: "nonText",
    where: "The same ring drawn on a control inside a Card",
  },
  {
    id: "error-on-background",
    foreground: "error",
    background: "background",
    use: "body",
    where: "A form's validation message",
  },
  {
    id: "success-on-background",
    foreground: "success",
    background: "background",
    use: "body",
    where: "A form's success message",
  },
  {
    id: "warning-on-background",
    foreground: "warning",
    background: "background",
    use: "body",
    where: "A form's warning message",
  },
];

/** One pair, measured against its threshold. */
export interface ContrastResult {
  readonly id: string;
  readonly foreground: string;
  readonly background: string;
  readonly use: ContrastUse;
  readonly ratio: number;
  readonly threshold: number;
  readonly passes: boolean;
}

/**
 * Measure one pair against a palette.
 *
 * Throws when the palette has no such token: a pair naming a token that was
 * renamed must fail loudly, not silently drop out of the audit.
 */
export function evaluatePair(
  palette: Palette,
  pair: ContrastPair,
): ContrastResult {
  const foreground = palette[pair.foreground];
  const background = palette[pair.background];
  if (foreground === undefined)
    throw new Error(`${pair.id}: no --color-${pair.foreground} in the palette`);
  if (background === undefined)
    throw new Error(`${pair.id}: no --color-${pair.background} in the palette`);
  const ratio = roundRatio(contrastRatio(foreground, background));
  return {
    id: pair.id,
    foreground: pair.foreground,
    background: pair.background,
    use: pair.use,
    ratio,
    threshold: WCAG_AA[pair.use],
    // `>=` on the ROUNDED ratio, deliberately: a pair at 4.497 is reported as
    // 4.5 everywhere in this kit, and a table that prints 4.5 next to "fails"
    // is a table nobody trusts.
    passes: ratio >= WCAG_AA[pair.use],
  };
}

/** Every pair, measured, in table order. */
export function contrastReport(
  palette: Palette,
  pairs: readonly ContrastPair[] = CONTRAST_PAIRS,
): ContrastResult[] {
  return pairs.map((pair) => evaluatePair(palette, pair));
}

/** Only the pairs that miss their threshold, in table order. */
export function contrastFailures(
  palette: Palette,
  pairs: readonly ContrastPair[] = CONTRAST_PAIRS,
): ContrastResult[] {
  return contrastReport(palette, pairs).filter((result) => !result.passes);
}

/* ------------------------------------------------------------------ */
/* Heading outline                                                     */
/* ------------------------------------------------------------------ */

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The heading levels in a page, in document order.
 *
 * Levels only — not text. What an outline check needs is the sequence, and
 * pulling the text out would invite assertions on copy that belongs to content.
 */
export function headingLevels(html: string): HeadingLevel[] {
  return [...html.matchAll(/<h([1-6])[\s>]/g)].map(
    (match) => Number(match[1]) as HeadingLevel,
  );
}

export type OutlineViolationKind =
  "no-h1" | "multiple-h1" | "skipped-level" | "starts-below-h1";

export interface OutlineViolation {
  readonly kind: OutlineViolationKind;
  /** 0-based position in the heading sequence. `-1` when the page has none. */
  readonly index: number;
  readonly detail: string;
}

/**
 * Everything wrong with one page's heading outline.
 *
 * Four rules, each of which a screen-reader user navigating by heading feels
 * directly:
 *
 *   - **no-h1** — the page has no top-level heading to start from.
 *   - **multiple-h1** — more than one, so "the page heading" is ambiguous.
 *   - **starts-below-h1** — the first heading is not the h1.
 *   - **skipped-level** — a jump of more than one level going down, e.g. an h1
 *     followed by an h3, which reads as a missing section.
 *
 * Going back UP any number of levels is legal and is not reported: h4 to h2 is
 * a new section, not a skip.
 */
export function outlineViolations(
  levels: readonly HeadingLevel[],
): OutlineViolation[] {
  const violations: OutlineViolation[] = [];
  const h1Count = levels.filter((level) => level === 1).length;

  if (levels.length === 0 || h1Count === 0)
    violations.push({ kind: "no-h1", index: -1, detail: "the page has no h1" });

  if (h1Count > 1)
    violations.push({
      kind: "multiple-h1",
      index: levels.indexOf(1, levels.indexOf(1) + 1),
      detail: `${h1Count} h1 elements`,
    });

  if (levels.length > 0 && levels[0] !== 1)
    violations.push({
      kind: "starts-below-h1",
      index: 0,
      detail: `the first heading is an h${levels[0]}`,
    });

  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1]!;
    const current = levels[index]!;
    if (current > previous + 1)
      violations.push({
        kind: "skipped-level",
        index,
        detail: `h${previous} is followed by h${current}`,
      });
  }

  return violations;
}

/** A violation as one line, for a failure message or a report row. */
export const describeViolation = (violation: OutlineViolation): string =>
  `${violation.kind} (${violation.detail})`;

/** Every violation on a page, as a stable comma-joined signature. */
export const outlineSignature = (levels: readonly HeadingLevel[]): string =>
  outlineViolations(levels).map(describeViolation).join(", ");

/* ------------------------------------------------------------------ */
/* Landmarks                                                           */
/* ------------------------------------------------------------------ */

/** The landmark elements this kit emits. */
export const LANDMARK_TAGS = ["header", "nav", "main", "footer"] as const;
export type LandmarkTag = (typeof LANDMARK_TAGS)[number];

export interface Landmark {
  readonly tag: LandmarkTag;
  /** `aria-label` when the element carries one; `undefined` otherwise. */
  readonly label?: string;
}

/**
 * The landmarks in a page, in document order.
 *
 * `<header>` and `<footer>` are counted wherever they appear — nested inside
 * an `<article>` or a `<section>` they are not landmarks at all, and this kit's
 * components emit neither, so the reader does not model the exception. A
 * migrated body that nests one makes this over-count, which shows up as a
 * finding rather than as a silent gap.
 */
export function landmarksOf(html: string): Landmark[] {
  return [...html.matchAll(/<(header|nav|main|footer)(\s[^>]*)?>/g)].map(
    (match) => {
      const attributes = match[2] ?? "";
      const label = /aria-label="([^"]*)"/.exec(attributes);
      return {
        tag: match[1] as LandmarkTag,
        ...(label === null ? {} : { label: label[1] }),
      };
    },
  );
}

export type LandmarkViolationKind =
  | "missing-landmark"
  | "duplicate-landmark"
  | "unnamed-nav"
  | "duplicate-nav-name";

export interface LandmarkViolation {
  readonly kind: LandmarkViolationKind;
  readonly tag: LandmarkTag;
  readonly detail: string;
}

/**
 * Everything wrong with one page's landmark set, against a required list.
 *
 * `required` is a parameter and not a constant because two layouts can
 * legitimately differ: a site page has a header, a main and a footer; a
 * review-only surface has only a main, on purpose. A single hard-coded
 * requirement would force one of the two to be wrong.
 *
 * The nav rules are the ones that matter most in practice: several `<nav>`
 * elements on a page all announce as "navigation", so an unnamed one — or two
 * sharing a name — is a reader hearing the same word three times with nothing
 * to choose between.
 */
export function landmarkViolations(
  landmarks: readonly Landmark[],
  required: readonly LandmarkTag[] = ["main"],
): LandmarkViolation[] {
  const violations: LandmarkViolation[] = [];

  for (const tag of required) {
    const count = landmarks.filter((landmark) => landmark.tag === tag).length;
    if (count === 0)
      violations.push({ kind: "missing-landmark", tag, detail: `no <${tag}>` });
    // Only `main` is singular by specification. A page may hold several navs,
    // and — once components nest them — several headers and footers.
    else if (tag === "main" && count > 1)
      violations.push({
        kind: "duplicate-landmark",
        tag,
        detail: `${count} <main> elements`,
      });
  }

  const navs = landmarks.filter((landmark) => landmark.tag === "nav");
  const unnamed = navs.filter(
    (nav) => nav.label === undefined || nav.label.trim() === "",
  ).length;
  if (unnamed > 0)
    violations.push({
      kind: "unnamed-nav",
      tag: "nav",
      detail: `${unnamed} of ${navs.length} nav landmarks carry no aria-label`,
    });

  const names = navs
    .map((nav) => nav.label)
    .filter((label): label is string => label !== undefined);
  const duplicates = [
    ...new Set(names.filter((name, index) => names.indexOf(name) !== index)),
  ].sort();
  if (duplicates.length > 0)
    violations.push({
      kind: "duplicate-nav-name",
      tag: "nav",
      detail: `nav names used more than once: ${duplicates.join(", ")}`,
    });

  return violations;
}
