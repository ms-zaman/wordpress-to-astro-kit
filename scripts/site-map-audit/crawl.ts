// The live crawl: what does the source site actually publish?
//
// **The sitemap is not the site.** That is the sentence this module exists
// for. Date archives, author archives, tag archives, paginated pages, feeds
// and language prefixes are all live and are usually absent from every
// sitemap a WordPress plugin writes. A migration planned from the sitemap
// alone discovers the rest at cutover, from a 404 log.
//
// So the crawl has three sources and joins them:
//
//   1. **`robots.txt` → sitemaps.** Every WordPress SEO plugin announces its
//      sitemap there, so this is the one discovery step that works whatever
//      the site runs. Index files are followed one level.
//   2. **The front page**, always, whether or not a sitemap names it.
//   3. **Links.** Every same-origin `href` in every HTML body fetched, added
//      to the next wave. Bounded, so a calendar widget cannot turn this into
//      an infinite crawler.
//
// ## What it deliberately does not do
//
// **It runs no browser.** A WordPress site server-renders its navigation, its
// archives and its post bodies, so an HTML read finds the links. A link that
// exists only after JavaScript runs is invisible here, and that is a stated
// limit rather than an oversight — if the source site's menu is client-side,
// note it in `docs/01-discovery/` and seed the crawl by hand.
//
// **It follows no redirect.** A 3xx is recorded with its `location`, because
// an alias is a finding: it tells you the source site already considers that
// URL retired, and it is a redirect row you can carry across for free.
//
// **It fetches no media.** An upload path is recorded and skipped. The audit's
// question is which PAGES exist; downloading the media library to answer it
// would be both slow and rude.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { migration } from "../../migration.config.ts";
import {
  PoliteReader,
  isPlaceholderUserAgent,
  requireLiveOrigin,
  settingsFromConfig,
} from "./fetch.ts";
import {
  readSitemap,
  SITEMAP_FALLBACKS,
  sitemapsInRobots,
} from "./sitemaps.ts";
import { classifyFamily, comparisonKey, type Family } from "./urls.ts";

export interface UrlRecord {
  url: string;
  key: string;
  family: Family;
  sources: string[];
  fetched: boolean;
  status?: number;
  location?: string;
  canonical?: string;
  contentType?: string;
  error?: string;
  /** Why it was recorded and not fetched. */
  skipped?: string;
}

export interface CrawlOptions {
  /** Stop after this many requests. A bound, not a target. */
  readonly maxRequests?: number;
  /** How many link-following waves past the seeds. */
  readonly waves?: number;
  /** Called with a one-line progress note. */
  readonly onProgress?: (line: string) => void;
}

const CANONICAL =
  /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']|<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i;
