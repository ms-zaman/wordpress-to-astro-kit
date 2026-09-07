// Which routes the digest records.
//
// ## Why a sample
//
// The digest records every element of every page at two viewports, and the
// baselines are committed, because the diff IS the review. A site of thirty
// pages is a few megabytes and that is fine. A migrated blog of 250 posts
// takes it to hundreds of files and tens of megabytes, changing on every
// build, and the run itself from minutes to far longer — one page load per
// route per viewport.
//
// What that buys is 250 near-identical recordings of ONE template. A post's
// structure comes from one route module, and the thing a digest catches is
// that module moving.
//
// So a family is SAMPLED. The same principle the review map states — "a
// reviewer reviews the template, not each of the pages it emits" — applied to
// the machine that reads the pages.
//
// ## What a family is, and why it is not a path prefix
//
// The template that generated the page, read from the build's own route
// inventory (`dist/deployment.json`, `routes.inventory[].source`). Not a list
// of path prefixes: this kit's URLs come from `migration.config.ts`, so posts
// may live at `/%postname%/` with no prefix at all, and a prefix list would
// either miss them or swallow every top-level page along with them.
//
// The manifest already knows the answer, because the route table built it.
//
// ## Why these particular members
//
// Deterministic, and deliberately not "the first N": the first, the last, and
// evenly spaced picks between them, taken from the family's own sorted order.
// That spreads across the alphabet and, because slugs are stable, produces the
// same set on every run — a sample that reshuffled would make every digest
// diff unreadable, which is the one thing this file must not do.
//
// A page ADDED to or REMOVED from a family still moves the sample, and that is
// correct: the set of pages is part of what the digest records.
import { readInventory } from "../lib/manifest.ts";

/** How many pages of one template family the digest records. */
export const SAMPLE_SIZE = 6;

/**
 * Route origins that are never sampled, however many pages they produce.
 *
 * A `static` route has a module of its own — `/`, `/404`, `/search` — so there
 * is nothing to sample down to: each one IS its own template. `archive` and
 * `pagination` are here because the ends of a paginated set differ
 * structurally — page one and the last page render different controls — and a
 * sample that dropped one end would stop watching the case that breaks.
 */
const NEVER_SAMPLED: readonly string[] = ["static", "archive", "pagination"];

/** The manifest records `/about`; a built route is `/about/`. */
const servablePath = (routePath: string): string =>
  routePath === "/" ? "/" : `${routePath.replace(/\/$/, "")}/`;

/**
 * Route path to the template that generates it, from a build's own manifest.
 *
 * An empty map when there is no readable manifest, which makes `digestRoutes`
 * record everything. That is the safe direction: a digest that records too
 * much is slow, and one that silently records too little is a gate with a hole
 * in it.
 */
export function templatesIn(distDirectory: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of readInventory(distDirectory)) {
    if (row.kind !== "page") continue;
    if (NEVER_SAMPLED.includes(row.origin)) continue;
    map.set(servablePath(row.path), row.source);
  }
  return map;
}

/**
 * Evenly spaced indices across `length`, always including the first and last.
 *
 * `count >= length` returns everything, so a family smaller than the sample is
 * recorded whole rather than padded.
 */
export function sampleIndices(length: number, count: number): number[] {
  if (length <= count) return Array.from({ length }, (unused, index) => index);
  if (count <= 1) return [0];
  const step = (length - 1) / (count - 1);
  return Array.from({ length: count }, (unused, index) =>
    Math.round(index * step),
  );
}

/**
 * The routes to digest: every route, with each sampled family reduced.
 *
 * Pure and total — hand it the route list and the family map and it returns a
 * subset, so the selection is testable without a browser or a build.
 */
export function digestRoutes(
  routes: readonly string[],
  templates: ReadonlyMap<string, string>,
  sampleSize: number = SAMPLE_SIZE,
): string[] {
  const families = new Map<string, string[]>();
  const kept: string[] = [];

  for (const route of routes) {
    const family = templates.get(route);
    if (family === undefined) kept.push(route);
    else families.set(family, [...(families.get(family) ?? []), route]);
  }

  for (const members of families.values()) {
    const sorted = [...members].sort();
    for (const index of sampleIndices(sorted.length, sampleSize))
      kept.push(sorted[index]!);
  }

  return [...new Set(kept)].sort();
}
