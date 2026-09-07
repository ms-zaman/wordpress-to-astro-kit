#!/usr/bin/env node
// `pnpm content:reconcile` and `pnpm content:reconcile-fetch`.
//
//   node scripts/content-reconcile/cli.ts fetch    capture the source pages
//   node scripts/content-reconcile/cli.ts          reconcile against them
//
// Two commands, for the reason every capture in this kit is split from its
// comparison: `fetch` reaches out to somebody else's server once, and the
// reconciliation then runs offline as often as you like — on every build, in
// CI, with no network at all.
//
// The pairs come from `migration.config.ts`'s `routePairs`. Each names a route,
// the saved source page, and the built file to compare it with.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { migration } from "../../migration.config.ts";
import {
  PoliteReader,
  requireLiveOrigin,
  settingsFromConfig,
} from "../site-map-audit/fetch.ts";
import {
  problemsOfKind,
  reconcile,
  type RoutePairSurfaces,
} from "./reconcile.ts";
import { RULINGS, rulingViolations } from "./rulings.ts";
import { surfaceOfFile } from "./surface.ts";
import { resolveMarkup } from "./builders.ts";
import { parseArgs } from "../lib/args.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const args = parseArgs(process.argv.slice(2), {
  valued: ["--dist"],
  defaultCommand: "reconcile",
});
const command = args.command;
const value = args.value;
const has = args.has;

const pairs = migration.routePairs;

if (pairs.length === 0) {
  process.stdout.write(
    "\nNo route pairs are configured, so there is nothing to reconcile.\n\n" +
      "Add them to `routePairs` in migration.config.ts as you build each page:\n\n" +
      '  { route: "/pricing",\n' +
      '    live: "research/pages/pricing-2026-09-07.html",\n' +
      '    ours: "pricing/index.html" }\n\n' +
      "Then `content:reconcile fetch` saves the source pages and\n" +
      "`content:reconcile` compares them. A pair is added when a page is built,\n" +
      "not before: asking whether a page you have not written matches is asking\n" +
      "nonsense.\n",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
if (command === "fetch") {
  let origin: string;
  try {
    origin = requireLiveOrigin();
  } catch (cause) {
    process.stderr.write(`\n${(cause as Error).message}\n`);
    process.exit(1);
  }
  const reader = new PoliteReader(settingsFromConfig());
  let written = 0;
  const failures: string[] = [];

  for (const pair of pairs) {
    const target = path.join(repositoryRoot, pair.live);
    process.stdout.write(`  ${pair.route}\n`);
    const response = await reader.get(`${origin}${pair.route}`);
    if (response.status !== 200 || response.body === undefined) {
      failures.push(
        `${pair.route} answered ${response.status}${response.error === undefined ? "" : ` (${response.error})`}`,
      );
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, response.body);
    written += 1;
  }

  process.stdout.write(
    `\n${written} of ${pairs.length} source page(s) saved, ${reader.requests} request(s)\n`,
  );
  for (const failure of failures) process.stderr.write(`  ✗ ${failure}\n`);
  if (failures.length > 0) {
    process.stderr.write(
      "\nA page that did not answer is not a page that changed. Reconciling against\n" +
        "a stale copy of it would compare this build to last week's site.\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    "\nThese are EVIDENCE: tracked, dated in their filenames, and never reformatted.\n",
  );
  process.exit(0);
}

if (command !== "reconcile") {
  process.stderr.write(
    `unknown command "${command}". Use "fetch" or "reconcile".\n`,
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
const distDirectory = path.resolve(
  repositoryRoot,
  value("--dist", "apps/website/dist"),
);

const violations = rulingViolations();
if (violations.length > 0) {
  process.stderr.write("\nThe ruling table contradicts its own rules:\n");
  for (const violation of violations)
    process.stderr.write(`  ✗ ${violation}\n`);
  process.exit(1);
}

// Which builder built the source site is configuration, not an assumption:
// WordPress renders through Gutenberg, Elementor, Divi and more, and reading
// one site's markup by another's rules drops the wrong subtrees silently.
let markup;
try {
  markup = resolveMarkup(migration.sourceMarkup);
} catch (cause) {
  process.stderr.write(`\n${(cause as Error).message}\n`);
  process.exit(1);
}

const surfaces: RoutePairSurfaces[] = [];
const missing: string[] = [];

for (const pair of pairs) {
  const liveFile = path.join(repositoryRoot, pair.live);
  const oursFile = path.join(distDirectory, pair.ours);
  if (!existsSync(liveFile)) {
    missing.push(`${pair.route}: no saved source page at ${pair.live}`);
    continue;
  }
  if (!existsSync(oursFile)) {
    missing.push(`${pair.route}: the build produced no ${pair.ours}`);
    continue;
  }
  surfaces.push({
    route: pair.route,
    // The source side carries a page builder's hidden-at-every-width flags;
    // this build does not emit a section it does not paint, and a class that
    // happened to collide with a marker name would silently delete real
    // content. So the two sides are read with different options, deliberately.
    live: surfaceOfFile(liveFile, { dropHidden: true, markup }),
    ours: surfaceOfFile(oursFile, { dropHidden: false }),
  });
}

if (missing.length > 0) {
  process.stderr.write("\nCannot reconcile every configured pair:\n");
  for (const line of missing) process.stderr.write(`  ✗ ${line}\n`);
  process.stderr.write(
    "\nRun `content:reconcile fetch` for the source pages, and `pnpm build` for\n" +
      "this side. Reconciling a subset silently would report every ruling for the\n" +
      "missing routes as stale.\n",
  );
  process.exit(1);
}

const result = reconcile(surfaces);

process.stdout.write(
  `\ncontent reconciliation — ${surfaces.length} route pair(s)\n\n`,
);
for (const route of result.routes)
  process.stdout.write(
    `  ${route.route.padEnd(28)} ${String(route.matched).padStart(4)} matched  ` +
      `${String(route.ruled).padStart(3)} ruled  ` +
      `${String(route.oursRuled).padStart(3)} ours-ruled  ` +
      `(source asks ${route.liveAsked}, we ask ${route.oursAsked})\n`,
  );

const order = ["unpainted", "invented", "contradicted", "stale"] as const;
for (const kind of order) {
  const found = problemsOfKind(result.problems, kind);
  if (found.length === 0) continue;
  process.stdout.write(`\n  ${kind.toUpperCase()} (${found.length})\n`);
  for (const problem of found.slice(0, 25))
    process.stdout.write(
      `    ${problem.route}  "${problem.key}"\n      ${problem.detail}\n`,
    );
  if (found.length > 25)
    process.stdout.write(`    … ${found.length - 25} more\n`);
}

process.stdout.write(
  `\n${result.problems.length} finding(s), ${RULINGS.size} ruling(s) on record\n`,
);

if (result.problems.length > 0) {
  process.stderr.write(
    "\nEvery string one page paints and the other does not needs a ruling in\n" +
      "scripts/content-reconcile/rulings.ts, with the evidence behind it. A row\n" +
      'whose reason only says "we say it differently" hides a defect.\n',
  );
  process.exit(1);
}
process.stdout.write(
  "\nEvery string the source paints is said here, and nothing here is invented.\n",
);
