// docs-validator tests.
//
// In-memory documents and an in-memory resolver: the rules are pure over their
// inputs, so a fixture tree on disk would add I/O without adding coverage.
//
// Runs on the Node 24 baseline via native TypeScript type stripping — no test
// runner, no dependency, no build step.
import assert from "node:assert/strict";

import { anchorOf, readDocument } from "../markdown.ts";
import type { LinkResolver } from "../links.ts";
import { validateDocuments, ruleGroups } from "../validate.ts";

let passed = 0;
const failures: string[] = [];

const check = (label: string, assertion: () => void): void => {
  try {
    assertion();
    passed += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    const detail = (error as Error).message.split("\n")[0];
    failures.push(`${label} — ${detail}`);
    console.log(`  ✗ ${label} — ${detail}`);
  }
};

/** A tiny fake repository: path → Markdown source, or `null` for a non-doc. */
const tree = new Map<string, string | null>([
  ["docs/04-implementation/target.md", "# Target\n\n## A Section\n"],
  ["docs/04-implementation/notes.ts", null],
]);

const resolver: LinkResolver = {
  resolve(from, target) {
    const segments = from.split("/").slice(0, -1);
    for (const part of target.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") {
        if (segments.length === 0) return "";
        segments.pop();
        continue;
      }
      segments.push(part);
    }
    return segments.join("/");
  },
  exists: (target) => tree.has(target),
  anchors(target) {
    const source = tree.get(target);
    if (typeof source !== "string") return null;
    return readDocument(target, source).headings.map(
      (heading) => heading.anchor,
    );
  },
};

const header = [
  "# Example Document",
  "",
  "**Status:** Draft",
  "**Owner:** Engineering",
  "**Last updated:** 2026-08-20",
  "**Phase:** 04-implementation",
  "",
].join("\n");

const doc = (body: string, path = "docs/04-implementation/example.md") =>
  readDocument(path, `${header}${body}`);

const rulesOf = (body: string, path?: string): string[] =>
  validateDocuments([doc(body, path)], resolver, ruleGroups).findings.map(
    (finding) => finding.rule,
  );

console.log("\nA conforming document produces nothing");

check("the header alone is clean", () => {
  assert.deepStrictEqual(rulesOf("\n## Section\n"), []);
});

console.log("\nMetadata block");

check("a missing metadata block is reported", () => {
  const document = readDocument(
    "docs/04-implementation/bare.md",
    "# Bare\n\nProse with no metadata.\n\n## Section\n",
  );
  const rules = validateDocuments([document], resolver).findings.map(
    (finding) => finding.rule,
  );
  assert.ok(rules.includes("meta-block-missing"), rules.join(", "));
});

check("each missing required field is reported separately", () => {
  const document = readDocument(
    "docs/04-implementation/partial.md",
    "# Partial\n\n**Status:** Draft\n**Owner:** Someone\n\n## Section\n",
  );
  const details = validateDocuments([document], resolver)
    .findings.filter((finding) => finding.rule === "meta-field-missing")
    .map((finding) => finding.detail);
  assert.equal(details.length, 2);
  assert.ok(details.some((detail) => detail.includes("Last updated")));
  assert.ok(details.some((detail) => detail.includes("Phase")));
});

check("an unknown status is reported", () => {
  const document = readDocument(
    "docs/04-implementation/active.md",
    "# Active\n\n**Status:** Active\n**Owner:** X\n**Last updated:** 2026-08-20\n**Phase:** 04-implementation\n\n## S\n",
  );
  const rules = validateDocuments([document], resolver).findings.map(
    (finding) => finding.rule,
  );
  assert.ok(rules.includes("meta-status-value"), rules.join(", "));
});

check("an annotated status is accepted", () => {
  const document = readDocument(
    "docs/04-implementation/annotated.md",
    "# Annotated\n\n**Status:** Draft — awaiting human rulings\n**Owner:** X\n**Last updated:** 2026-08-20\n**Phase:** 04-implementation\n\n## S\n",
  );
  assert.deepStrictEqual(validateDocuments([document], resolver).findings, []);
});

