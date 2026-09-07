// Review map: what each route in this site is FOR, where its content comes
// from, which components assemble it, and what a reviewer should decide.
//
// It is code and not only a document because a route map in Markdown goes
// stale the first time a route is added and nothing notices. Here the
// rendering contract checks the map against the route inventory in BOTH
// directions — a documented route that no longer exists fails, and an emitted
// route nothing documents fails too.
//
// Paths are configuration (`migration.config.ts`), so template rows address
// routes by what they COVER rather than by a literal path.

/** What a map row covers: one fixed path, or every route of one origin. */
export type RouteCoverage = "static" | "page" | "post" | "archive";

export interface ReviewRoute {
  readonly covers: RouteCoverage;
  /** For `static`: the exact path. Absent on template rows. */
  readonly path?: string;
  readonly label: string;
  readonly purpose: string;
  readonly contentSource: string;
  readonly components: readonly string[];
  readonly reviewPoints: readonly string[];
  readonly limitations: readonly string[];
}

export const REVIEW_MAP: readonly ReviewRoute[] = [
  {
    covers: "static",
    path: "/",
    label: "Front page",
    purpose:
      "What `/` renders: the page named by `permalinks.frontPage`, or page one of the posts listing when `postsIndex` is `/`.",
    contentSource:
      "content/pages/<frontPage>.md, or the posts collection (migration.config.ts)",
    components: ["BaseLayout", "ContentPage | ArchivePage"],
    reviewPoints: [
      "Does the front page match the live site's front page — the same page, or the same listing?",
    ],
    limitations: [],
  },
  {
    covers: "static",
    path: "/search",
    label: "Search",
    purpose:
      "The discovery surface. A typed query runs in the browser against the static index at /search-index.json; the form is a real GET, so ?q= works without script.",
    contentSource: "the content index (every post and page)",
    components: ["BaseLayout", "SearchForm", "search island"],
    reviewPoints: [
      "Results for a word that appears in a post title, and for one that does not.",
    ],
    limitations: ["noindex in every environment."],
  },
  {
    covers: "static",
    path: "/404",
    label: "Not found",
    purpose: "What a static host serves for a path no route generated.",
    contentSource: "none",
    components: ["BaseLayout", "SearchForm"],
    reviewPoints: ["The ways out reach real pages."],
    limitations: ["noindex in every environment."],
  },
  {
    covers: "page",
    label: "Page",
    purpose:
      "One page per `pages` entry, at its `%pagename%` path, under its parent where it has one.",
    contentSource: "content/pages/*.md",
    components: ["BaseLayout", "ContentPage", "Prose", "FormEmbed?"],
    reviewPoints: [
      "The body says what the live page says, word for word.",
      "A page with a `form` renders the form, and the form says whether it sends.",
    ],
    limitations: [],
  },
  {
    covers: "post",
    label: "Post",
    purpose: "One page per `posts` entry, at its permalink.",
    contentSource: "content/posts/*.md",
    components: ["BaseLayout", "PostPage", "ImageBlock", "Prose"],
    reviewPoints: [
      "Featured image, date, categories, tags and author link to real archives.",
      "Related posts are related by a shared category or tag, visibly.",
    ],
    limitations: [],
  },
  {
    covers: "archive",
    label: "Archive",
    purpose:
      "The posts index and every category, tag and author archive, paginated at `postsPerPage`.",
    contentSource: "the posts collection, filtered by the registry row",
    components: ["BaseLayout", "ArchivePage", "PostList", "PaginationNav"],
    reviewPoints: [
      "Page one is the archive's own URL; page two is under the pagination segment.",
      "An empty archive renders its empty state rather than failing the build.",
    ],
    limitations: [],
  },
];

/**
 * A route as the inventory describes one, for the coverage check.
 *
 * `kind` is read as well as `origin` because the map covers PAGES — the
 * things a person opens and walks. A build artifact (`/sitemap.xml`,
 * `/deployment.json`) is emitted, audited and never reviewed by eye, so it
 * is not a gap in a review map.
 */
export interface CoveredRoute {
  readonly path: string;
  readonly origin: string;
  readonly kind: string;
}

const coverageOf = (origin: string): RouteCoverage | undefined =>
  origin === "static"
    ? "static"
    : origin === "page" || origin === "post"
      ? origin
      : origin === "archive" || origin === "pagination"
        ? "archive"
        : undefined;

/** Routes the map does not cover, and rows that cover nothing. */
export function coverageGaps(routes: readonly CoveredRoute[]): {
  readonly undocumented: string[];
  readonly unused: string[];
} {
  const undocumented: string[] = [];
  const used = new Set<ReviewRoute>();
  for (const route of routes) {
    if (route.kind !== "page") continue;
    const coverage = coverageOf(route.origin);
    if (coverage === undefined) continue;
    const row = REVIEW_MAP.find((candidate) =>
      candidate.covers === "static"
        ? coverage === "static" && candidate.path === route.path
        : candidate.covers === coverage,
    );
    if (row === undefined) undocumented.push(route.path);
    else used.add(row);
  }
  const unused = REVIEW_MAP.filter((row) => !used.has(row)).map(
    (row) => row.path ?? `[${row.covers}]`,
  );
  return { undocumented, unused };
}
