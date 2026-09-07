// kit-init: stamp a project's identity into the kit.
//
// The kit ships with a placeholder prefix — `wpk-` on classes and data
// attributes, `WPK_` on build variables, `@wpk/` on workspace packages — so it
// builds and passes its own gates the moment it is cloned. It is a
// placeholder, not a brand: this rewrites every occurrence to the name you
// give it, records the new prefix in the root package.json (`kit.prefix`), and
// writes the site's name and origins where they live. Run it again with a
// different name and it renames again; the current prefix is read, never
// assumed.
//
// Pure: `planInit` computes every change and `applyInit` writes them, so the
// test can plan against a copy and assert the result.
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export interface InitOptions {
  /** The new prefix: lowercase, 2–12 characters, letters and digits, starts with a letter. */
  readonly name: string;
  /** The site's display name, for content/config/site.json. */
  readonly siteName?: string;
  /** The production origin, for content/config/site.json. */
  readonly origin?: string;
  /** The WordPress site being migrated, for migration.config.ts. */
  readonly liveOrigin?: string;
}

export interface FileChange {
  readonly file: string;
  readonly before: string;
  readonly after: string;
}

export interface InitPlan {
  readonly currentPrefix: string;
  readonly nextPrefix: string;
  readonly changes: readonly FileChange[];
  readonly warnings: readonly string[];
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".astro",
  "test-results",
  "playwright-report",
  "render-digest-shots",
]);
const EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".astro",
  ".css",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".html",
  ".txt",
]);

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function validateName(name: string): string | undefined {
  if (!/^[a-z][a-z0-9]{1,11}$/.test(name))
    return `"${name}" is not a usable prefix: lowercase letters and digits, 2–12 characters, starting with a letter.`;
  return undefined;
}

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i;

function listFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (SKIP_DIRS.has(item.name)) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (
        EXTENSIONS.has(path.extname(item.name)) ||
        item.name === "pnpm-lock.yaml"
      )
        files.push(full);
    }
  };
  walk(root);
  return files;
}

/** The prefix the repository currently carries, from the root package.json. */
export function currentPrefix(root: string): string {
  const pkg = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { kit?: { prefix?: string } };
  const prefix = pkg.kit?.prefix;
  if (typeof prefix !== "string" || validateName(prefix) !== undefined)
    throw new Error(
      `package.json "kit.prefix" must name the current prefix; got ${JSON.stringify(prefix)}.`,
    );
  return prefix;
}

/** Rewrite one file's text from the current prefix to the next. */
export function renameText(text: string, from: string, to: string): string {
  const lower = new RegExp(`(^|[^a-z0-9])${escapeRegExp(from)}-`, "g");
  const upper = new RegExp(
    `(^|[^A-Z0-9])${escapeRegExp(from.toUpperCase())}_`,
    "g",
  );
  const scope = new RegExp(`@${escapeRegExp(from)}/`, "g");
  return text
    .replace(scope, `@${to}/`)
    .replace(lower, (_whole, lead: string) => `${lead}${to}-`)
    .replace(upper, (_whole, lead: string) => `${lead}${to.toUpperCase()}_`);
}

export function planInit(root: string, options: InitOptions): InitPlan {
  const invalid = validateName(options.name);
  if (invalid) throw new Error(invalid);
  // Validate the NORMALISED form: a URL pasted out of a browser bar carries a
  // trailing slash, and rejecting it would be rejecting the commonest way the
  // value arrives. Everything downstream stores it stripped.
  for (const [label, value] of [
    ["origin", options.origin],
    ["liveOrigin", options.liveOrigin],
  ] as const)
    if (value !== undefined && !ORIGIN.test(value.replace(/\/+$/, "")))
      throw new Error(
        `${label} must be a scheme and host like https://example.com, got "${value}".`,
      );

  const from = currentPrefix(root);
  const to = options.name;
  const changes: FileChange[] = [];
  const warnings: string[] = [];

  if (from !== to)
    for (const file of listFiles(root)) {
      const before = readFileSync(file, "utf8");
      const after = renameText(before, from, to);
      if (after !== before) changes.push({ file, before, after });
    }

  const edit = (relative: string, rewrite: (text: string) => string): void => {
    const file = path.join(root, relative);
    if (!existsSync(file)) {
      warnings.push(`${relative} not found; nothing written there.`);
      return;
    }
    const pending = changes.find((change) => change.file === file);
    const before = pending?.after ?? readFileSync(file, "utf8");
    const after = rewrite(before);
    if (after === before) return;
    if (pending) {
      changes.splice(changes.indexOf(pending), 1, {
        file,
        before: pending.before,
        after,
      });
    } else changes.push({ file, before, after });
  };

  // The root package.json records the prefix, so a second run reads the truth.
  edit("package.json", (text) => {
    const pkg = JSON.parse(text) as Record<string, unknown> & {
      kit?: Record<string, unknown>;
    };
    pkg.kit = { ...(pkg.kit ?? {}), prefix: to };
    return `${JSON.stringify(pkg, null, 2)}\n`;
  });

  if (options.siteName !== undefined || options.origin !== undefined)
    edit("content/config/site.json", (text) => {
      const site = JSON.parse(text) as Record<string, unknown>;
      if (options.siteName !== undefined) site.name = options.siteName;
      if (options.origin !== undefined)
        site.origin = options.origin.replace(/\/+$/, "");
      return `${JSON.stringify(site, null, 2)}\n`;
    });

  if (options.liveOrigin !== undefined)
    edit("migration.config.ts", (text) => {
      const line = /^(\s*)liveOrigin:\s*(?:undefined|"[^"]*"),\s*$/m;
      if (!line.test(text)) {
        warnings.push(
          "migration.config.ts: the `liveOrigin:` line was not found in its expected shape; set it by hand.",
        );
        return text;
      }
      return text.replace(
        line,
        `$1liveOrigin: "${options.liveOrigin!.replace(/\/+$/, "")}",`,
      );
    });

  return { currentPrefix: from, nextPrefix: to, changes, warnings };
}

export function applyInit(plan: InitPlan): void {
  for (const change of plan.changes) writeFileSync(change.file, change.after);
}

/** Files under `root` that still carry a prefix, for the post-init check. */
export function remainingOccurrences(root: string, prefix: string): string[] {
  const probe = new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(prefix)}-|(^|[^A-Z0-9])${escapeRegExp(prefix.toUpperCase())}_|@${escapeRegExp(prefix)}/`,
  );
  const hits: string[] = [];
  for (const file of listFiles(root)) {
    if (statSync(file).size > 5_000_000) continue;
    if (probe.test(readFileSync(file, "utf8")))
      hits.push(path.relative(root, file));
  }
  return hits;
}
