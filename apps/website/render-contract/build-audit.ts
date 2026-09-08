// Build-output audit — the half of the rendering contract that only exists
// after a build. It reads `dist/` and asserts the pages the route table
// promised were actually emitted, with the head the launch switch decided,
// and that the build follows the contract of the environment it was built
// for. It never runs a build itself: `pnpm render:build-audit` builds first.
//
// Under `WPK_SITE_ENV=production` it additionally refuses a build that still
// carries sample content. That is the gate that keeps the kit's own pages
// from ever becoming somebody's site.
//
// Node 24 baseline, no dependency.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { validateManifest } from "../src/deployment/manifest.ts";
import { parseRedirectMap } from "../src/deployment/redirects.ts";
import { pageFileFor } from "../src/deployment/route-inventory.ts";
import {
  robotsDirective,
  sitemapIncludes,
  type SiteEnvironment,
} from "../src/deployment/site-environment.ts";
import { siteOrigin } from "../src/rendering/site-identity.ts";
import { routeKey } from "../src/routing/url-shape.ts";
import { sampleEntries } from "../content-contract/read-entries.ts";

const website = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dist = path.join(website, "dist");
const contentRoot = path.resolve(website, "../../content");

const failures: string[] = [];
const notes: string[] = [];
let passed = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

if (!existsSync(dist)) {
  console.error(`No build at ${dist}. Run \`pnpm build\` first.`);
  process.exit(1);
}

const read = (relative: string): string =>
  readFileSync(path.join(dist, relative), "utf8");

// ---------------------------------------------------------------------------
console.log("\nThe manifest");
const manifest = JSON.parse(read("deployment.json")) as {
  build: { environment: SiteEnvironment };
  routes: {
    inventory: { path: string; file: string; kind: string; origin: string }[];
  };
  content?: { intended?: unknown[] };
};
const manifestProblems = validateManifest(manifest);
check(
  "deployment.json validates",
  manifestProblems.length === 0,
  manifestProblems.map((p) => `${p.at}: ${p.detail}`).join("; "),
);
const environment = manifest.build.environment;
console.log(`  environment: ${environment}`);
const inventory = manifest.routes.inventory;

// The manifest is a ROUTE, so every field in it is published. It describes this
// build — identities, collections, locales, type keys — and it must not describe
// the SOURCE site: the WordPress post, term and user ids each page was migrated
// from are not information a deployment needs, and nobody asked for them to be
// public. They stay in `content/`, where they were written, and `pnpm
// provenance` reads them from there.
//
// `validateManifest` already refuses a `source` on any intended row. This is
// the blunt second pass over the RAW TEXT, because the structural check can
// only refuse the shapes it knows about, and a leak reintroduced somewhere
// else in the document — a new field, a nested object, a debugging aid left in
// — would pass it. Scanning what is actually served costs one regex.
const manifestText = read("deployment.json");
const SOURCE_ID_KEYS =
  /"(sourceId|source_id|wpId|wordpressId|termId|postId)"\s*:/g;
const leakedKeys = [...manifestText.matchAll(SOURCE_ID_KEYS)].map(
  (match) => match[1],
);
check(
  "the served manifest names no source-system identifier",
  leakedKeys.length === 0,
  `found ${[...new Set(leakedKeys)].join(", ")} in deployment.json — the ids ` +
    "describe the site this was migrated from and must not be served",
);

const leakedEntities = (
  (manifest.content?.intended ?? []) as { id: string; provenance?: unknown }[]
).filter(
  (row) =>
    typeof row.provenance === "object" &&
    row.provenance !== null &&
    "source" in row.provenance,
);
check(
  "no intended entity carries a source entity",
  leakedEntities.length === 0,
  `${leakedEntities.length} row(s) do, starting with "${leakedEntities[0]?.id}"`,
);

// And the other half of the same contract: taking the ids out must not have
// taken anything the deployment needs. Every intended row still states an
// origin and can still be joined by identity, which is what lets
// `content:integrity` report a withheld entity BY NAME.
const intendedRows = (manifest.content?.intended ?? []) as {
  id?: string;
  provenance?: { origin?: string };
}[];
const unattributed = intendedRows.filter(
  (row) =>
    typeof row.id !== "string" ||
    row.id === "" ||
    typeof row.provenance?.origin !== "string",
);
check(
  "every intended entity still states an identity and an origin",
  intendedRows.length > 0 && unattributed.length === 0,
  intendedRows.length === 0
    ? "the manifest lists no intended content at all"
    : `${unattributed.length} row(s) do not`,
);

// ---------------------------------------------------------------------------
console.log("\nEvery route was emitted, and nothing else was");
const missing = inventory.filter(
  (route) => !existsSync(path.join(dist, route.file)),
);
check(
  "every inventory file exists",
  missing.length === 0,
  missing.map((r) => r.file).join(", "),
);

const htmlFiles: string[] = [];
const walk = (dir: string): void => {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (item.name.endsWith(".html"))
      htmlFiles.push(path.relative(dist, full));
  }
};
walk(dist);
const claimed = new Set(inventory.map((route) => route.file));
const unclaimed = htmlFiles.filter((file) => !claimed.has(file));
check(
  "every emitted HTML file is claimed by the inventory",
  unclaimed.length === 0,
  unclaimed.join(", "),
);

