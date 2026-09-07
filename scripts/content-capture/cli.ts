#!/usr/bin/env node
// `pnpm content:census` and `pnpm content:capture`.
//
//   node scripts/content-capture/cli.ts census
//   node scripts/content-capture/cli.ts capture --type post [--limit 5]
//                                               [--no-media] [--no-pages]
//
// Two commands, and the first one is the cheap one. `census` asks the source
// site what it publishes and how much of it there is, in a handful of
// requests; `capture` downloads one type. Answer the first question before
// spending an hour on the second.
//
// Read-only. Every request is a GET against a public endpoint, no credential
// is ever sent, and the only thing written is one JSON artifact under
// `research/`.
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  isPlaceholderUserAgent,
  PoliteReader,
  settingsFromConfig,
} from "../site-map-audit/fetch.ts";
import { capturePostType, writeCapture } from "./capture.ts";
import { WordPressRest } from "./rest.ts";
import { classifyTypes, ofCapability } from "../custom-types/capability.ts";
import { migration } from "../../migration.config.ts";
import { parseArgs } from "../lib/args.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const args = parseArgs(process.argv.slice(2), {
  valued: ["--type", "--limit"],
  defaultCommand: "census",
});
const command = args.command;
const value = args.value;
const has = args.has;

const settings = settingsFromConfig();
const reader = new PoliteReader(settings);

let rest: WordPressRest;
try {
  rest = new WordPressRest(reader);
} catch (cause) {
  // A misconfiguration is a message, not a stack trace.
  process.stderr.write(`\n${(cause as Error).message}\n`);
  process.exit(1);
}

if (isPlaceholderUserAgent(settings.userAgent))
  process.stdout.write(
    "\n  note: crawl.userAgent is still the kit's placeholder. An operator reading\n" +
      "        their access log cannot tell who this is or how to ask you to stop.\n",
  );

