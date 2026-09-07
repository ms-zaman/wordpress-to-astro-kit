// Reading the build output.
//
// One job: turn a `dist/` directory into pages that carry their own ACTIVE
// CSS, which is the part a naive reader gets wrong.
//
// Astro splits component styles two ways. Some land in shared bundles under
// `_astro/` that a page links; some are inlined into the page's own `<style>`
// blocks. A focus check that reads only the linked bundles concludes that
// every component whose styles were inlined has no focus rule. So "the CSS
// this page actually applies" is inline blocks PLUS linked bundles, and
// nothing less.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { isRedirectStub } from "../lib/routes.ts";

export interface Page {
  /** Dist-relative path, e.g. `blog/index.html`. */
  readonly file: string;
  readonly html: string;
  /** Inline `<style>` blocks plus every linked stylesheet, concatenated. */
  readonly css: string;
}

/** Every `.html` file under `root`, dist-relative, sorted. */
export function htmlFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".html"))
        out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * The CSS a page applies: its own inline blocks, then each stylesheet it links.
 *
 * A stylesheet the page links but the build did not emit is skipped rather
 * than thrown on — that is a broken-asset finding, and `preview-audit` owns it.
 */
export function activeCss(root: string, html: string): string {
  const parts = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(
    (match) => match[1]!,
  );
  for (const match of html.matchAll(
    /<link\s+rel="stylesheet"\s+href="([^"]+)"/g,
  )) {
    const file = path.join(root, match[1]!.replace(/^\//, ""));
    try {
      parts.push(readFileSync(file, "utf8"));
    } catch {
      /* missing stylesheet — preview-audit reports it */
    }
  }
  return parts.join("\n");
}

/** Read every page in a build output. Throws only when there is nothing to read. */
export function readPages(root: string): Page[] {
  let files: string[];
  try {
    files = htmlFiles(root);
  } catch {
    throw new Error(`no build output at ${root} — run \`pnpm build\` first`);
  }
  if (files.length === 0)
    throw new Error(`no HTML pages under ${root} — nothing to audit`);

  return files.flatMap((file) => {
    const html = readFileSync(path.join(root, file), "utf8");
    // A materialised redirect is a meta refresh and a link, not a page of the
    // site: no landmarks, no headings, nothing to audit.
    if (isRedirectStub(html)) return [];
    return [{ file, html, css: activeCss(root, html) }];
  });
}

/**
 * Routes that are review-only, and therefore not part of the production site.
 *
 * **Empty in the kit**, because the kit publishes no review-only surface. A
 * project that adds one — a component showcase, a specimen page — lists it
 * here, and two rules change for it: it must carry a `main` landmark and must
 * NOT carry the site chrome, and the SEO audit stops asking it for a social
 * head.
 *
 * A list rather than a path predicate, so that adding one is a deliberate edit
 * and a reviewer can see the whole set at once.
 */
export const REVIEW_ONLY: readonly string[] = [];

export const isReviewOnly = (file: string): boolean =>
  REVIEW_ONLY.includes(file);
