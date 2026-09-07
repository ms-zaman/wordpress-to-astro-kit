// The local route inventory — read from `dist/`, never from source files.
//
// A content entry or a page component proves nothing about what the build
// SERVES; only the generated output does. That is the same rule
// `scripts/lib/routes.ts` follows, and this module differs from it in one way:
// it keeps data routes too (`.json`, `.xml`, `.txt`), because live may serve a
// URL this build answers with a file rather than a page, and the diff should
// see that as a match rather than as a gap.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { isRedirectStub } from "../lib/routes.ts";

export interface LocalRecord {
  /** The route path the build generated, comparison-key shaped. */
  readonly key: string;
  /** The dist-relative file that backs it. */
  readonly file: string;
  /** `<link rel="canonical">`, when the page carries one. */
  readonly canonical?: string;
  /** True for a materialised redirect stub rather than a page. */
  readonly redirect: boolean;
}

const CANONICAL = /<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>/;
const ROUTE_EXTENSIONS = new Set([".html", ".json", ".xml", ".txt"]);

function walk(root: string, relative: string, out: string[]): void {
  for (const name of readdirSync(path.join(root, relative)).sort()) {
    const next = relative === "" ? name : `${relative}/${name}`;
    // Hashed asset bundles are not routes.
    if (next === "_astro") continue;
    if (statSync(path.join(root, next)).isDirectory()) walk(root, next, out);
    else out.push(next);
  }
}

/** Every route the built site serves, keyed the way the diff compares. */
export function readDistRoutes(distDirectory: string): LocalRecord[] {
  const files: string[] = [];
  walk(distDirectory, "", files);

  const records: LocalRecord[] = [];
  for (const file of files) {
    const extension = path.extname(file);
    if (!ROUTE_EXTENSIONS.has(extension)) continue;

    const key =
      file === "index.html"
        ? "/"
        : file.endsWith("/index.html")
          ? `/${file.slice(0, -"index.html".length)}`
          : `/${file}`;

    if (extension !== ".html") {
      records.push({ key, file, redirect: false });
      continue;
    }

    const html = readFileSync(path.join(distDirectory, file), "utf8");
    const canonical = CANONICAL.exec(html)?.[1];
    records.push({
      key,
      file,
      ...(canonical === undefined ? {} : { canonical }),
      redirect: isRedirectStub(html),
    });
  }

  return records.sort((left, right) => left.key.localeCompare(right.key));
}