check("an annotated date is accepted; a relative one is not", () => {
  const annotated = readDocument(
    "docs/04-implementation/dated.md",
    "# Dated\n\n**Status:** Draft\n**Owner:** X\n**Last updated:** 2026-08-20 (re-verified against the live crawl)\n**Phase:** 04-implementation\n\n## S\n",
  );
  assert.deepStrictEqual(validateDocuments([annotated], resolver).findings, []);

  const relative = readDocument(
    "docs/04-implementation/relative.md",
    "# Relative\n\n**Status:** Draft\n**Owner:** X\n**Last updated:** today\n**Phase:** 04-implementation\n\n## S\n",
  );
  assert.ok(
    validateDocuments([relative], resolver).findings.some(
      (finding) => finding.rule === "meta-date-format",
    ),
  );
});

check("an impossible date is reported", () => {
  const document = readDocument(
    "docs/04-implementation/impossible.md",
    "# Impossible\n\n**Status:** Draft\n**Owner:** X\n**Last updated:** 2026-02-30\n**Phase:** 04-implementation\n\n## S\n",
  );
  assert.ok(
    validateDocuments([document], resolver).findings.some(
      (finding) => finding.rule === "meta-date-invalid",
    ),
  );
});

check("a phase disagreeing with the directory is reported", () => {
  const document = readDocument(
    "docs/01-discovery/misplaced.md",
    "# Misplaced\n\n**Status:** Draft\n**Owner:** X\n**Last updated:** 2026-08-20\n**Phase:** 04-implementation\n\n## S\n",
  );
  assert.ok(
    validateDocuments([document], resolver).findings.some(
      (finding) => finding.rule === "meta-phase-mismatch",
    ),
  );
});

check("an unfilled template placeholder is a WARNING, not an error", () => {
  // This kit ships its discovery documents as templates. A real date in one
  // would be a fabricated date that goes stale the moment somebody clones it,
  // so the placeholder stays and the validator names it instead.
  const document = readDocument(
    "docs/04-implementation/template.md",
    "# Template\n\n**Status:** Draft\n**Owner:** <name>\n**Last updated:** <YYYY-MM-DD>\n**Phase:** 04-implementation\n\n## S\n",
  );
  const findings = validateDocuments([document], resolver).findings;
  assert.deepStrictEqual(
    findings.map((finding) => [finding.rule, finding.severity]),
    [
      ["meta-placeholder", "warning"],
      ["meta-placeholder", "warning"],
    ],
  );
  assert.ok(findings.some((finding) => finding.detail.includes("Owner")));
  assert.ok(
    findings.some((finding) => finding.detail.includes("Last updated")),
  );
});

check(
  "a placeholder is ONE finding, not a placeholder plus a format error",
  () => {
    // `<YYYY-MM-DD>` is not a malformed date, it is an absent one. Reporting
    // both would be two findings about one slot, and the second would tell the
    // reader to fix a format rather than to fill the field.
    const document = readDocument(
      "docs/04-implementation/one.md",
      "# One\n\n**Status:** Draft\n**Owner:** X\n**Last updated:** <YYYY-MM-DD>\n**Phase:** 04-implementation\n\n## S\n",
    );
    assert.deepStrictEqual(
      validateDocuments([document], resolver).findings.map(
        (finding) => finding.rule,
      ),
      ["meta-placeholder"],
    );
  },
);

check("MUTATION: filling the placeholder clears the warning", () => {
  const filled = readDocument(
    "docs/04-implementation/filled.md",
    "# Filled\n\n**Status:** Draft\n**Owner:** Engineering\n**Last updated:** 2026-09-07\n**Phase:** 04-implementation\n\n## S\n",
  );
  assert.deepStrictEqual(validateDocuments([filled], resolver).findings, []);
});

