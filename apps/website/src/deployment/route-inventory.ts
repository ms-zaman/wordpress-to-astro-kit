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
  readonly kind: "page" | "post" | "archive";
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
    const origin: RouteOrigin =
      route.kind === "archive"
        ? (route.page ?? 1) > 1
          ? "pagination"
          : "archive"
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

/** Paths claimed by more than one route. Empty is the only correct answer. */
export function duplicatePaths(routes: readonly InventoryRoute[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const route of routes) {
    if (seen.has(route.path)) duplicates.add(route.path);
    seen.add(route.path);
  }
  return [...duplicates].sort();
}