const ANCHOR = /<a\s[^>]*href=["']([^"'#][^"']*)["']/gi;

/**
 * Recorded, never fetched, with the reason.
 *
 * Each of these is a URL the inventory should KNOW about — leaving it out
 * would make the site look smaller — and that nothing is learned by
 * downloading.
 */
export function skipReason(
  key: string,
  languagePrefixes: readonly string[],
): string | null {
  const [path = key, query] = key.split("?");
  if (query !== undefined && query !== "") return "query-variant";
  if (
    /\.(png|jpe?g|webp|avif|gif|svg|css|js|mjs|woff2?|ico|mp4|webm|pdf|zip|docx?|xlsx?)$/i.test(
      path,
    )
  )
    return "media-asset";
  if (/^\/(wp-admin|wp-json|wp-login\.php|xmlrpc\.php)/.test(path))
    return "wp-runtime";
  if (/^\/wp-content\//.test(path) || /^\/wp-includes\//.test(path))
    return "wp-asset";
  if (path !== "/feed/" && path.endsWith("/feed/")) return "per-page-feed";
  const first = path.split("/").filter(Boolean)[0];
  // A language ROOT is fetched, because how many translated pages exist is
  // worth knowing. Every page under it is not: a translated corpus can be as
  // large as the site again, and the decision about it is one decision.
  if (
    first !== undefined &&
    languagePrefixes.includes(first) &&
    path !== `/${first}/`
  )
    return "translated-deep-page";
  return null;
}

export interface CrawlResult {
  readonly origin: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly requests: number;
  readonly records: readonly UrlRecord[];
  readonly notes: readonly string[];
}

/**
 * Crawl the configured source site.
 *
 * Throws only when there is no origin to crawl. Everything else — a 403, a
 * timeout, an empty sitemap — is RECORDED, because the shape of the failure is
 * itself the finding, and `integrityFindings` in `diff.ts` is what refuses to
 * report a gap count over a bad inventory.
 */
export async function crawlLiveSite(
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const origin = requireLiveOrigin();
  const settings = settingsFromConfig();
  const languagePrefixes = migration.liveLanguagePrefixes;
  const maxRequests = options.maxRequests ?? 2000;
  const waves = options.waves ?? 2;
  const progress = options.onProgress ?? (() => {});
  const notes: string[] = [];

  if (isPlaceholderUserAgent(settings.userAgent))
    notes.push(
      "crawl.userAgent is still the kit's placeholder. An operator reading " +
        "their access log cannot tell who this is or how to ask you to stop — " +
        "set it in migration.config.ts before crawling anybody else's site.",
    );

  const reader = new PoliteReader(settings);
  const records = new Map<string, UrlRecord>();

  const note = (url: string, source: string): UrlRecord | null => {
    const key = comparisonKey(url, origin);
    if (key === null) return null;
    const existing = records.get(key);
    if (existing !== undefined) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return existing;
    }
    const record: UrlRecord = {
      url: new URL(key, origin).toString(),
      key,
      family: classifyFamily(key),
      sources: [source],
      fetched: false,
    };
    records.set(key, record);
    return record;
  };

  // --- Seed 1: robots.txt and the sitemaps it advertises --------------------

  progress(`reading ${origin}/robots.txt`);
  const robots = await reader.get(`${origin}/robots.txt`);
  let sitemapUrls =
    robots.body === undefined ? [] : sitemapsInRobots(robots.body);
  if (robots.status === 403 || robots.status === 429)
    notes.push(
      `robots.txt answered ${robots.status}. That is a firewall or a rate limiter ` +
        "deciding this request looks like a bot, and it is worth knowing BEFORE the " +
        "capture tools start their tighter loops: pace them, and never retry into it.",
    );
  if (sitemapUrls.length === 0) {
    notes.push(
      `robots.txt advertised no sitemap (status ${robots.status}); trying ${SITEMAP_FALLBACKS.join(" and ")}`,
    );
    sitemapUrls = SITEMAP_FALLBACKS.map((suffix) => `${origin}${suffix}`);
  }

  // `attempted` is not `read`.
  //
  // Measured on a real site: `robots.txt` advertised `/sitemap_index.xml`, that
  // URL answered **404 with a 115KB HTML error page**, and this loop reported
  // "1 sitemap document(s) read". Three things combined to produce a claim the
  // crawl could not support — the set was incremented BEFORE the fetch, the
  // only check was `body === undefined` (a 404 page has a body), and a document
  // with no `<loc>` contributed nothing without saying so.
  //
  // Discovery is the first stage, so a false claim here is the worst kind: the
  // fallback link-crawl is bounded on purpose, and a reader who believes the
  // sitemap was read has no reason to look at the small number of URLs it
  // found. The counts below are of documents that answered 200 AND parsed as a
  // sitemap, and every other outcome is stated.
  const attemptedSitemaps = new Set<string>();
  const readSitemaps = new Set<string>();
  const queue = [...sitemapUrls];
  while (queue.length > 0 && reader.requests < maxRequests) {
    const url = queue.shift()!;
    if (attemptedSitemaps.has(url)) continue;
    attemptedSitemaps.add(url);
    progress(`sitemap ${url}`);
    const response = await reader.get(url);
    if (response.status !== 200) {
      notes.push(
        `sitemap ${url} answered ${response.status}, so it was NOT read. ` +
          "The URL a site advertises and the URL it serves are different " +
          "facts; discovery below fell back to following links, which is " +
          "bounded and will not find a page nothing links to.",
      );
      continue;
    }
    if (response.body === undefined) {
      notes.push(`sitemap ${url} returned ${response.status} and no body`);
      continue;
    }
    const document = readSitemap(response.body);
    if (!document.isIndex && document.locations.length === 0) {
      notes.push(
        `sitemap ${url} answered 200 but holds no <loc> elements — it is not a ` +
          "sitemap. A soft 404 that serves an HTML error page with status 200 " +
          "looks exactly like this.",
      );
      continue;
    }
    readSitemaps.add(url);
    if (document.isIndex) {
      // One level of nesting. Deeper is a sitemap index of sitemap indexes,
      // which no WordPress plugin writes, and following arbitrarily deep is
      // how a bound stops being a bound.
      for (const location of document.locations) queue.push(location);
      continue;
    }
    for (const location of document.locations)
      note(location, `sitemap:${new URL(url).pathname}`);
  }
  notes.push(
    `${readSitemaps.size} sitemap document(s) read of ${attemptedSitemaps.size} attempted`,
  );
  if (readSitemaps.size === 0)
    notes.push(
      "NO SITEMAP WAS READ. Every URL below was found by following links from " +
        "the site's own pages, which reaches only what is linked and only as " +
        "deep as `--waves` allows. Treat this inventory as a floor, not a " +
        "census: check the source's own counts with `pnpm content:census`.",
    );

  // --- Seed 2: the front page, always ---------------------------------------
  note(`${origin}/`, "seed");

  // --- Waves: fetch what is known, learn what it links to -------------------

  let stoppedAtBound = false;
  for (let wave = 0; wave <= waves && !stoppedAtBound; wave += 1) {
    const pending = [...records.values()].filter(
      (record) => !record.fetched && record.skipped === undefined,
    );
    if (pending.length === 0) break;
    progress(`wave ${wave}: ${pending.length} URL(s) to read`);

    for (const record of pending) {
      if (reader.requests >= maxRequests) {
        // The bound ends the CRAWL, not just this wave. Continuing into the
        // next one would re-report the same stop with the same number.
        stoppedAtBound = true;
        notes.push(
          `stopped at the ${maxRequests}-request bound with ${
            [...records.values()].filter((entry) => !entry.fetched).length
          } URL(s) unfetched — raise --max-requests for a complete inventory`,
        );
        break;
      }
      const skip = skipReason(record.key, languagePrefixes);
      if (skip !== null) {
        record.skipped = skip;
        continue;
      }

      const response = await reader.get(record.url);
      record.fetched = true;
      record.status = response.status;
      if (response.location !== undefined) record.location = response.location;
      if (response.contentType !== undefined)
        record.contentType = response.contentType;
      if (response.error !== undefined) record.error = response.error;

      if (response.body === undefined) continue;
      if (!/text\/html/i.test(response.contentType ?? "")) continue;

      const canonical = CANONICAL.exec(response.body);
      const href = canonical?.[1] ?? canonical?.[2];
      if (href !== undefined) record.canonical = href;

      // The last wave reads statuses but adds nothing, so the inventory never
      // ends with a tier of URLs nobody fetched.
      if (wave === waves) continue;
      for (const match of response.body.matchAll(ANCHOR))
        note(match[1]!, `link:${record.key}`);
    }
  }

  const unfetched = [...records.values()].filter(
    (record) => !record.fetched && record.skipped === undefined,
  );
  if (unfetched.length > 0)
    notes.push(
      `${unfetched.length} URL(s) were discovered in the last wave and not fetched. ` +
        "Raise --waves if the inventory should be complete rather than bounded.",
    );

  return {
    origin,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    requests: reader.requests,
    records: [...records.values()].sort((left, right) =>
      left.key.localeCompare(right.key),
    ),
    notes,
  };
}

/**
 * Write an inventory into the evidence directory, dated.
 *
 * Dated because a crawl is a MEASUREMENT of a site at a moment, and the
 * commonest way evidence goes bad is a default path that keeps pointing at a
 * superseded capture while everybody calls it "the crawl". Two crawls a month
 * apart are two directories.
 */
export function writeInventory(
  repositoryRoot: string,
  result: CrawlResult,
): string {
  const day = result.startedAt.slice(0, 10);
  const directory = path.join(
    repositoryRoot,
    migration.evidenceDir,
    `site-map-${day}`,
  );
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "live-inventory.json");
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        crawl: {
          origin: result.origin,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          requests: result.requests,
          userAgent: migration.crawl.userAgent,
          delayMs: migration.crawl.delayMs,
          notes: result.notes,
        },
        records: result.records,
      },
      null,
      2,
    )}\n`,
  );
  return file;
}