check("a placeholder never hides a REAL bad value", () => {
  // A value that is merely wrong is still an error: only the angle-bracket
  // form is a slot.
  const document = readDocument(
    "docs/04-implementation/bad.md",
    "# Bad\n\n**Status:** Active\n**Owner:** X\n**Last updated:** today\n**Phase:** 04-implementation\n\n## S\n",
  );
  const rules = validateDocuments([document], resolver).findings.map(
    (f) => f.rule,
  );
  assert.ok(rules.includes("meta-status-value"), rules.join(", "));
  assert.ok(rules.includes("meta-date-format"), rules.join(", "));
});

console.log("\nHeading structure");

check("a skipped level is reported as a warning", () => {
  const findings = validateDocuments(
    [doc("\n## Two\n\n#### Four\n")],
    resolver,
  ).findings;
  assert.deepStrictEqual(
    findings.map((finding) => [finding.rule, finding.severity]),
    [["heading-level-skip", "warning"]],
  );
});

check("a second level-1 heading is reported as a warning", () => {
  const findings = validateDocuments(
    [doc("\n# Second Title\n")],
    resolver,
  ).findings;
  assert.deepStrictEqual(
    findings.map((finding) => [finding.rule, finding.severity]),
    [["heading-multiple-h1", "warning"]],
  );
});

check("a document with no level-1 title is an error", () => {
  const document = readDocument(
    "docs/04-implementation/untitled.md",
    "## Section\n\nProse.\n",
  );
  const rules = validateDocuments([document], resolver).findings.map(
    (finding) => finding.rule,
  );
  assert.ok(rules.includes("heading-no-h1"), rules.join(", "));
});

check("headings inside a fenced block are not headings", () => {
  assert.deepStrictEqual(
    rulesOf("\n## Section\n\n```markdown\n# Not A Title\n#### Nor This\n```\n"),
    [],
  );
});

check(
  "a tilde fence is respected, and a backtick inside it does not close it",
  () => {
    assert.deepStrictEqual(
      rulesOf("\n## Section\n\n~~~\n# Not A Title\n```\n# Still Not\n~~~\n"),
      [],
    );
  },
);

console.log("\nLinks");

check("a resolvable relative link is clean", () => {
  assert.deepStrictEqual(rulesOf("\n## S\n\n[Target](target.md)\n"), []);
});

check("a missing target is an error", () => {
  const findings = validateDocuments(
    [doc("\n## S\n\n[Gone](gone.md)\n")],
    resolver,
  ).findings;
  assert.deepStrictEqual(
    findings.map((finding) => [finding.rule, finding.severity]),
    [["link-target-missing", "error"]],
  );
});

check("a link out of the phase directory resolves", () => {
  assert.deepStrictEqual(
    rulesOf("\n## S\n\n[Up and over](../04-implementation/target.md)\n"),
    [],
  );
});

check("a target outside the repository is an error", () => {
  const rules = rulesOf("\n## S\n\n[Escape](../../../../etc/passwd)\n");
  assert.deepStrictEqual(rules, ["link-escapes-repository"]);
});

check("an absolute path is a warning", () => {
  const findings = validateDocuments(
    [doc("\n## S\n\n[Root](/docs/04-implementation/target.md)\n")],
    resolver,
  ).findings;
  assert.deepStrictEqual(
    findings.map((finding) => [finding.rule, finding.severity]),
    [["link-absolute-path", "warning"]],
  );
});

check("a known anchor on a target resolves; an unknown one warns", () => {
  assert.deepStrictEqual(rulesOf("\n## S\n\n[A](target.md#a-section)\n"), []);
  assert.deepStrictEqual(rulesOf("\n## S\n\n[A](target.md#no-such)\n"), [
    "link-anchor-missing",
  ]);
});

check("a same-document anchor is resolved against this document", () => {
  assert.deepStrictEqual(
    rulesOf("\n## Section One\n\n[Here](#section-one)\n"),
    [],
  );
  assert.deepStrictEqual(
    rulesOf("\n## Section One\n\n[There](#section-two)\n"),
    ["link-anchor-missing"],
  );
});