// ---------------------------------------------------------------------------
if (command === "census") {
  process.stdout.write(`\ncontent census — ${rest.origin}\n\n`);

  const types = await rest.postTypes();
  if (types.length === 0) {
    process.stderr.write(
      "wp-json/wp/v2/types returned nothing usable.\n" +
        "Either the REST API is disabled, or a firewall refused this request. Check\n" +
        `${rest.url("types")} in a browser before concluding the site has no content.\n`,
    );
    process.exit(1);
  }

  const taxonomies = await rest.taxonomies();

  process.stdout.write("  POST TYPES\n");
  const counts = [];
  for (const type of types) {
    const count = await rest.count(type.restBase);
    counts.push({ type, count });
    const size = (count.total === null ? "?" : String(count.total)).padStart(5);
    process.stdout.write(
      `  ${size}  ${type.name.padEnd(18)} ${type.restBase.padEnd(18)} ${type.label}\n`,
    );
    if (count.note !== undefined)
      process.stdout.write(`         ${count.note}\n`);
  }

  process.stdout.write("\n  TAXONOMIES\n");
  for (const taxonomy of taxonomies) {
    const count = await rest.count(taxonomy.restBase);
    const size = (count.total === null ? "?" : String(count.total)).padStart(5);
    process.stdout.write(
      `  ${size}  ${taxonomy.name.padEnd(18)} ${taxonomy.hierarchical ? "hierarchical" : "flat        "} on ${taxonomy.types.join(", ")}\n`,
    );
  }

  const refused = counts.filter(
    ({ count }) => count.status === 401 || count.status === 403,
  );
  const reachable = counts.filter(({ count }) => count.total !== null);
  const total = reachable.reduce(
    (sum, { count }) => sum + (count.total ?? 0),
    0,
  );

  process.stdout.write(
    `\n  ${reachable.length} of ${types.length} type(s) answered an anonymous reader, ` +
      `${total} row(s) in total, in ${rest.requests} request(s).\n`,
  );
  if (refused.length > 0)
    process.stdout.write(
      `\n  ${refused.length} type(s) refused: ${refused.map(({ type }) => type.name).join(", ")}.\n` +
        "  Those are the ones that may genuinely need a credential. Everything else\n" +
        "  above is reachable today, which is usually most of the site — the project\n" +
        "  this kit came from had recorded its whole blog as blocked, and 251 of its\n" +
        "  278 posts were public.\n",
    );
  // ---------------------------------------------------------------------
  // What this kit is configured to do with each of them.
  //
  // The important row is `unconfigured`: REST found a content type and nobody
  // has decided how it should be published. Reporting "0 custom types" or
  // saying nothing would read as "there is nothing here", when what is true is
  // "there is something here and it is waiting for a decision".
  const capabilities = classifyTypes(types, migration.postTypes);
  const unconfigured = ofCapability(capabilities, "unconfigured");
  const configured = ofCapability(capabilities, "configured");
  const withheld = ofCapability(capabilities, "withheld");

  process.stdout.write("\n  THIS KIT'S CAPABILITY\n");
  for (const row of capabilities) {
    if (row.capability === "internal") continue;
    const label =
      row.capability === "core"
        ? "core            "
        : row.capability === "configured"
          ? `configured      `
          : row.capability === "withheld"
            ? "withheld        "
            : "UNCONFIGURED    ";
    process.stdout.write(
      `  ${label}${row.type.name.padEnd(20)}` +
        `${row.collection === undefined ? "" : `→ content/${row.collection}/`}\n`,
    );
    if (row.unroutableTaxonomies.length > 0)
      process.stdout.write(
        `                  ⚠ taxonomies ${row.unroutableTaxonomies.join(", ")} — ` +
          "no archive is published for these\n",
      );
  }

  const internalCount = ofCapability(capabilities, "internal").length;
  process.stdout.write(
    `\n  ${configured.length} configured, ${withheld.length} withheld, ` +
      `${unconfigured.length} unconfigured, ${internalCount} internal to WordPress.\n`,
  );

  if (unconfigured.length > 0) {
    process.stdout.write(
      `\n  ${unconfigured.length} type(s) have no profile: ` +
        `${unconfigured.map((row) => row.type.name).join(", ")}.\n\n` +
        "  This is a DECISION WAITING, not a gap in the tooling and not an empty\n" +
        "  site. Nothing routes a type the kit was not told about, because\n" +
        "  nothing about a type says whether it should be a public URL. Add a\n" +
        "  profile to `postTypes` in migration.config.ts:\n\n" +
        `    { name: "${unconfigured[0]!.type.name}",\n` +
        `      collection: "${unconfigured[0]!.type.name}s",\n` +
        `      restBase: "${unconfigured[0]!.type.restBase}",\n` +
        `      permalink: "/${unconfigured[0]!.type.name}s/%postname%/",\n` +
        "      published: true,\n" +
        '      archive: { kind: "none" },\n' +
        "      taxonomies: { attached: [], archives: false } }\n\n" +
        "  …or decide it should not be migrated, and record that decision where\n" +
        "  your project records decisions.\n",
    );
  }

  process.stdout.write(
    "\n  Next: `content:capture --type <name> --limit 5` for a first look at one.\n",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
if (command !== "capture") {
  process.stderr.write(
    `unknown command "${command}". Use "census" or "capture".\n`,
  );
  process.exit(2);
}

const typeName = value("--type", "post");
const types = await rest.postTypes();
const type = types.find(
  (candidate) => candidate.name === typeName || candidate.restBase === typeName,
);
if (type === undefined) {
  process.stderr.write(
    `\nNo post type "${typeName}" on ${rest.origin}.\n` +
      `Run \`content:census\` to see what it publishes: ${types.map((candidate) => candidate.name).join(", ")}\n`,
  );
  process.exit(1);
}

const allTaxonomies = await rest.taxonomies();
const limitFlag = value("--limit", "");

const result = await capturePostType(
  {
    type: type.name,
    restBase: type.restBase,
    ...(limitFlag === "" ? {} : { limit: Number(limitFlag) }),
    taxonomies: allTaxonomies.filter((taxonomy) =>
      type.taxonomies.includes(taxonomy.name),
    ),
    withMedia: !has("--no-media"),
    withIncompletePages: !has("--no-pages"),
    onProgress: (line) => process.stdout.write(`  ${line}\n`),
  },
  reader,
);

const file = writeCapture(repositoryRoot, result);

process.stdout.write(
  `\n${result.received} ${result.type} entr${result.received === 1 ? "y" : "ies"} captured` +
    `${result.declaredTotal === null ? "" : ` of ${result.declaredTotal} the site declares`}` +
    `, ${result.requests} request(s)\n` +
    `written to ${path.relative(repositoryRoot, file)}\n\n`,
);

const { bodies } = result;
process.stdout.write(
  `  body length: min ${bodies.min}, median ${bodies.median}, max ${bodies.max}\n`,
);
if (bodies.incomplete.length > 0) {
  process.stdout.write(
    `\n  ${bodies.incomplete.length} entr${bodies.incomplete.length === 1 ? "y" : "ies"} whose body is probably not the whole article:\n`,
  );
  for (const stat of bodies.incomplete.slice(0, 10))
    process.stdout.write(
      `    ${String(stat.length).padStart(6)}  ${stat.slug}${stat.builder === undefined ? "" : ` [${stat.builder}]`}\n`,
    );
  if (bodies.incomplete.length > 10)
    process.stdout.write(
      `    … ${bodies.incomplete.length - 10} more, all in the artifact\n`,
    );
  if (!has("--no-pages"))
    process.stdout.write(
      "\n  Their rendered pages are in the artifact under `renderedPage`. Turning one\n" +
        "  into an article body is a reduction with judgement in it, so this tool\n" +
        "  captures the evidence and does not decide what it means.\n",
    );
}

const builders = new Map<string, number>();
for (const stat of bodies.stats)
  if (stat.builder !== undefined)
    builders.set(stat.builder, (builders.get(stat.builder) ?? 0) + 1);
if (builders.size > 0) {
  process.stdout.write("\n  page-builder markup found in:\n");
  for (const [builder, count] of [...builders].sort())
    process.stdout.write(`    ${String(count).padStart(6)}  ${builder}\n`);
}

for (const note of result.notes) process.stdout.write(`\n  note: ${note}\n`);
process.stdout.write("\n");
