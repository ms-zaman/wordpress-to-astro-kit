// Route inventory: every path this build publishes and the file each one
// lands at in `dist/`. It is what makes a deployment checkable without a host —
// a manifest that names its own output can be compared against that output,
// and the comparison finds a route that stopped being generated.
//
// Built from the SAME route table the pages use (`routing/resolver.ts`), so
// it cannot disagree with them without one of them throwing.
//
// Pure — no `astro:content`, no filesystem. The Astro coupling lives in
// `src/pages/deployment.json.ts`.
import type { ContentId } from "./content-identity.ts";
import { routeKey } from "../routing/url-shape.ts";

export { routeKey };

/** The path a deployment manifest is published at. */
export const DEPLOYMENT_MANIFEST_PATH = "/deployment.json";
export const SEARCH_ROUTE = "/search";
export const SEARCH_INDEX_PATH = "/search-index.json";
export const NOT_FOUND_ROUTE = "/404";
export const SITEMAP_ROUTE = "/sitemap.xml";
export const ROBOTS_ROUTE = "/robots.txt";
export const MEDIA_MANIFEST_PATH = "/media-manifest.json";
export const REDIRECTS_JSON_PATH = "/redirects.json";
export const NETLIFY_REDIRECTS_PATH = "/_redirects";

/** What a host serves for this route. */
export type RouteKind = "page" | "data" | "redirect";

/** Where the route's existence comes from. */
export type RouteOrigin =
  /** A fixed path with a module of its own — `/`, `/search`, `/404`. */
  | "static"
  /** One page per `pages` entry. */
  | "page"
  /** One page per `posts` entry. */
  | "post"
  /** Page one of an archive: the posts index, a category, a tag, an author. */
  | "archive"
  /** Page 2..N of an archive. */
  | "pagination"
  /** One entry of a custom post type. */
  | "custom"
  /** Page one of a custom type's listing. */
  | "custom-archive"
  /** Page one of a custom taxonomy term's archive. */
  | "taxonomy-archive"
  /** A retired URL answered with a meta-refresh page (`content/redirects.json`). */
  | "redirect";

export interface InventoryRoute {
  /** Root-relative, trailing-slash-free (except `/` itself). */
  readonly path: string;
  /** The emitted file, relative to `dist/`. */
  readonly file: string;
  readonly kind: RouteKind;
  readonly origin: RouteOrigin;
  /** The route module that generates it, relative to the website package. */
  readonly source: string;
  /**
   * The content this route was generated FROM — `posts/hello-world@en`.
   *
   * Absent for a static route and a redirect, which come from a module and a
   * rules file rather than from content. Present for everything else, and the
   * content-integrity gate treats a missing one as a defect: a route derived
   * from content that cannot name its source is a route nothing can prove
   * arrived.
   */
  readonly entry?: ContentId;
}

/** A resolved route, as the route table describes one. */
export interface ResolvedRouteSummary {
  readonly path: string;
  readonly kind:
    | "page"
    | "post"
    | "archive"
    | "custom"
    | "custom-archive"
    | "taxonomy-archive";
  /** For an archive: which page of it. */
  readonly page?: number;
  /** The content identity behind it. */
  readonly entry?: ContentId;
}

export interface InventoryInput {
  readonly resolved: readonly ResolvedRouteSummary[];
  /** The redirect rules the build materialises, by source path. */
  readonly redirects?: readonly { readonly from: string }[];
  /**
   * The content behind `/`, when a page or the posts listing backs it.
   *
   * `/` is a STATIC route — `src/pages/index.astro` renders it whatever the
   * content says — so the front page is not a resolved route of its own and
   * adding one collides. But something usually produces what it shows, and
   * without naming it here that entry looks like it never arrived.
   */
  readonly frontPageEntry?: ContentId;
}

/**
 * The `dist/` file Astro emits for an HTML route: directory-style output
 * (`build.format: "directory"`, Astro's default), with the two exceptions the
 * framework makes — the site root is `index.html`, and `/404` is `404.html`.
 */
export function pageFileFor(path: string): string {
  if (path === "/") return "index.html";
  if (path === "/404") return "404.html";
  return `${path.replace(/^\//, "")}/index.html`;
}

