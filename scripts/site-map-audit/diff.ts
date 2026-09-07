// The bidirectional diff and its classification rules. Pure: inventories in,
// rows out, no filesystem and no network.
//
// ## The one number this exists to drive to zero
//
// `GAP`: the source site serves this URL, the build publishes nothing at it,
// no redirect covers it, and nobody has ruled that it is deliberately gone.
//
// PLAYBOOK.md §7 step 1 states the rule this enforces: **every live URL is a
// page, a redirect, or a recorded decision to retire it. There is no fourth
// category.** `GAP` is the fourth category, so the audit fails while any
// remains.
//
// ## Why a redirect target is checked against `dist/`
//
// A redirect row pointing at a route the build does not generate is worse than
// no redirect: it turns a 404 into a redirect chain that ends in a 404, and it
// looks handled in every report. So a live URL is only `REDIRECT` when its
// target is actually in the local inventory; otherwise the row stays a `GAP`
// and says why.
import {
  classifyFamily,
  INFRASTRUCTURE_FAMILIES,
  type ClassifyOptions,
  type Family,
} from "./urls.ts";
import type { LocalRecord } from "./local.ts";

export interface LiveRecord {
  /** The public URL exactly as the source site serves it. */
  readonly url: string;
  /** Comparison key (see `urls.ts`). */
  readonly key: string;
  /** Where this URL was discovered: a sitemap, a rendered link, a seed. */
  readonly sources: readonly string[];
  /** The HTTP status, when the crawl reached it. */
  readonly status?: number;
  /** The `location` header on a 3xx, verbatim and unfollowed. */
  readonly location?: string;
  /** `<link rel="canonical">`, when captured. */
  readonly canonical?: string;
}

export type Classification =
  /** Both sides publish this key. */
  | "MATCH"
  /** A redirect rule or splat covers it, and its target exists. */
  | "REDIRECT"
  /** A family somebody ruled deliberately absent. */
  | "RETIRED"
  /** WordPress's own surface, which a static successor has no equivalent for. */
  | "INFRASTRUCTURE"
  /** Live serves it and nothing here accounts for it. THE number. */
  | "GAP"
  /** This build publishes it and live does not. */
  | "LOCAL_ONLY";

export interface DiffRow {
  readonly key: string;
  readonly family: Family;
  readonly classification: Classification;
  readonly live?: LiveRecord;
  readonly local?: LocalRecord;
  /** For a redirect row: where it goes. */
  readonly redirectTarget?: string;
  /** Why the row got its classification. A citation or a measurement. */
  readonly reason: string;
}

/** A redirect table, in the shape `deployment/redirects.ts` parses. */
export interface RedirectLike {
  readonly rules: readonly { from: string; to: string }[];
  readonly splats: readonly { prefix: string }[];
}

/**
 * Families a project has ruled deliberately absent, with the ruling.
 *
 * **Empty by default, and that is the point.** "We are not carrying the tag
 * archives" is a decision with an owner and a consequence for search, not a
 * default. Fill this in from `decisions/ADR/` as those rulings are made, and
 * every row here becomes a line in the report saying who decided and why.
 *
 * Retiring a family is not free: a URL that answered yesterday and 404s
 * tomorrow loses whatever ranking and inbound links it had. Prefer a redirect.
 */
export type RetiredFamilies = ReadonlyMap<Family, string>;

export const NOTHING_RETIRED: RetiredFamilies = new Map();

export interface DiffOptions extends ClassifyOptions {
  readonly redirects?: RedirectLike;
  readonly retired?: RetiredFamilies;
}

const NO_REDIRECTS: RedirectLike = { rules: [], splats: [] };

/** Strip the trailing slash the comparison key adds, the way a rule stores it. */
const asRedirectPath = (key: string): string => {
  const path = key.split("?")[0] ?? key;
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
};

export interface DiffResult {
  readonly rows: readonly DiffRow[];
  readonly counts: Readonly<Record<Classification, number>>;
  readonly byFamily: Readonly<Record<string, number>>;
}

/**
 * Join the two inventories and classify every key on either side.
 *
 * Total: every live key and every local key produces exactly one row, so the
 * counts always sum to the size of the union. A row that fell out of the
 * classifier would be a URL nobody had to account for, which is the failure
 * this whole tool is written against.
 */
