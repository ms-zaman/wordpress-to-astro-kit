// migration.config.ts — the one file that says which WordPress site this
// project migrates FROM and how its URLs map onto this build.
//
// What reads it TODAY: the Astro app, for the permalink structure
// (`permalinks`) and the media origin (`liveOrigin`). Nothing else in the kit
// names the source site, so a kit configured for a different site is this
// file and the content it produces — not a fork.
//
// What does NOT read it yet: `evidenceDir`, `crawl`, `liveLanguagePrefixes`
// and `routePairs` are the settings of the capture, crawl and reconciliation
// tools, which are on the roadmap (README, "What is here, and what is not
// yet") and not in this release. They are declared here so the shape is
// settled and so a project can fill them in before the tools land — but a
// value in one of them changes nothing today. The kit says so rather than
// letting a field that nothing reads look like a feature.
//
// `pnpm kit:init` writes the origins. Everything else is yours to edit.

/**
 * The URL structure, in WordPress's own vocabulary (Settings → Permalinks).
 *
 * The default below is WordPress's default for a site with a static front
 * page and a posts page at `/blog/`. A site that shows its latest posts on the
 * front page is `frontPage: null` and `postsIndex: "/"`. Every other structure
 * WordPress offers is a pattern here:
 *
 *   "Day and name"    post: "/%year%/%monthnum%/%day%/%postname%/"
 *   "Month and name"  post: "/%year%/%monthnum%/%postname%/"
 *   "Post name"       post: "/%postname%/"
 *   under a prefix    post: "/blog/%postname%/"
 *   with a category   post: "/%category%/%postname%/"
 *
 * Keep the LIVE site's structure: URL preservation is the migration's first
 * SEO requirement, and a redirect is only for a URL that genuinely changes.
 */
export interface Permalinks {
  /**
   * Post permalink. Tokens: `%postname%`, `%year%`, `%monthnum%`, `%day%`,
   * `%category%` (the first category's slug), `%author%` (the author's
   * nicename).
   */
  readonly post: string;
  /** Page permalink. `%pagename%` expands to the page's hierarchy path (`parent/child`). */
  readonly page: string;
  /** Category archive. Token: `%slug%`. WordPress: `/category/%slug%/`. */
  readonly category: string;
  /** Tag archive. Token: `%slug%`. WordPress: `/tag/%slug%/`. */
  readonly tag: string;
  /** Author archive. Token: `%nicename%`. WordPress: `/author/%nicename%/`. */
  readonly author: string;
  /** Where the posts listing lives. `/` when the front page shows posts. */
  readonly postsIndex: string;
  /** The segment paginated archives use: `/blog/page/2/`. WordPress: `page`. */
  readonly paginationSegment: string;
  /**
   * The `pages` entry rendered at `/`, by slug — or `null` when the front page
   * is the posts listing. A front page is not ALSO published at its own
   * `%pagename%` path.
   */
  readonly frontPage: string | null;
  /** WordPress `posts_per_page`. Default 10. */
  readonly postsPerPage: number;
}

export interface CrawlSettings {
  /** Delay between page requests, in milliseconds. Polite by construction. */
  readonly delayMs: number;
  /**
   * Delay between REST media requests. A capture that reads one media row per
   * post is the one loop that hits the source site hundreds of times in a
   * row, and a firewall that notices will block `wp-json` for the better part
   * of two hours while pages stay 200 — an inventory taken in that window is
   * false. Pace it; never retry into it.
   */
  readonly mediaDelayMs: number;
  /**
   * How the crawler identifies itself. Honest identification with a contact:
   * the capture tools refuse to run while this still says to set it.
   */
  readonly userAgent: string;
}

export interface RoutePair {
  /** The route on this build — `/pricing`. */
  readonly route: string;
  /** The saved crawl of the live page, relative to the repository root. */
  readonly live: string;
  /** The built file, relative to `apps/website/dist/`. */
  readonly ours: string;
}

export interface MigrationConfig {
  /**
   * The WordPress site being migrated: scheme and host, no trailing slash.
   * `undefined` until `pnpm kit:init --live-origin` (or you) sets it. The
   * capture tools refuse to run without it; the media seam passes uploads
   * through unchanged without it.
   */
  readonly liveOrigin: string | undefined;
  /**
   * Language prefixes the live site serves translated URLs under (`/fr`,
   * `/de`), when a translation plugin publishes them. Each becomes a splat
   * redirect row until the translated corpus is migrated — a static build
   * cannot enumerate what falls under a prefix, only a host can honour one.
   */
  readonly liveLanguagePrefixes: readonly string[];
  readonly permalinks: Permalinks;
  /** Where captures and crawls are stored, relative to the repository root. */
  readonly evidenceDir: string;
  readonly crawl: CrawlSettings;
  /**
   * Live page ↔ built page pairs for content reconciliation ("does our page
   * SAY what live's page says?"). Empty until a page is built.
   */
  readonly routePairs: readonly RoutePair[];
}

export const migration: MigrationConfig = {
  liveOrigin: undefined,
  liveLanguagePrefixes: [],
  permalinks: {
    post: "/%postname%/",
    page: "/%pagename%/",
    category: "/category/%slug%/",
    tag: "/tag/%slug%/",
    author: "/author/%nicename%/",
    postsIndex: "/blog/",
    paginationSegment: "page",
    frontPage: "home",
    postsPerPage: 10,
  },
  evidenceDir: "research",
  crawl: {
    delayMs: 1500,
    mediaDelayMs: 120,
    userAgent:
      "site-migration-discovery/0.1 (contact: set crawl.userAgent in migration.config.ts)",
  },
  routePairs: [],
};