check("an anchor on a non-Markdown target is not judged", () => {
  assert.deepStrictEqual(rulesOf("\n## S\n\n[Code](notes.ts#L20)\n"), []);
});

check("an undefined reference link is an error, a defined one is not", () => {
  assert.deepStrictEqual(rulesOf("\n## S\n\n[text][missing]\n"), [
    "link-reference-undefined",
  ]);
  assert.deepStrictEqual(
    rulesOf("\n## S\n\n[text][ok]\n\n[ok]: target.md\n"),
    [],
  );
});

check("a reference definition pointing nowhere is reported once", () => {
  assert.deepStrictEqual(rulesOf("\n## S\n\n[ok]: gone.md\n"), [
    "link-target-missing",
  ]);
});

check("bare identifier brackets are not read as links", () => {
  // These documents use `[B2]`, `[D1]`, `[G7]` for identifiers constantly.
  // Reading the
  // shortcut reference form would bury every real finding under false ones.
  assert.deepStrictEqual(
    rulesOf("\n## S\n\nBlockers [B2] and [D1] are open.\n"),
    [],
  );
});

check("links inside code spans and fences are ignored", () => {
  assert.deepStrictEqual(
    rulesOf(
      "\n## S\n\nUse `[a](gone.md)` — and:\n\n```md\n[b](also-gone.md)\n```\n",
    ),
    [],
  );
});

check("external links are counted, never fetched", () => {
  const report = validateDocuments(
    [doc("\n## S\n\n[Astro](https://astro.build) and [mail](mailto:a@b.c)\n")],
    resolver,
  );
  assert.deepStrictEqual(report.findings, []);
  assert.equal(report.externalLinks, 2);
});

console.log("\nAnchors, ordering, and determinism");

check("anchors follow the GitHub rule", () => {
  assert.equal(anchorOf("4.5 Envelope validation"), "45-envelope-validation");
  assert.equal(anchorOf("**Bold** and `code`"), "bold-and-code");
  assert.equal(anchorOf("A — B"), "a--b");
  assert.equal(anchorOf("[Link](x.md) text"), "link-text");
});

check("repeated headings get numeric anchors, in document order", () => {
  const document = readDocument(
    "docs/04-implementation/repeat.md",
    "# T\n\n## Rules\n\n## Rules\n\n## Rules\n",
  );
  assert.deepStrictEqual(
    document.headings.map((heading) => heading.anchor),
    ["t", "rules", "rules-1", "rules-2"],
  );
});

check("findings are ordered by path, then line, then rule", () => {
  const report = validateDocuments(
    [
      doc(
        "\n## S\n\n[b](gone-b.md)\n[a](gone-a.md)\n",
        "docs/04-implementation/z.md",
      ),
      doc("\n## S\n\n[c](gone-c.md)\n", "docs/04-implementation/a.md"),
    ],
    resolver,
  );
  assert.deepStrictEqual(
    report.findings.map((finding) => `${finding.path}:${finding.line}`),
    [
      "docs/04-implementation/a.md:10",
      "docs/04-implementation/z.md:10",
      "docs/04-implementation/z.md:11",
    ],
  );
});

check("the report is a pure function of its inputs", () => {
  const body = "\n## S\n\n[gone](gone.md)\n\n#### Skip\n";
  assert.deepStrictEqual(
    validateDocuments([doc(body)], resolver),
    validateDocuments([doc(body)], resolver),
  );
});

check("rule groups can be selected independently", () => {
  const body = "\n#### Skip\n\n[gone](gone.md)\n";
  assert.deepStrictEqual(
    validateDocuments([doc(body)], resolver, ["links"]).findings.map(
      (finding) => finding.rule,
    ),
    ["link-target-missing"],
  );
  assert.deepStrictEqual(
    validateDocuments([doc(body)], resolver, ["headings"]).findings.map(
      (finding) => finding.rule,
    ),
    ["heading-level-skip"],
  );
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\ndocs-validator FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