// ---------------------------------------------------------------------------
console.log("\nEvery page carries the head the contract promises");
const pages = inventory.filter((route) => route.kind === "page");
const published = new Set(
  inventory.filter((route) => route.kind !== "data").map((route) => route.path),
);
const dataFiles = new Set(
  inventory.filter((route) => route.kind === "data").map((route) => route.path),
);
const headProblems: string[] = [];
const linkProblems: string[] = [];
const mixedContent: string[] = [];
const scopeNotices: string[] = [];
for (const route of pages) {
  const html = read(route.file);
  const h1s = html.match(/<h1\b/g)?.length ?? 0;
  if (h1s !== 1) headProblems.push(`${route.path}: ${h1s} h1 elements`);
  if (!/<title>[^<]+<\/title>/.test(html))
    headProblems.push(`${route.path}: no title`);
  // Matches the locale registry's own rule (content-model/shared.ts): a
  // language tag with an optional script and an optional region. A narrower
  // regex here would fail a build whose locale the registry accepted.
  if (
    !/<html lang="[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?"/.test(
      html,
    )
  )
    headProblems.push(`${route.path}: no lang`);
  if (!/<main id="main"/.test(html))
    headProblems.push(`${route.path}: no main landmark`);
  const robots = /<meta name="robots" content="([^"]+)"/.exec(html)?.[1];
  const expected = robotsDirective(route.path, environment);
  if (robots !== expected)
    headProblems.push(
      `${route.path}: robots "${robots}" (expected "${expected}")`,
    );
  if (/data-wpk-scope-notice/.test(html)) scopeNotices.push(route.path);

  for (const match of html.matchAll(/\bhref="(\/[^"#?]*)(?:[#?][^"]*)?"/g)) {
    const target = match[1] ?? "";
    if (target.startsWith("//")) continue;
    const key = routeKey(target);
    if (
      !published.has(key) &&
      !dataFiles.has(key) &&
      !/\.[a-z0-9]{2,5}$/i.test(key)
    )
      linkProblems.push(`${route.path} → ${target}`);
  }
  for (const match of html.matchAll(/\b(?:src|srcset)="([^"]*)"/g))
    if (/(?:^|[\s,])http:\/\//.test(match[1] ?? ""))
      mixedContent.push(`${route.path}: ${match[1]}`);
}
check(
  "one h1, a title, a lang, a main landmark, the right robots directive",
  headProblems.length === 0,
  headProblems.slice(0, 8).join("; "),
);
check(
  "every internal link reaches a published route",
  linkProblems.length === 0,
  [...new Set(linkProblems)].slice(0, 8).join("; "),
);
check(
  "no http:// media reference",
  mixedContent.length === 0,
  mixedContent.slice(0, 5).join("; "),
);
if (environment === "preview")
  check(
    "the scope notice is on every preview page",
    scopeNotices.length === pages.length,
    `${scopeNotices.length} of ${pages.length}`,
  );
else
  check(
    "no scope notice on a production page",
    scopeNotices.length === 0,
    scopeNotices.slice(0, 5).join(", "),
  );

// ---------------------------------------------------------------------------
console.log("\nrobots.txt, sitemap.xml and the redirect artifacts");
const robotsTxt = read("robots.txt");
if (environment === "preview")
  check(
    "robots.txt disallows everything in preview",
    /^User-agent: \*\nDisallow: \/\n$/.test(robotsTxt),
  );
else
  check(
    "robots.txt allows crawling in production",
    /Allow: \//.test(robotsTxt),
  );

const sitemap = read("sitemap.xml");
const locs = sitemap.match(/<loc>/g)?.length ?? 0;
const origin = siteOrigin();
const indexable = pages.filter((route) =>
  sitemapIncludes(route.path, environment),
).length;
if (environment === "preview")
  check("the sitemap is empty in preview", locs === 0, `${locs} loc(s)`);
else if (origin === undefined) {
  check("the sitemap is empty while no origin is decided", locs === 0);
  notes.push(
    "production build with no origin: canonicals, og:url and the sitemap are absent. Set content/config/site.json origin.",
  );
} else
  check(
    "the sitemap lists every indexable, non-paginated page",
    locs === indexable,
    `${locs} loc(s), ${indexable} expected`,
  );

const redirectMap = parseRedirectMap(
  JSON.parse(readFileSync(path.join(contentRoot, "redirects.json"), "utf8")),
);
check(
  "_redirects and redirects.json exist",
  existsSync(path.join(dist, "_redirects")) &&
    existsSync(path.join(dist, "redirects.json")),
);
const stubs = redirectMap.rules.filter(
  (rule) => !existsSync(path.join(dist, pageFileFor(rule.from))),
);
check(
  "every redirect rule has its stub page",
  stubs.length === 0,
  stubs.map((r) => r.from).join(", "),
);

// ---------------------------------------------------------------------------
console.log("\nProduction readiness");
const samples = sampleEntries(contentRoot);
if (environment === "production")
  check(
    "no sample content in a production build",
    samples.length === 0,
    `${samples.length} item(s): ${samples.slice(0, 5).join(", ")}`,
  );
else
  notes.push(
    `${samples.length} sample item(s) in content/ — a production build will refuse them.`,
  );

// Self-description: prose that describes the build rather than the site. The
// launch switch enumerates what the code branches on; it cannot see a
// hard-coded sentence. Reported, because whether a hit is editorial needs a
// person.
const phrases = [
  "this preview",
  "this build",
  "staging site",
  "coming soon",
  "sample content",
];
const selfDescribing = new Map<string, number>();
for (const route of pages) {
  const text = read(route.file)
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase();
  for (const phrase of phrases)
    if (text.includes(phrase))
      selfDescribing.set(phrase, (selfDescribing.get(phrase) ?? 0) + 1);
}
if (selfDescribing.size > 0)
  notes.push(
    `phrases that may describe the build rather than the site: ${[...selfDescribing.entries()].map(([phrase, count]) => `"${phrase}" on ${count} page(s)`).join(", ")}. Read each one.`,
  );

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const note of notes) console.log(`  note: ${note}`);
if (failures.length > 0) {
  console.error("\nBuild audit FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Build audit OK\n");
