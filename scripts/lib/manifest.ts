// Reading a build's own route inventory out of `dist/deployment.json`.
//
// The manifest is emitted by `src/pages/deployment.json.ts` from the route
// table that produced the pages, so it is the only place that knows WHICH
// TEMPLATE generated a given file. Two gates need that answer and neither can
// derive it from a path:
//
//   - `render-digest` samples one family down to a handful of representatives;
//   - `accessibility-audit` asks whether a nav landmark is site chrome or is
//     contextual to one template, and it asks that per family.
//
// Deriving it from the path shape looked adequate and was not. The first
// segment puts `/`, `/404` and `/about` in one bucket, so a breadcrumb that
// every real page carries and the home page correctly does not becomes a
// majority — and the audit then demands a breadcrumb on the home page. That is
// the same false positive, in miniature, that a site-wide majority produced on
// a migrated blog of 250 posts.
//
// **An unreadable manifest is not an error here.** Both callers degrade to
// something safe: the digest records everything, and the landmark rule falls
// back to the path shape. A gate that refused to run without a manifest could
// not audit an arbitrary directory, which is exactly what the mutation suites
// hand it.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** One row of the build's route inventory, as the manifest records it. */
export interface InventoryRow {
  /** Root-relative, trailing-slash-free (except `/` itself). */
  readonly path: string;
  /** The emitted file, relative to `dist/`. */
  readonly file: string;
  /** `page`, `data` or `redirect`. */
  readonly kind: string;
  /** Where the route's existence comes from: `static`, `page`, `post`, … */
  readonly origin: string;
  /** The route module that generates it. */
  readonly source: string;
}

/**
 * Every inventory row in a build, or `[]` when there is no readable manifest.
 *
 * Total by construction. A malformed manifest is a finding `preview-audit`
 * makes; here it is simply an absence.
 */
export function readInventory(distDirectory: string): InventoryRow[] {
  const file = path.join(distDirectory, "deployment.json");
  if (!existsSync(file)) return [];
  try {
    const manifest = JSON.parse(readFileSync(file, "utf8")) as {
      routes?: { inventory?: readonly Partial<InventoryRow>[] };
    };
    return (manifest.routes?.inventory ?? []).flatMap((row) =>
      typeof row.path === "string" && typeof row.file === "string"
        ? [
            {
              path: row.path,
              file: row.file,
              kind: row.kind ?? "page",
              origin: row.origin ?? "unknown",
              source: row.source ?? "unknown",
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}

/**
 * Emitted file to the template family that produced it, for pages only.
 *
 * The family is the route's ORIGIN rather than its source module, because that
 * is the distinction the two callers care about: a static route is its own
 * template, every post shares one, every archive shares another. A source
 * module would split families no finer in this kit and would tie both gates to
 * a file path that a project is free to rename.
 */
export function pageFamilies(distDirectory: string): Map<string, string> {
  const families = new Map<string, string>();
  for (const row of readInventory(distDirectory))
    if (row.kind === "page") families.set(row.file, row.origin);
  return families;
}
