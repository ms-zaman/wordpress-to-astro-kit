#!/usr/bin/env node
// `pnpm render:digest`
//
//   node scripts/render-digest/cli.ts            compare against the baselines
//   node scripts/render-digest/cli.ts --update   rewrite them; the diff IS the review
//   node scripts/render-digest/cli.ts --route /about/   one route, while working
//   node scripts/render-digest/cli.ts --shots    also write the screenshots
//
// Reads `apps/website/dist`, so `pnpm render:digest` builds first. Exits
// non-zero on any difference: a page that renders differently from the record
// is either a defect or an intended change nobody wrote down, and both are
// things a release should stop for.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { routesIn } from "../lib/routes.ts";
import {
  compareDigests,
  describe,
  summarize,
  type DigestFile,
} from "./compare.ts";
import {
  capture,
  DIGEST_VIEWPORTS,
  digestFileName,
  serialize,
} from "./digest.ts";
import { digestRoutes, templatesIn } from "./sample.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const distDirectory = path.join(repositoryRoot, "apps/website/dist");
// Tracked evidence, like everything else under `research/`.
const baselineDirectory = path.join(repositoryRoot, "research/render-digest");
// Gitignored and outside `research/` on purpose: full-page PNGs are neither
// small nor diffable. They exist to be uploaded and looked at.
const screenshotDirectory = path.join(repositoryRoot, "render-digest-shots");

const argv = process.argv.slice(2);
const update = argv.includes("--update");
const shots = argv.includes("--shots");
const routeIndex = argv.indexOf("--route");
const only = routeIndex >= 0 ? argv[routeIndex + 1] : undefined;

if (!existsSync(distDirectory)) {
  process.stderr.write(
    `No build at ${path.relative(repositoryRoot, distDirectory)} — run \`pnpm build\` first.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `render-digest — ${DIGEST_VIEWPORTS.join(", ")}px, ` +
    `baselines in ${path.relative(repositoryRoot, baselineDirectory)}\n\n`,
);

// The sampled route set, unless `--route` names one. `digestRoutes` reduces
// each template family to a handful of representatives — see `sample.ts` for
// why, and for why the choice is deterministic.
const sampled = new Set(
  digestRoutes(routesIn(distDirectory), templatesIn(distDirectory)),
);

const digests = await capture(
  distDirectory,
  DIGEST_VIEWPORTS,
  only === undefined
    ? (route) => sampled.has(route)
    : (route) => route === only,
  shots ? screenshotDirectory : undefined,
);

if (shots)
  process.stdout.write(
    `Screenshots in ${path.relative(repositoryRoot, screenshotDirectory)}/\n\n`,
  );

if (digests.length === 0) {
  process.stderr.write(
    only === undefined
      ? "The build contains no routes.\n"
      : `No route matched ${only}.\n`,
  );
  process.exit(1);
}

const built: DigestFile[] = digests.map((digest) => ({
  file: digestFileName(digest.route, digest.viewport),
  text: serialize(digest),
}));

if (update) {
  // Rewritten wholesale, not merged: a baseline directory that keeps files no
  // route produces any more is how a stale record survives, and the comparison
  // below reports exactly that case in the other direction.
  rmSync(baselineDirectory, { recursive: true, force: true });
  mkdirSync(baselineDirectory, { recursive: true });
  for (const entry of built)
    writeFileSync(path.join(baselineDirectory, entry.file), entry.text);
  const lines = digests.reduce(
    (total, digest) => total + digest.lines.length,
    0,
  );
  process.stdout.write(
    `Recorded ${built.length} digest(s), ${lines} element line(s).\n` +
      "Read the diff before committing — that diff is the review.\n",
  );
  process.exit(0);
}

const recorded: DigestFile[] = existsSync(baselineDirectory)
  ? readdirSync(baselineDirectory)
      .filter((file) => file.endsWith(".txt"))
      .map((file) => ({
        file,
        text: readFileSync(path.join(baselineDirectory, file), "utf8"),
      }))
  : [];

// A single-route run compares only what it captured. Without this every other
// route reads as `vanished`, which would make `--route` useless for the case
// it exists for: looking at one page while working on it.
const scoped =
  only === undefined
    ? recorded
    : recorded.filter((entry) =>
        built.some((candidate) => candidate.file === entry.file),
      );

const changes = compareDigests(scoped, built);
for (const change of changes) process.stdout.write(`${describe(change)}\n\n`);

process.stdout.write(`${summarize(changes)}\n`);
if (changes.length > 0) {
  process.stdout.write(
    "\nIf every change above is intended, run with `--update` and commit the\n" +
      "rewritten baselines in the same commit as the change that caused them.\n",
  );
  process.exit(1);
}
