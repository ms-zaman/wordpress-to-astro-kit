// `pnpm render:digest-test`
//
// The judgement half, with no browser and no filesystem. `compare.ts` and
// `sample.ts` are pure by design so that the parts which decide whether a
// build differs, and which pages get recorded, are testable without Chrome.
//
// What is NOT tested here is `digest.ts`: reading a page needs a rendering
// engine, and a fake one would assert that the fake behaves. Its correctness
// is established by running it twice against one build and getting identical
// bytes — the determinism run the README describes.
import process from "node:process";

import {
  compareDigests,
  describe,
  lineDifference,
  summarize,
  type Change,
  type DigestFile,
} from "../compare.ts";
import { digestRoutes, sampleIndices, SAMPLE_SIZE } from "../sample.ts";

let passed = 0;
const failures: string[] = [];

const check = (name: string, body: () => void): void => {
  try {
    body();
    passed += 1;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (error) {
    failures.push(`${name} — ${(error as Error).message}`);
    process.stdout.write(`  ✗ ${name}\n`);
  }
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const equal = (actual: unknown, expected: unknown, message: string): void => {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right)
    throw new Error(`${message}: expected ${right}, got ${left}`);
};

const file = (name: string, ...lines: string[]): DigestFile => ({
  file: name,
  text: `${lines.join("\n")}\n`,
});

process.stdout.write("render-digest — comparison\n\n");

check("an unchanged build produces no changes", () => {
  const one = [file("home-1440.txt", "main | 0,0 1440x800 | bg:white")];
  equal(compareDigests(one, one), [], "changes");
});

check("a changed property is reported with both sides", () => {
  const before = [file("home-1440.txt", "main | 0,0 1440x800 | bg-image:none")];
  const after = [
    file("home-1440.txt", "main | 0,0 1440x800 | bg-image:url(/a.png)"),
  ];
  const changes = compareDigests(before, after);
  equal(changes.length, 1, "one change");
  const change = changes[0] as Extract<Change, { kind: "changed" }>;
  equal(change.kind, "changed", "kind");
  equal(change.removed, ["main | 0,0 1440x800 | bg-image:none"], "removed");
  equal(change.added, ["main | 0,0 1440x800 | bg-image:url(/a.png)"], "added");
});

check("a route with no baseline is `unrecorded`, not silently accepted", () => {
  const changes = compareDigests([], [file("new-1440.txt", "main | 0,0 1x1")]);
  equal(changes.length, 1, "one change");
  equal(changes[0]!.kind, "unrecorded", "kind");
});

check(
  "an unrecorded route is told to be looked at before it is recorded",
  () => {
    // The ordering rule PLAYBOOK.md §6 states, said where somebody is about to
    // break it: a baseline taken before a person looked records the defect as
    // the reference.
    const [change] = compareDigests(
      [],
      [file("new-1440.txt", "main | 0,0 1x1")],
    );
    assert(
      describe(change!).includes("LOOK at the route first"),
      describe(change!),
    );
  },
);

check("a baseline the build no longer produces is `vanished`", () => {
  const changes = compareDigests([file("gone-1440.txt", "main | 0,0 1x1")], []);
  equal(changes.length, 1, "one change");
  equal(changes[0]!.kind, "vanished", "kind");
  equal(changes[0]!.file, "gone-1440.txt", "file");
});

// Digest lines are `label | geometry | properties[ | "text"]`; the fixtures
// below use that shape because the comparison parses it.
const line = (label: string, geometry: string, text = ""): string =>
  `${label} | ${geometry} | bg:white${text ? ` | "${text}"` : ""}`;

check("an inserted element is one addition, not a renumbering", () => {
  // The reason the digest is indentation-keyed rather than path-keyed: adding
  // a card should read as one added line, not as every later sibling changing.
  const before = file(
    "p-1440.txt",
    line("ul", "0,0 100x60"),
    line("  li", "0,0 100x20", "one"),
    line("  li", "0,40 100x20", "three"),
  );
  const after = file(
    "p-1440.txt",
    line("ul", "0,0 100x60"),
    line("  li", "0,0 100x20", "one"),
    line("  li", "0,20 100x20", "two"),
    line("  li", "0,40 100x20", "three"),
  );
  const { added, removed } = lineDifference(before.text, after.text);
  equal(added, [line("  li", "0,20 100x20", "two")], "added");
  equal(removed, [], "removed");
});

check("a repeated line is counted, not collapsed", () => {
  // Cards sharing a signature. A set difference would report nothing when one
  // of them disappears.
  const card = line("li.wpk-card", "0,0 100x20");
  const before = file("p-1440.txt", card, card, card);
  const after = file("p-1440.txt", card, card);
  const { added, removed } = lineDifference(before.text, after.text);
  equal(removed, [card], "removed");
  equal(added, [], "added");
});

check("a file differing only within tolerance is not reported at all", () => {
  // The text differs; the difference does not. Comparing raw text first
  // reported nine such files as changed with an empty diff under each.
  const before = [file("p-1440.txt", "h1 | 870,240 362x29 | bg:white")];
  const after = [file("p-1440.txt", "h1 | 871,240 363x29 | bg:white")];
  equal(compareDigests(before, after), [], "changes");
});

check("a box that moved a pixel is not a change", () => {
  const before = file("p-1440.txt", line("h1.wpk-heading", "870,240 362x29"));
  const after = file("p-1440.txt", line("h1.wpk-heading", "871,240 363x29"));
  const { added, removed } = lineDifference(before.text, after.text);
  equal(added, [], "added");
  equal(removed, [], "removed");
});

check("a box that moved two pixels IS a change", () => {
  const before = file("p-1440.txt", line("h1.wpk-heading", "870,240 362x29"));
  const after = file("p-1440.txt", line("h1.wpk-heading", "872,240 362x29"));
  const { added, removed } = lineDifference(before.text, after.text);
  equal(added.length, 1, "added");
  equal(removed.length, 1, "removed");
});

check("the tolerance never excuses a painted property", () => {
  // The whole point of a tolerance on geometry ALONE. A background that
  // changed must be reported however little the box moved.
  const before = file(
    "p-1440.txt",
    "section::before | 1440x723 | bg-image:url(/a.png)",
  );
  const after = file(
    "p-1440.txt",
    "section::before | 1441x723 | bg-image:none",
  );
  const { added, removed } = lineDifference(before.text, after.text);
  equal(added.length, 1, "added");
  equal(removed.length, 1, "removed");
});

check("`display:none` is matched exactly, not tolerated", () => {
  // It carries no numbers, so a naive tolerance would treat it as "no
  // geometry" and match it against anything else carrying none.
  const before = file("p-1440.txt", "div.wpk-card | display:none | bg:white");
  const after = file("p-1440.txt", "div.wpk-card | 0,0 10x10 | bg:white");
  const { added, removed } = lineDifference(before.text, after.text);
  equal(added.length, 1, "added");
  equal(removed.length, 1, "removed");
});

check("changes are sorted by file, so two runs read the same", () => {
  const changes = compareDigests(
    [],
    [file("z-1440.txt", "a"), file("a-1440.txt", "a"), file("m-1440.txt", "a")],
  );
  equal(
    changes.map((change) => change.file),
    ["a-1440.txt", "m-1440.txt", "z-1440.txt"],
    "order",
  );
});

check("a description quotes both sides and caps how much it quotes", () => {
  const before = file(
    "p-1440.txt",
    ...Array.from({ length: 20 }, (unused, index) => `li | ${index}`),
  );
  const after = file("p-1440.txt", "li | different");
  const changes = compareDigests([before], [after]);
  const text = describe(changes[0]!, 3);
  assert(text.includes("p-1440.txt"), "names the file");
  assert(text.includes("+ li | different"), "quotes the addition");
  assert(text.includes("more"), "says how much it elided");
  assert(text.split("\n").length < 12, `too long:\n${text}`);
});

check("the summary counts each kind", () => {
  const changes = compareDigests(
    [file("gone-1440.txt", "a"), file("same-1440.txt", "a")],
    [file("same-1440.txt", "b"), file("new-1440.txt", "a")],
  );
  const text = summarize(changes);
  assert(text.includes("1 changed"), `changed: ${text}`);
  assert(text.includes("1 unrecorded"), `unrecorded: ${text}`);
  assert(text.includes("1 vanished"), `vanished: ${text}`);
});

check("an empty comparison says so plainly", () => {
  assert(
    summarize([]).includes("exactly as it was recorded"),
    "no-change summary",
  );
});

process.stdout.write("\nrender-digest — the sample\n\n");

/** A family map of `count` post routes, all from one template. */
const postFamily = (count: number): Map<string, string> =>
  new Map(
    Array.from({ length: count }, (unused, index) => [
      `/post-${String(index).padStart(3, "0")}/`,
      "src/pages/[...path].astro#post",
    ]),
  );

check("a route with no template family is always recorded", () => {
  // A static route — `/`, `/404/`, `/search/` — is its own template, so there
  // is nothing to sample it down to. The manifest omits those from the map.
  const routes = ["/", "/404/", "/search/"];
  equal(digestRoutes(routes, new Map()), routes, "routes");
});

check("a family smaller than the sample is recorded whole", () => {
  const templates = postFamily(3);
  equal(digestRoutes([...templates.keys()], templates).length, 3, "kept");
});

check("a large family is reduced to the sample size", () => {
  const templates = postFamily(250);
  const kept = digestRoutes([...templates.keys()], templates);
  equal(kept.length, SAMPLE_SIZE, "kept");
});

check("the sample keeps the first and the last member", () => {
  // Not "the first N". The ends of a family are where a template's edge cases
  // live, and a sample that dropped them would stop watching them.
  const templates = postFamily(250);
  const kept = digestRoutes([...templates.keys()], templates);
  assert(kept.includes("/post-000/"), `first missing: ${kept.join(" ")}`);
  assert(kept.includes("/post-249/"), `last missing: ${kept.join(" ")}`);
});

check("the sample is deterministic across runs", () => {
  // The one thing this file must not do is reshuffle: a moving sample makes
  // every digest diff unreadable.
  const templates = postFamily(120);
  const routes = [...templates.keys()];
  equal(
    digestRoutes(routes, templates),
    digestRoutes([...routes].reverse(), templates),
    "same set regardless of input order",
  );
});

check("two families are sampled independently", () => {
  const templates = new Map([
    ...postFamily(50),
    ...Array.from({ length: 40 }, (unused, index): [string, string] => [
      `/guide/g-${index}/`,
      "src/pages/[...path].astro#page",
    ]),
  ]);
  const kept = digestRoutes([...templates.keys()], templates);
  equal(kept.filter((route) => route.startsWith("/post-")).length, 6, "posts");
  equal(
    kept.filter((route) => route.startsWith("/guide/")).length,
    6,
    "guides",
  );
});

check("MUTATION: adding a page to a family moves the sample", () => {
  // The set of pages is part of what the digest records, so a post appearing
  // or disappearing SHOULD change what is recorded.
  const before = postFamily(50);
  const after = postFamily(51);
  assert(
    JSON.stringify(digestRoutes([...before.keys()], before)) !==
      JSON.stringify(digestRoutes([...after.keys()], after)),
    "the sample did not move",
  );
});

check("with no manifest, every route is recorded", () => {
  // The safe direction: a digest that records too much is slow, and one that
  // silently records too little is a gate with a hole in it.
  const routes = ["/", "/a/", "/b/"];
  equal(digestRoutes(routes, new Map()), routes, "routes");
});

check("evenly spaced indices span the whole range", () => {
  equal(sampleIndices(10, 3), [0, 5, 9], "spaced");
  equal(sampleIndices(3, 6), [0, 1, 2], "smaller than the sample");
  equal(sampleIndices(10, 1), [0], "a sample of one");
});

process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
  process.exit(1);
}
process.stdout.write("Render digest comparison OK\n");
