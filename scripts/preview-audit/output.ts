// Reading a build output directory.
//
// The audit's only filesystem seam. Everything downstream works on the
// `BuildOutput` this module produces, which is what lets the mutation tests
// construct a broken build in a temporary directory and audit it with exactly
// the code that audits the real one.
//
// It reads text for HTML and JSON and records everything else by path alone.
// A preview audit does not need to decode a PNG; it needs to know the file is
// there, and reading images into memory to answer that would make the audit
// scale with the size of the media rather than the size of the site.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** One emitted file. `text` is present only for the types the audit parses. */
export interface OutputFile {
  /** Dist-relative, POSIX separators — the same form a manifest records. */
  readonly file: string;
  readonly bytes: number;
  readonly text?: string;
}

export interface BuildOutput {
  /** Absolute path to the directory that was read. */
  readonly root: string;
  readonly files: ReadonlyMap<string, OutputFile>;
}

const TEXT_EXTENSIONS = new Set([
  ".html",
  ".json",
  ".css",
  ".svg",
  ".txt",
  ".xml",
]);

const walk = (root: string, directory: string, into: string[]): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(root, absolute, into);
    else if (entry.isFile()) into.push(path.relative(root, absolute));
  }
};

/**
 * Read a build output directory.
 *
 * Throws when the directory is absent or is not a directory. That is the
 * "build exists" check, and it throws rather than reporting because every other
 * check in the audit is meaningless without output — a run that reported
 * "0 problems" against a missing `dist/` would be the worst possible answer.
 */
export function readBuildOutput(root: string): BuildOutput {
  let stats;
  try {
    stats = statSync(root);
  } catch {
    throw new Error(
      `Preview audit: no build output at ${root}. Run \`pnpm build\` first ` +
        `(or \`pnpm preview:audit\`, which builds and then audits).`,
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(`Preview audit: ${root} exists but is not a directory.`);
  }

  const relatives: string[] = [];
  walk(root, root, relatives);

  const files = new Map<string, OutputFile>();
  for (const relative of relatives) {
    const file = relative.split(path.sep).join("/");
    const absolute = path.join(root, relative);
    const bytes = statSync(absolute).size;
    const text = TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())
      ? readFileSync(absolute, "utf8")
      : undefined;
    files.set(file, { file, bytes, text });
  }

  if (files.size === 0) {
    throw new Error(
      `Preview audit: ${root} is empty. An empty output directory is a failed ` +
        `build, not a build with no pages.`,
    );
  }

  return { root, files };
}

/** Every emitted HTML document, in path order. */
export function htmlPages(output: BuildOutput): OutputFile[] {
  return [...output.files.values()]
    .filter((file) => file.file.endsWith(".html"))
    .sort((left, right) => left.file.localeCompare(right.file));
}
