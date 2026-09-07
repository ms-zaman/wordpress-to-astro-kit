// Reading a command line, once, for every CLI in this kit.
//
// ## Why this is not three lines at each call site
//
// It was, and it was wrong in all three. Each CLI found its subcommand with
// `argv.find((argument) => !argument.startsWith("--"))`, which reads the first
// token that is not a flag — and **a flag's VALUE is not a flag**:
//
//   node scripts/content-reconcile/cli.ts --dist /some/path
//   → unknown command "/some/path"
//
// It only worked while the subcommand happened to come first. The moment
// somebody relied on a default subcommand and passed a valued flag, the value
// became the command, and the message blamed the user for a path they had
// typed correctly.
//
// So the parser is told which flags take a value. That is the one piece of
// knowledge that makes the split unambiguous, and it cannot be inferred:
// `--no-media post` is a boolean flag followed by a positional, and
// `--type post` is a flag and its value, and they are the same shape.
export interface ArgSpec {
  /** Flags that consume the token after them. */
  readonly valued?: readonly string[];
  /** The subcommand to assume when none is given. */
  readonly defaultCommand?: string;
}

export interface ParsedArgs {
  /** The first positional, or the default. */
  readonly command: string;
  /** Every positional, in order, including the command. */
  readonly positional: readonly string[];
  /** True for a flag that was present. */
  readonly has: (flag: string) => boolean;
  /** A valued flag's value, or the fallback. */
  readonly value: (flag: string, fallback: string) => string;
}

export function parseArgs(
  argv: readonly string[],
  spec: ArgSpec = {},
): ParsedArgs {
  const valued = new Set(spec.valued ?? []);
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    // `--flag=value` too, because somebody will write it that way.
    const equals = token.indexOf("=");
    if (equals > 0) {
      values.set(token.slice(0, equals), token.slice(equals + 1));
      flags.add(token.slice(0, equals));
      continue;
    }
    flags.add(token);
    if (!valued.has(token)) continue;
    const next = argv[index + 1];
    // A valued flag at the end of the line, or followed by another flag, has
    // no value. Recording one would silently take the next flag as data.
    if (next === undefined || next.startsWith("--")) continue;
    values.set(token, next);
    index += 1;
  }

  return {
    command: positional[0] ?? spec.defaultCommand ?? "",
    positional,
    has: (flag) => flags.has(flag),
    value: (flag, fallback) => values.get(flag) ?? fallback,
  };
}
