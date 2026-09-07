#!/usr/bin/env node
// docs-validator CLI.
//
// The only module here that touches the filesystem, and it is read-only: no
// document is written, moved, or reformatted. The validator REPORTS; deciding
// what a document should say is a human's call, and several of the documents it
// reads are governance records that an agent must not edit.
//
// Wired into `pnpm validate`, because a cross-reference that stops resolving
// is a source of truth that has silently stopped pointing anywhere, and this
// kit's documents are dense with cross-references — they are the structure,
// not decoration.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { sortFindings } from "./finding.ts";
import {
  readDocument,
  readHeadings,
  readLines,
  type Document,
} from "./markdown.ts";
import type { LinkResolver } from "./links.ts";
import { ruleGroups, validateDocuments, type RuleGroup } from "./validate.ts";

const repositoryRoot = process.cwd();

const relative = (absolute: string): string =>
  path.relative(repositoryRoot, absolute).split(path.sep).join("/");

/** Filesystem-backed resolver. Reads only; caches anchors per target. */
const createResolver = (): LinkResolver => {
  const anchorCache = new Map<string, readonly string[] | null>();

  return {
    resolve(from, target) {
      const absolute = path.resolve(repositoryRoot, path.dirname(from), target);
      const rel = path.relative(repositoryRoot, absolute);
      if (rel.startsWith("..") || path.isAbsolute(rel)) return "";
      return rel.split(path.sep).join("/");
    },
    exists(target) {
      try {
        statSync(path.join(repositoryRoot, target));
        return true;
      } catch {
        return false;
      }
    },
    anchors(target) {
      if (anchorCache.has(target)) return anchorCache.get(target) ?? null;
      let result: readonly string[] | null = null;
      if (target.endsWith(".md")) {
        try {
          const source = readFileSync(
            path.join(repositoryRoot, target),
            "utf8",
          );
          result = readHeadings(readLines(source)).map(
            (heading) => heading.anchor,
          );
        } catch {
          result = null;
        }
      }
      anchorCache.set(target, result);
      return result;
    },
  };
};

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", ".astro"]);

/** Markdown files under a path, in sorted order — the run must be stable. */
function collect(target: string): string[] {
  const absolute = path.resolve(repositoryRoot, target);
  let info;
  try {
    info = statSync(absolute);
  } catch {
    console.error(`docs-validator: no such path: ${target}`);
    process.exit(2);
  }

  if (info.isFile()) return absolute.endsWith(".md") ? [absolute] : [];

  const found: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      found.push(...collect(path.join(absolute, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(path.join(absolute, entry.name));
    }
  }
  return found;
}

const usage = `
docs-validator — Markdown link, metadata, and heading validation.

  node scripts/docs-validator/cli.ts [options] [paths...]

Paths default to \`docs\`. Directories are walked for \`.md\` files.

Options
  --rules=<a,b>   Rule groups to run: ${ruleGroups.join(", ")} (default: all)
  --json          Emit the report as JSON on stdout
  --strict        Treat warnings as errors for the exit code
  --quiet         Print the summary only
  -h, --help      This text

Exit codes
  0  no errors (warnings alone do not fail unless --strict)
  1  at least one error
  2  bad invocation

Read-only. No document is written, moved, or reformatted.
`.trim();

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) {
  console.log(usage);
  process.exit(0);
}

const json = argv.includes("--json");
const strict = argv.includes("--strict");
const quiet = argv.includes("--quiet");

let groups: readonly RuleGroup[] = ruleGroups;
const rulesFlag = argv.find((argument) => argument.startsWith("--rules="));
if (rulesFlag !== undefined) {
  const requested = rulesFlag
    .slice("--rules=".length)
    .split(",")
    .map((rule) => rule.trim());
  const unknown = requested.filter(
    (rule) => !(ruleGroups as readonly string[]).includes(rule),
  );
  if (unknown.length > 0 || requested.length === 0) {
    console.error(
      `docs-validator: unknown rule group(s): ${unknown.join(", ")}. Known: ${ruleGroups.join(", ")}`,
    );
    process.exit(2);
  }
  groups = requested as RuleGroup[];
}

const targets = argv.filter((argument) => !argument.startsWith("-"));
const files = [
  ...new Set((targets.length > 0 ? targets : ["docs"]).flatMap(collect)),
].sort();

const documents: Document[] = files.map((file) =>
  readDocument(relative(file), readFileSync(file, "utf8")),
);

const report = validateDocuments(documents, createResolver(), groups);

if (json) {
  console.log(`${JSON.stringify(report, null, 2)}\n`.trimEnd());
} else {
  if (!quiet) {
    for (const finding of sortFindings(report.findings)) {
      const where =
        finding.line > 0 ? `${finding.path}:${finding.line}` : finding.path;
      const mark = finding.severity === "error" ? "✗" : "!";
      console.log(`${mark} ${where}  ${finding.rule}  ${finding.detail}`);
    }
    if (report.findings.length > 0) console.log("");
  }

  console.log(
    `docs-validator ${report.toolVersion} — ${report.documents} document(s), ` +
      `rules: ${report.groups.join(", ")}`,
  );
  console.log(
    `${report.errors} error(s), ${report.warnings} warning(s), ` +
      `${report.externalLinks} external link(s) not checked`,
  );
  for (const [rule, count] of Object.entries(report.byRule)) {
    console.log(`  ${rule}: ${count}`);
  }
}

process.exit(report.errors > 0 || (strict && report.warnings > 0) ? 1 : 0);
