// DISCOVER — every asset a content tree references, classified.
//
// The first stage, and the one the whole pipeline depends on: a gate cannot
// detect an asset it was never shown, so if this misses a reference nothing
// downstream can report it missing. It therefore reads the FILES rather than
// the built site — a body that fails to build still references its images, and
// an entry in a locale this build does not publish still needs its media
// captured before that locale can ever be built.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  identifyAsset,
  type AssetIdentity,
} from "../../apps/website/src/media/asset-identity.ts";
import { findReferences } from "../../apps/website/src/media/references.ts";
import type { MediaProfile } from "../../migration.config.ts";

/** One reference, and where a person would go to change it. */
export interface FoundReference {
  readonly identity: AssetIdentity;
  /** The file it was found in, relative to the content root. */
  readonly where: string;
  /** `body`, `featuredImage`, `avatar`, `ogImage` — what named it. */
  readonly field: string;
}

const listFiles = (dir: string, suffix: string): string[] => {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) found.push(...listFiles(full, suffix));
    else if (item.name.endsWith(suffix) && item.name !== "README.md")
      found.push(full);
  }
  return found.sort();
};

/**
 * Every URL in a JSON value, wherever it is nested.
 *
 * A registry row's media lives in `avatar.url`, an SEO row's in `ogImage.url`,
 * and a schema this kit has not written yet will put one somewhere else. A
 * walk finds all three without a field list that would go stale — and a field
 * list going stale is how a reference stops being shown to the gate.
 */
function urlsIn(
  value: unknown,
  at: string,
  into: { path: string; url: string }[],
): void {
  if (typeof value === "string") {
    if (at.endsWith(".url") || at.endsWith("url"))
      into.push({ path: at, url: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => urlsIn(item, `${at}[${index}]`, into));
    return;
  }
  if (typeof value === "object" && value !== null)
    for (const [key, nested] of Object.entries(value))
      urlsIn(nested, at === "" ? key : `${at}.${key}`, into);
}

/** Front matter and body, split without parsing YAML. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Scan a whole content tree.
 *
 * Markdown entries contribute their BODY (every reference form) and their
 * front matter (every `url:` value, however nested). JSON registries
 * contribute every `url` in them. Nothing is filtered by locale: an entry this
 * build does not publish still owns its media.
 */
export function scanContentTree(
  contentRoot: string,
  profile: MediaProfile,
): FoundReference[] {
  const found: FoundReference[] = [];

  for (const file of listFiles(contentRoot, ".md")) {
    const where = path.relative(contentRoot, file);
    const raw = readFileSync(file, "utf8");
    const block = FRONTMATTER.exec(raw);
    const body = block === null ? raw : raw.slice(block[0].length);

    for (const reference of findReferences(body)) {
      const identity = identifyAsset(reference.url, profile);
      // An `href` is an asset reference only when it names a file this engine
      // owns. WordPress's "link to media file" produces one; an ordinary
      // internal link to another page produces the same attribute and is not
      // an asset at all. Reporting `/about/team/` as UNSUPPORTED media would
      // bury the real findings under every link on the site — and internal
      // links already have a gate, in `preview-audit`.
      if (
        reference.kind === "href" &&
        identity.classification !== "SUPPORTED" &&
        identity.classification !== "CONFIGURED"
      )
        continue;
      found.push({ identity, where, field: reference.kind });
    }

    // Front matter carries `featuredImage.url` and its `variants[].url`. It is
    // read with the same crude line scan the content contract uses — a full
    // YAML parser is a dependency, and the shape here is one key per line.
    if (block !== null)
      for (const line of block[1]!.split(/\r?\n/)) {
        // The `- ` prefix is not optional decoration: a `variants` entry is a
        // SEQUENCE item, `    - url: "…"`, and a pattern anchored on `url:`
        // after whitespace alone missed every rendition in the library. Caught
        // by the mutation test, which is the point of having one.
        const match = /^\s*(?:-\s+)?url:\s*(.+?)\s*$/.exec(line);
        if (match === null) continue;
        const value = match[1]!.replace(/^["']|["']$/g, "");
        found.push({
          identity: identifyAsset(value, profile),
          where,
          field: "front-matter url",
        });
      }
  }

  for (const file of listFiles(contentRoot, ".json")) {
    const where = path.relative(contentRoot, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const urls: { path: string; url: string }[] = [];
    urlsIn(parsed, "", urls);
    for (const one of urls)
      found.push({
        identity: identifyAsset(one.url, profile),
        where,
        field: one.path,
      });
  }

  return found;
}

/** Files already captured, relative to the static directory. */
export function capturedFiles(
  staticRoot: string,
  localBase: string,
): Set<string> {
  const base = path.join(staticRoot, localBase.replace(/^\/+|\/+$/g, ""));
  if (!existsSync(base) || !statSync(base).isDirectory()) return new Set();
  const prefix = localBase.replace(/^\/+|\/+$/g, "");
  return new Set(
    listFilesAny(base).map(
      (file) =>
        `${prefix}/${path.relative(base, file).split(path.sep).join("/")}`,
    ),
  );
}

const listFilesAny = (dir: string): string[] => {
  const found: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) found.push(...listFilesAny(full));
    else found.push(full);
  }
  return found.sort();
};