export function diffInventories(
  live: readonly LiveRecord[],
  local: readonly LocalRecord[],
  options: DiffOptions = {},
): DiffResult {
  const redirects = options.redirects ?? NO_REDIRECTS;
  const retired = options.retired ?? NOTHING_RETIRED;
  const classify = (key: string): Family => classifyFamily(key, options);

  // A redirect stub is a route the build emits FOR a retired URL. It is not a
  // page of the site, so it must not make a live URL read as `MATCH` — the row
  // is a redirect, and saying so is the whole point.
  const localByKey = new Map(local.map((record) => [record.key, record]));
  const localPages = new Set(
    local.filter((record) => !record.redirect).map((record) => record.key),
  );
  const ruleByFrom = new Map(
    redirects.rules.map((rule) => [asRedirectPath(rule.from), rule.to]),
  );

  const rows: DiffRow[] = [];
  const seen = new Set<string>();

  for (const record of live) {
    seen.add(record.key);
    const family = classify(record.key);
    const local = localByKey.get(record.key);

    if (local !== undefined && !local.redirect) {
      rows.push({
        key: record.key,
        family,
        classification: "MATCH",
        live: record,
        local,
        reason: "both sides publish this URL",
      });
      continue;
    }

    const target = ruleByFrom.get(asRedirectPath(record.key));
    if (target !== undefined) {
      const internal = target.startsWith("/");
      const resolved = internal ? `${asRedirectPath(target)}/` : target;
      const exists =
        !internal || localPages.has(resolved) || localPages.has(target);
      rows.push({
        key: record.key,
        family,
        classification: exists ? "REDIRECT" : "GAP",
        live: record,
        ...(local === undefined ? {} : { local }),
        redirectTarget: target,
        reason: exists
          ? `content/redirects.json sends it to ${target}`
          : `content/redirects.json sends it to ${target}, and this build publishes nothing there — a redirect into a 404 reads as handled in every report`,
      });
      continue;
    }

    const splat = redirects.splats.find((entry) =>
      asRedirectPath(record.key).startsWith(asRedirectPath(entry.prefix)),
    );
    if (splat !== undefined) {
      rows.push({
        key: record.key,
        family,
        classification: "REDIRECT",
        live: record,
        reason: `the "${splat.prefix}" splat covers it — only a host can honour a splat, so verify it after cutover`,
      });
      continue;
    }

    const ruling = retired.get(family);
    if (ruling !== undefined) {
      rows.push({
        key: record.key,
        family,
        classification: "RETIRED",
        live: record,
        reason: ruling,
      });
      continue;
    }

    const infrastructure = INFRASTRUCTURE_FAMILIES.get(family);
    if (infrastructure !== undefined) {
      rows.push({
        key: record.key,
        family,
        classification: "INFRASTRUCTURE",
        live: record,
        reason: infrastructure,
      });
      continue;
    }

    rows.push({
      key: record.key,
      family,
      classification: "GAP",
      live: record,
      reason:
        "the source site serves this and the build publishes nothing at it. " +
        "Publish it, redirect it, or record a decision to retire it — there is " +
        "no fourth answer",
    });
  }

  for (const record of local) {
    if (seen.has(record.key)) continue;
    // A redirect stub is not a page this build "also" publishes; it exists
    // because live had the URL, and it is already accounted for above.
    if (record.redirect) continue;
    rows.push({
      key: record.key,
      family: classify(record.key),
      classification: "LOCAL_ONLY",
      local: record,
      reason:
        "this build publishes it and the crawl did not find it on the source " +
        "site — a new page, or a URL shape that moved",
    });
  }

  rows.sort((left, right) => left.key.localeCompare(right.key));

  const counts: Record<Classification, number> = {
    MATCH: 0,
    REDIRECT: 0,
    RETIRED: 0,
    INFRASTRUCTURE: 0,
    GAP: 0,
    LOCAL_ONLY: 0,
  };
  const byFamily: Record<string, number> = {};
  for (const row of rows) {
    counts[row.classification] += 1;
    byFamily[row.family] = (byFamily[row.family] ?? 0) + 1;
  }

  return {
    rows,
    counts,
    byFamily: Object.fromEntries(
      Object.entries(byFamily).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

/**
 * Reasons the DATA cannot be trusted, as distinct from findings about the site.
 *
 * These fail the run before any gap count is reported, because a gap count
 * computed from a bad inventory is worse than no count: it looks like a
 * measurement. The firewall case is the one that motivated this — a crawl
 * taken while `wp-json` was blocked returns a smaller, entirely plausible site.
 */
export function integrityFindings(
  live: readonly LiveRecord[],
  local: readonly LocalRecord[],
  diff: DiffResult,
): string[] {
  const findings: string[] = [];

  if (live.length === 0)
    findings.push(
      "the live inventory is empty — the crawl found nothing, which is not a site",
    );
  if (local.length === 0)
    findings.push("the local inventory is empty — run `pnpm build` first");

  const unreached = live.filter((record) => record.status === undefined);
  if (unreached.length > 0)
    findings.push(
      `${unreached.length} live URL(s) were discovered and never fetched, so their status is unknown: ` +
        `${unreached
          .slice(0, 3)
          .map((record) => record.key)
          .join(", ")}`,
    );

  const failed = live.filter((record) => record.status === 0);
  if (failed.length > 0)
    findings.push(
      `${failed.length} request(s) never completed. A timeout or a reset is not a 404, and an inventory ` +
        "missing them is smaller than the site: wait, then run the crawl again rather than retrying into it",
    );

  const forbidden = live.filter(
    (record) => record.status === 403 || record.status === 429,
  );
  if (forbidden.length > 0)
    findings.push(
      `${forbidden.length} URL(s) answered 403 or 429. That is rate limiting or a firewall, not the site's ` +
        "shape — an inventory captured now is FALSE and looks fine. Wait it out; retrying deepens it",
    );

  const rowKeys = new Set(diff.rows.map((row) => row.key));
  const union = new Set([
    ...live.map((record) => record.key),
    ...local.filter((record) => !record.redirect).map((record) => record.key),
  ]);
  if (rowKeys.size !== union.size)
    findings.push(
      `the diff produced ${rowKeys.size} row(s) for ${union.size} distinct key(s) — a URL fell out of the ` +
        "classifier, which means one was not accounted for at all",
    );

  return findings;
}

/**
 * Notes about the CONFIG rather than about the site.
 *
 * The classifier is only ever as good as `permalinks`, and the commonest way
 * to misuse this tool is to point it at a site while `migration.config.ts`
 * still carries the kit's defaults. The result is not an error: it is a report
 * where almost everything reads `page`, which looks like an answer.
 *
 * Measured on a real site: with the kit's default `/%postname%/`, 1660 of 1777
 * URLs classified as `page`, because that site publishes posts at
 * `/blog/<slug>/` and `%pagename%` matches slashes. Setting
 * `permalinks.post` to `/blog/%postname%/` classified them correctly.
 *
 * So when most of the site lands in the families that mean "this pattern
 * matched by default", say so, and name the prefixes that would fix it.
 */
export function configurationNotes(diff: DiffResult): string[] {
  const notes: string[] = [];
  const classified = diff.rows.filter(
    (row) =>
      row.classification !== "INFRASTRUCTURE" && row.family !== "front-page",
  );
  if (classified.length < 20) return notes;

  const vague = classified.filter(
    (row) =>
      row.family === "page" ||
      row.family === "entry" ||
      row.family === "unknown",
  );
  if (vague.length * 2 <= classified.length) return notes;

  // The prefixes those URLs share, which are what a permalink pattern would
  // name. Two segments deep, because `/blog/category/` is as much a shape as
  // `/blog/`.
  const prefixes = new Map<string, number>();
  for (const row of vague) {
    const segments = (row.key.split("?")[0] ?? "").split("/").filter(Boolean);
    if (segments.length < 2) continue;
    for (const depth of [1, 2]) {
      if (segments.length <= depth) continue;
      const prefix = `/${segments.slice(0, depth).join("/")}/`;
      prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
    }
  }
  const common = [...prefixes]
    .filter(([, count]) => count >= 5)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 5);

  notes.push(
    `${vague.length} of ${classified.length} URL(s) classified as page, entry or ` +
      "unknown, which is what happens when `permalinks` in migration.config.ts " +
      "does not describe the site being crawled. Set it from the source site's " +
      "Settings > Permalinks before reading this report as a measurement.",
  );
  if (common.length > 0)
    notes.push(
      "The prefixes those URLs share, which a permalink pattern would name: " +
        common.map(([prefix, count]) => `${prefix} (${count})`).join(", "),
    );
  return notes;
}
