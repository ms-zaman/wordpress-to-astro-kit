// The render digest's fingerprint.
//
// One hash over every tracked digest baseline, which is what a sign-off
// records alongside its commit so that it can outlive that commit without
// becoming a claim about a page nobody looked at.
// `apps/website/src/release/signoff.ts` carries the reasoning; this is the
// only thing that computes the number.
//
// Reads and never writes, and is deliberately NOT part of `signoff.ts`: that
// module is pure, and a release check that reaches out to the world cannot be
// tested against a state the world is not currently in.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Where `scripts/render-digest` keeps its baselines. */
export const BASELINE_DIRECTORY = "research/render-digest";

/** How many baselines are on record. Zero is a real and common answer. */
export function digestBaselineCount(repositoryRoot: string): number {
  const directory = path.join(repositoryRoot, BASELINE_DIRECTORY);
  if (!existsSync(directory)) return 0;
  return readdirSync(directory).filter((name) => name.endsWith(".txt")).length;
}

/**
 * A hash over the digest baselines, or `"unavailable"` when there are none.
 *
 * Sorted by file name, and each file's NAME is hashed with its bytes, so a
 * baseline that is renamed or removed changes the fingerprint too — a route
 * that stops being digested is exactly as much a change to what a reviewer
 * walked as a route that renders differently.
 */
export function digestFingerprint(repositoryRoot: string): string {
  const directory = path.join(repositoryRoot, BASELINE_DIRECTORY);
  if (!existsSync(directory)) return "unavailable";
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".txt"))
    .sort();
  if (files.length === 0) return "unavailable";
  const hash = createHash("sha256");
  for (const name of files) {
    hash.update(name);
    hash.update("\0");
    hash.update(readFileSync(path.join(directory, name)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
