// The redirect map — URL continuity for every live URL this build does not
// publish at the same path.
//
// `content/redirects.json` is the data; this module is the model. Three
// consumers read it through here and must never disagree about a row:
//
//   1. `astro.config.mjs` turns every rule into an Astro redirect, so a
//      static host with no redirect support of its own still answers each
//      retired URL with a meta-refresh page pointing at the target.
//   2. The same config writes `dist/_redirects` (the Netlify / Cloudflare
//      Pages format) and `dist/redirects.json` (host-agnostic), so a host that
//      CAN answer with a real 301 has the table in a form it reads.
//   3. `render-contract/build-audit.ts` checks every internal target against
//      the pages the build actually produced, so a target that stops being
//      generated fails the build instead of chaining into a 404.
//
// Two kinds of row. A RULE is one path to one destination, and the build
// materialises it. A SPLAT is a prefix — a language prefix a translation
// plugin serves thousands of URLs under — and only a host can honour one,
// because a static build cannot enumerate what falls under it.
import { sitePath } from "../routing/url-shape.ts";

export type RedirectStatus = 301 | 302;

export interface RedirectRule {
  /** Root-relative, no trailing slash, no query string. */
  readonly from: string;
  /** Root-relative (same normalisation) or an absolute `https://` URL. */
  readonly to: string;
  readonly status: RedirectStatus;
  /** Why the row exists — grouped in reports. */
  readonly family: string;
  readonly note?: string;
}

export interface RedirectSplat {
  /** The prefix, root-relative, no trailing slash: `/fr`. */
  readonly prefix: string;
  readonly status: RedirectStatus;
  readonly family: string;
  readonly note?: string;
}

export interface RedirectMap {
  readonly rules: readonly RedirectRule[];
  readonly splats: readonly RedirectSplat[];
}

const ABSOLUTE = /^https?:\/\/[^\s]+$/;

export function normalizeRedirectPath(value: string): string {
  if (!value.startsWith("/"))
    throw new Error(`redirect path "${value}" must be root-relative`);
  if (value.includes("?") || value.includes("#"))
    throw new Error(
      `redirect path "${value}" carries a query or fragment; a redirect row is a path`,
    );
  const trimmed = value.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const status = (value: unknown, where: string): RedirectStatus => {
  if (value === 301 || value === 302) return value;
  throw new Error(`${where}: status must be 301 or 302, got ${String(value)}`);
};

/** Parse and validate the JSON file. Throws on the first malformed row. */
export function parseRedirectMap(json: unknown): RedirectMap {
  if (!isRecord(json) || !Array.isArray(json.rules))
    throw new Error("redirects.json: expected an object with a `rules` array");
  const rules = json.rules.map((raw, index): RedirectRule => {
    const where = `redirects.json rules[${index}]`;
    if (!isRecord(raw)) throw new Error(`${where}: not an object`);
    if (typeof raw.from !== "string" || typeof raw.to !== "string")
      throw new Error(`${where}: from and to must be strings`);
    if (typeof raw.family !== "string" || raw.family === "")
      throw new Error(`${where}: family is required`);
    // The TARGET carries the site's one URL shape — a trailing slash — so a
    // redirect lands on the canonical URL in one hop. The SOURCE stays
    // slashless: it is a route key and a literal record of the live path.
    const to = ABSOLUTE.test(raw.to)
      ? raw.to
      : sitePath(normalizeRedirectPath(raw.to));
    return {
      from: normalizeRedirectPath(raw.from),
      to,
      status: status(raw.status, where),
      family: raw.family,
      ...(typeof raw.note === "string" ? { note: raw.note } : {}),
    };
  });
  const splatsRaw = Array.isArray(json.splats) ? json.splats : [];
  const splats = splatsRaw.map((raw, index): RedirectSplat => {
    const where = `redirects.json splats[${index}]`;
    if (!isRecord(raw) || typeof raw.prefix !== "string")
      throw new Error(`${where}: prefix must be a string`);
    if (typeof raw.family !== "string" || raw.family === "")
      throw new Error(`${where}: family is required`);
    const prefix = normalizeRedirectPath(raw.prefix);
    if (prefix === "/") throw new Error(`${where}: a splat cannot be the root`);
    return {
      prefix,
      status: status(raw.status, where),
      family: raw.family,
      ...(typeof raw.note === "string" ? { note: raw.note } : {}),
    };
  });
  return { rules, splats };
}

export interface RedirectFinding {
  readonly rule: RedirectRule;
  readonly problem:
    | "duplicate-source"
    | "self-redirect"
    | "source-is-published"
    | "target-not-published"
    | "target-is-a-source";
}

/**
 * Everything wrong with a map against the set of published paths (trailing
 * slashes stripped, `/` for the root). Empty means every rule resolves in one
 * hop to a page that exists — or to another host.
 */
export function redirectFindings(
  map: RedirectMap,
  published: ReadonlySet<string>,
): RedirectFinding[] {
  const findings: RedirectFinding[] = [];
  const sources = new Map<string, number>();
  for (const rule of map.rules)
    sources.set(rule.from, (sources.get(rule.from) ?? 0) + 1);
  for (const rule of map.rules) {
    if ((sources.get(rule.from) ?? 0) > 1)
      findings.push({ rule, problem: "duplicate-source" });
    if (rule.to.startsWith("/") && rule.from === normalizeRedirectPath(rule.to))
      findings.push({ rule, problem: "self-redirect" });
    if (published.has(rule.from))
      findings.push({ rule, problem: "source-is-published" });
    if (rule.to.startsWith("/")) {
      const target = normalizeRedirectPath(rule.to);
      if (sources.has(target))
        findings.push({ rule, problem: "target-is-a-source" });
      else if (!published.has(target))
        findings.push({ rule, problem: "target-not-published" });
    }
  }
  return findings;
}

/** The `redirects` value `astro.config.mjs` hands to Astro. */
export function toAstroRedirects(
  map: RedirectMap,
): Record<string, { status: RedirectStatus; destination: string }> {
  const out: Record<string, { status: RedirectStatus; destination: string }> =
    {};
  for (const rule of map.rules)
    out[rule.from] = { status: rule.status, destination: rule.to };
  return out;
}

/**
 * The `_redirects` file Netlify and Cloudflare Pages read. Rules first, then
 * the splats: hosts match top-down, and a splat placed above a rule would
 * swallow it.
 */
export function toNetlifyRedirects(map: RedirectMap): string {
  const lines = [
    "# Generated from content/redirects.json — edit the JSON, not this file.",
    ...map.rules.map((rule) => `${rule.from} ${rule.to} ${rule.status}`),
    ...map.splats.map((splat) => `${splat.prefix}/* /:splat ${splat.status}`),
  ];
  return `${lines.join("\n")}\n`;
}

/** A host-agnostic JSON copy of the same table. */
export function toRedirectsJson(map: RedirectMap): string {
  return `${JSON.stringify(
    {
      rules: map.rules.map(({ from, to, status }) => ({ from, to, status })),
      splats: map.splats.map(({ prefix, status }) => ({
        prefix,
        strip: true,
        status,
      })),
    },
    null,
    2,
  )}\n`;
}

/** Rows grouped by family, for reports. */
export function countByFamily(map: RedirectMap): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rule of map.rules)
    counts[rule.family] = (counts[rule.family] ?? 0) + 1;
  for (const splat of map.splats)
    counts[splat.family] = (counts[splat.family] ?? 0) + 1;
  return counts;
}