/** The `dist/` file for a JSON endpoint: the path, minus its leading slash. */
export function dataFileFor(path: string): string {
  return path.replace(/^\//, "");
}

const page = (
  rawPath: string,
  origin: RouteOrigin,
  source: string,
  entry?: ContentId,
): InventoryRoute => ({
  path: routeKey(rawPath),
  file: pageFileFor(routeKey(rawPath)),
  kind: "page",
  origin,
  source,
  ...(entry === undefined ? {} : { entry }),
});

const data = (rawPath: string, source: string): InventoryRoute => ({
  path: routeKey(rawPath),
  file: dataFileFor(routeKey(rawPath)),
  kind: "data",
  origin: "static",
  source,
});

/** The fixed routes — every path that exists whether or not any content does. */
export const STATIC_ROUTES: readonly InventoryRoute[] = [
  page("/", "static", "src/pages/index.astro"),
  page(SEARCH_ROUTE, "static", "src/pages/search.astro"),
  page(NOT_FOUND_ROUTE, "static", "src/pages/404.astro"),
  data(SEARCH_INDEX_PATH, "src/pages/search-index.json.ts"),
  data(DEPLOYMENT_MANIFEST_PATH, "src/pages/deployment.json.ts"),
  data(SITEMAP_ROUTE, "src/pages/sitemap.xml.ts"),
  data(ROBOTS_ROUTE, "src/pages/robots.txt.ts"),
  data(MEDIA_MANIFEST_PATH, "src/pages/media-manifest.json.ts"),
  data(REDIRECTS_JSON_PATH, "astro.config.mjs (redirect artifacts)"),
  data(NETLIFY_REDIRECTS_PATH, "astro.config.mjs (redirect artifacts)"),
] as const;

const RESOLVER_SOURCE = "src/pages/[...path].astro";

/**
 * Every route this build publishes, ordered by path so two builds of the same
 * content produce byte-identical inventories.
 */
export function buildRouteInventory(input: InventoryInput): InventoryRoute[] {
  const routes: InventoryRoute[] = STATIC_ROUTES.map((route) =>
    route.path === "/" && input.frontPageEntry !== undefined
      ? { ...route, entry: input.frontPageEntry }
      : route,
  );

  for (const route of input.resolved) {
    // Page 2..N of ANY listing is `pagination`, custom or not: the origin says
    // how the route came to exist, and "page three of a listing" is one answer
    // whichever collection it lists.
    const listing =
      route.kind === "archive" ||
      route.kind === "custom-archive" ||
      route.kind === "taxonomy-archive";
    const origin: RouteOrigin = listing
      ? (route.page ?? 1) > 1
        ? "pagination"
        : route.kind === "archive"
          ? "archive"
          : route.kind
      : route.kind;
    routes.push(page(route.path, origin, RESOLVER_SOURCE, route.entry));
  }

  for (const rule of input.redirects ?? [])
    routes.push({
      path: rule.from,
      file: pageFileFor(rule.from),
      kind: "redirect",
      origin: "redirect",
      source: "content/redirects.json",
    });

  return sortInventory(routes);
}

export function sortInventory(
  routes: readonly InventoryRoute[],
): InventoryRoute[] {
  return [...routes].sort((left, right) => left.path.localeCompare(right.path));
}

export interface RouteCounts {
  readonly total: number;
  readonly pages: number;
  readonly data: number;
  readonly redirects: number;
  readonly byOrigin: Readonly<Record<RouteOrigin, number>>;
}

export function countRoutes(routes: readonly InventoryRoute[]): RouteCounts {
  const byOrigin: Record<RouteOrigin, number> = {
    static: 0,
    page: 0,
    post: 0,
    archive: 0,
    pagination: 0,
    custom: 0,
    "custom-archive": 0,
    "taxonomy-archive": 0,
    redirect: 0,
  };
  for (const route of routes) byOrigin[route.origin] += 1;

  return {
    total: routes.length,
    pages: routes.filter((route) => route.kind === "page").length,
    data: routes.filter((route) => route.kind === "data").length,
    redirects: routes.filter((route) => route.kind === "redirect").length,
    byOrigin,
  };
}

/**
 * Paths claimed by more than one route. Empty is the only correct answer.
 *
 * Compared through `routeKey`, not verbatim. `/about` and `/about/` are one
 * page on a static host and one file on disk, so two rows carrying those two
 * spellings are a contest — and this is a VALIDATOR, which may be handed a
 * manifest written by something other than `buildRouteInventory`. Comparing
 * the raw strings would have called them distinct and let two claimants share
 * one output.
 */
export function duplicatePaths(routes: readonly InventoryRoute[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const route of routes) {
    const key = routeKey(route.path);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort();
}

// ---------------------------------------------------------------------------
// Claimants — no anonymous route, and no exemption dressed as one.
// ---------------------------------------------------------------------------

/**
 * What owns a route.
 *
 * Every route in the inventory has exactly one of these, and the point of the
 * union is that "static" and "redirect" stop being EXEMPTIONS and become
 * answers. The content-integrity gate used to skip those two origins with a
 * set called `CONTENT_FREE_ORIGINS`, which is true and also means a route
 * could be unattributable simply by claiming to be static.
 *
 * Now the question is total: a route either names the content it publishes,
 * the module that renders it, or the rule that retired it — and `undefined` is
 * a finding rather than a category.
 */
export type RouteClaim =
  /** Published from an entry or a registry row. */
  | { readonly by: "content"; readonly local: ContentId }
  /** Rendered by a route module of its own — `/`, `/search`, `/404`, the JSON endpoints. */
  | { readonly by: "module"; readonly module: string }
  /** A retired URL, from a rule in `content/redirects.json`. */
  | { readonly by: "redirect"; readonly from: string };

/**
 * The claimant of one route, or `undefined` when it has none.
 *
 * `undefined` happens for exactly one shape: a content-derived route whose
 * identity was never attached. That is a real defect — a page nothing can be
 * asked about — and it is the one case Part 7 of the provenance contract
 * refuses to let pass as "probably this entry".
 */
export function claimOf(route: {
  readonly path: string;
  readonly origin: string;
  readonly entry?: ContentId;
  readonly source?: string;
}): RouteClaim | undefined {
  if (route.origin === "redirect") return { by: "redirect", from: route.path };
  if (route.entry !== undefined) return { by: "content", local: route.entry };
  if (
    route.origin === "static" &&
    route.source !== undefined &&
    route.source !== ""
  )
    return { by: "module", module: route.source };
  return undefined;
}
