/**
 * @wpk/tokens — typed entry point.
 *
 * Token VALUES live in tokens.css as CSS custom properties. This module
 * carries only what custom properties cannot serve: breakpoints (invalid
 * inside media queries) and the raw layout numbers derived from the same
 * measurements.
 */

/**
 * Viewport breakpoints in px.
 *
 * PROVISIONAL: these are Elementor's default breakpoints (767 / 1024), which
 * is what most WordPress sites in the wild render with. Measure yours and
 * replace them; `docs/01-discovery/presentation-layer.md` is where the
 * measurement is recorded.
 */
export const breakpoints = {
  /** Max width of the mobile viewport range. */
  mobile: 767,
  /** Max width of the tablet viewport range. */
  tablet: 1024,
} as const;

export type Breakpoint = keyof typeof breakpoints;

/** Boxed CONTENT container width in px. PROVISIONAL — measure the live site's. */
export const containerMaxWidth = 1200;

/**
 * Ready-made media-query condition strings for component styles or
 * `window.matchMedia`. Mobile and tablet ranges are max-width based.
 */
export const mediaQueries = {
  mobile: `(max-width: ${breakpoints.mobile}px)`,
  tablet: `(max-width: ${breakpoints.tablet}px)`,
  aboveTablet: `(min-width: ${breakpoints.tablet + 1}px)`,
} as const;
