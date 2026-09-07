# scripts/docs-validator/

Markdown **link**, **metadata block**, and **heading structure** validation for
this repository's documentation surface.

**Read-only** — no document is written, moved, or reformatted. It reports; what
a document should say is a person's call, and several of the documents it reads
are governance records an agent must not edit.

## Running it

```bash
node scripts/docs-validator/cli.ts              # or: pnpm docs:validate
node scripts/docs-validator/cli.ts --strict     # warnings fail too
node scripts/docs-validator/cli.ts --json       # machine-readable report
node scripts/docs-validator/cli.ts --rules=links docs decisions
node scripts/docs-validator/cli.ts --help
```

Paths default to `docs`. Directories are walked for `.md` files in sorted order.
Exit `0` when there are no errors, `1` when there are, `2` on bad invocation.

**A CI step**, in the `validate` job. A cross-reference that no longer resolves
is a source of truth that has silently stopped pointing anywhere, and this kit's
documents are dense with cross-references — they are the structure, not
decoration.

## Rules

Severity splits on **mechanical breakage**: a document nothing can link to is
broken; an outline that renders correctly but deviates from convention is not.
Grading the second as the first buries the first. `--strict` promotes everything
for anyone who disagrees.

### Metadata — AGENTS.md §8

| Rule                  | Severity | Reports                                              |
| --------------------- | -------- | ---------------------------------------------------- |
| `meta-title`          | error    | The document does not open with `# <Title>`          |
| `meta-block-missing`  | error    | No `**Field:** value` block follows the title        |
| `meta-field-missing`  | error    | `Status`, `Owner`, `Last updated`, or `Phase` absent |
| `meta-status-value`   | error    | Status is not `Draft` · `In Review` · `Approved`     |
| `meta-owner-empty`    | error    | `Owner` is blank                                     |
| `meta-date-format`    | error    | `Last updated` does not begin with an ISO 8601 date  |
| `meta-date-invalid`   | error    | The date is not a real calendar date                 |
| `meta-phase-mismatch` | error    | `Phase` disagrees with the phase directory (§9.3)    |
| `meta-placeholder`    | warning  | A field is still `<YYYY-MM-DD>` or `<name>`          |

**An unfilled placeholder is a warning, not an error.** A field written in
angle brackets is a template slot. This kit ships its discovery and
implementation documents as templates, and a real date in one would be a
fabricated date that goes stale the moment somebody clones it — so the
placeholder stays and the validator names the field instead. It is counted on
every run, and `--strict` promotes it for anyone who disagrees.

Two established repository conventions are accepted deliberately: **extra
fields** (several documents carry `**Scope:**`), and a **trailing annotation**
on `Status` and `Last updated` — `2026-08-20 (re-verified against the live crawl)`
records _why_ a document was touched and is more useful than a bare date. The
leading token is what gets checked.

### Headings

| Rule                                      | Severity | Reports                                    |
| ----------------------------------------- | -------- | ------------------------------------------ |
| `heading-none` / `heading-no-h1`          | error    | No headings, or no level-1 title           |
| `heading-empty` / `heading-unaddressable` | error    | A heading no link can address              |
| `heading-multiple-h1`                     | warning  | A second `#` — one topic per file (§8)     |
| `heading-h1-not-first`                    | warning  | The document opens below level 1           |
| `heading-level-skip`                      | warning  | The outline jumps a level, so it mis-nests |

Duplicate headings are **not** reported: `### Rules` under several sections is
legitimate, and the anchor rule disambiguates them with `-1`, `-2`, … which the
link checker resolves.

### Links

| Rule                       | Severity | Reports                                      |
| -------------------------- | -------- | -------------------------------------------- |
| `link-target-missing`      | error    | A relative target that does not exist        |
| `link-empty`               | error    | A link with no target                        |
| `link-escapes-repository`  | error    | A target resolving outside the repository    |
| `link-reference-undefined` | error    | `[text][label]` with no definition           |
| `link-absolute-path`       | warning  | `/docs/…` — resolves against the server root |
| `link-anchor-missing`      | warning  | `#anchor` matching no heading in the target  |

**External links are counted, never fetched.** Fetching would make the output
non-deterministic and network-dependent, and would hand this repository's link
graph to third parties for nothing. The summary line reports how many were
skipped.

**Bare identifier brackets are not links.** These documents use `[B2]`, `[D1]`,
`[G7]` constantly; reading the Markdown _shortcut reference_ form would bury
every real finding under false ones. Only inline `[text](target)` and the full
and collapsed reference forms are read.

Fenced code blocks and inline code spans are skipped everywhere — a code sample
containing `# Title` is a sample, not a heading.

## Design

| Constraint                  | How                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zero dependency**         | Node 24 built-ins and native TypeScript type stripping. No Markdown parser: AGENTS.md §8's conventions are line-shaped, so the reader is line-shaped                        |
| **Deterministic**           | Findings carry a total order — path, line, rule, detail — and directory walks are sorted. Two runs over one tree produce byte-identical output, so the report can be diffed |
| **Testable without a tree** | The rules are pure; the filesystem is reached through a `LinkResolver` the CLI supplies. `cli.ts` is the only module importing `node:fs`                                    |

| File                                       | Owns                                                             |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `markdown.ts`                              | Line reading, fence tracking, heading extraction, GitHub anchors |
| `metadata.ts` · `headings.ts` · `links.ts` | One rule group each                                              |
| `finding.ts`                               | The finding record and its total order                           |
| `validate.ts`                              | Orchestration and the report shape                               |
| `cli.ts`                                   | Argument parsing, the filesystem resolver, output                |

## Tests

```bash
node scripts/docs-validator/test/run.ts   # or: pnpm docs:validate-test
```

35 assertions over in-memory documents and an in-memory resolver.

## Not covered

- **Prose conventions.** AGENTS.md also forbids relative dates ("recently")
  in body text. Scanning prose for that is a different kind of check with a
  different false-positive profile, and it is not attempted here.
- **Stale counts.** A document asserting "10 collections" when the repository
  has 11 is _drift_, not a Markdown defect. Nothing here checks it; a number in
  a document is only as good as the date beside it.
