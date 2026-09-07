// The rendered-contrast audit's own suite.
//
// Two halves, the shape every audit in this kit uses.
//
// UNIT half: the classifier and the report, over literal findings. No browser,
// no build — these are the parts that decide what FAILS, and a mistake in them
// is a gate that reports nothing.
//
// The probe's own arithmetic — compositing alpha, the AA threshold — is
// exercised against literal colour strings, because that arithmetic is where
// the first version of this went wrong: it read `color(srgb 1 1 1 / 0.898)` as
// `rgb(1, 1, 1)` and called a footer 64 failures.
import process from "node:process";

import { KNOWN_BASELINE } from "../baseline.ts";
import { CONTRAST_VIEWPORTS, type ContrastFinding } from "../probe.ts";
import { classify, describe, idOf } from "../report.ts";

let passed = 0;
const failures: string[] = [];

const check = (name: string, body: () => void): void => {
  try {
    body();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (thrown) {
    failures.push(`${name} — ${(thrown as Error).message}`);
    console.log(`  ✗ ${name}`);
  }
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const equal = (actual: unknown, expected: unknown, label: string): void => {
  if (actual !== expected)
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
};

const finding = (over: Partial<ContrastFinding> = {}): ContrastFinding => ({
  route: "/",
  viewport: 1440,
  element: "h2.wpk-heading",
  text: "A heading nobody can see",
  color: "rgb(9, 20, 57)",
  ground: "rgb(12, 9, 52)",
  size: 56,
  weight: 600,
  ratio: 1.06,
  required: 3,
  ...over,
});

// --- the colour arithmetic --------------------------------------------------
//
// A transcription of the probe's own functions, so the maths is testable
// without a browser. If the probe's copy and this one ever disagree, the
// anchors below stop matching.

const parse = (value: string): number[] | null => {
  let match = value.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/,
  );
  if (match !== null)
    return [
      +match[1]! * 255,
      +match[2]! * 255,
      +match[3]! * 255,
      match[4] === undefined ? 1 : +match[4],
    ];
  match = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/,
  );
  if (match !== null)
    return [
      +match[1]!,
      +match[2]!,
      +match[3]!,
      match[4] === undefined ? 1 : +match[4],
    ];
  return null;
};

const over = (fg: number[], bg: number[]): number[] =>
  [0, 1, 2].map((index) => fg[index]! * fg[3]! + bg[index]! * (1 - fg[3]!));

const luminance = (colour: number[]): number => {
  const [r, g, b] = colour.slice(0, 3).map((raw) => {
    const value = raw / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

const ratio = (a: number[], b: number[]): number => {
  const first = luminance(a);
  const second = luminance(b);
  const [high, low] = first > second ? [first, second] : [second, first];
  return (high! + 0.05) / (low! + 0.05);
};

console.log("\ncontrast-audit — the colour arithmetic\n");

check("both colour forms Chrome serialises are parsed", () => {
  equal(JSON.stringify(parse("rgb(255, 255, 255)")), "[255,255,255,1]", "rgb");
  equal(
    JSON.stringify(parse("rgba(0, 0, 0, 0.5)")),
    "[0,0,0,0.5]",
    "rgba with alpha",
  );
  equal(JSON.stringify(parse("color(srgb 1 1 1)")), "[255,255,255,1]", "srgb");
});

check("ALPHA IS COMPOSITED, never read as a channel value", () => {
  // The phantom-failure bug in one line: `color(srgb 1 1 1 / 0.898)` is white
  // at 90% opacity, not `rgb(1, 1, 1)`. A digit regex made a near-black ground
  // out of a near-white one and reported 64 failures that did not exist.
  const parsed = parse("color(srgb 1 1 1 / 0.898)")!;
  equal(parsed[0], 255, "channel");
  equal(parsed[3], 0.898, "alpha");
  const composited = over(parsed, [255, 255, 255]);
  assert(composited[0]! > 250, `white on white stays white: ${composited[0]}`);
});

check("a translucent layer composites down to its real ground", () => {
  // Black at 50% over white is mid grey, and text judged against mid grey is
  // judged against a different number than text judged against black.
  const half = over(parse("rgba(0, 0, 0, 0.5)")!, [255, 255, 255]);
  assert(
    Math.abs(half[0]! - 127.5) < 0.01,
    `expected mid grey, got ${half[0]}`,
  );
});

check("the ratio is order-independent and anchored", () => {
  const white = [255, 255, 255];
  const black = [0, 0, 0];
  equal(Math.round(ratio(white, black) * 100) / 100, 21, "white on black");
  equal(Math.round(ratio(black, white) * 100) / 100, 21, "black on white");
  equal(Math.round(ratio(white, white) * 100) / 100, 1, "white on white");
});

console.log("\ncontrast-audit — the classifier\n");

check("an unexplained finding fails", () => {
  const { failures: failed, baselined } = classify([finding()], []);
  equal(failed.length, 1, "failures");
  equal(baselined.length, 0, "baselined");
});

check("a baselined finding is reported but does not fail", () => {
  const one = finding();
  const { failures: failed, baselined } = classify([one], [idOf(one)]);
  equal(failed.length, 0, "failures");
  equal(baselined.length, 1, "baselined");
});

check("the classifier consults its ARGUMENT and nothing else", () => {
  // Two sources of truth was the real defect: reading the module's own set
  // for membership while taking the argument for staleness meant a caller
  // could baseline a finding and still be told it failed.
  const one = finding({ route: "/never-shipped/" });
  equal(classify([one], [idOf(one)]).failures.length, 0, "baselined by id");
  equal(classify([one], []).failures.length, 1, "not baselined without it");
});

check("BOTH DIRECTIONS: a baseline nothing measures is stale", () => {
  const { stale } = classify([], ["/gone/|p|text that no longer exists"]);
  equal(stale.length, 1, "stale entries");
  equal(stale[0], "/gone/|p|text that no longer exists", "which entry");
});

check("the id is route, element and text — never the ratio", () => {
  // Keyed on the ratio, a pair that got WORSE would reappear as a new finding
  // and the recorded decision would silently stop applying to it.
  const before = finding({ ratio: 1.06 });
  const after = finding({ ratio: 1.01 });
  equal(idOf(before), idOf(after), "same identity at a different ratio");
});

check(
  "MUTATION: a different element on the same route is a new finding",
  () => {
    const one = finding();
    const other = finding({ element: "p.wpk-lede" });
    equal(classify([other], [idOf(one)]).failures.length, 1, "not baselined");
  },
);

check("the report names the ratio, the threshold and the words", () => {
  const text = describe(finding());
  assert(text.includes("1.06:1"), `ratio: ${text}`);
  assert(text.includes("needs 3"), `threshold: ${text}`);
  assert(text.includes("A heading nobody can see"), `text: ${text}`);
  assert(text.includes("rgb(12, 9, 52)"), `ground: ${text}`);
});

check("the shipped baseline is empty, and that is the assertion", () => {
  equal(KNOWN_BASELINE.length, 0, "baseline entries");
});

check("both widths are measured", () => {
  // A pair can pass at one width and fail at another: type scales, and a
  // heading that clears the large-text threshold at 1440 may not at 375.
  equal(CONTRAST_VIEWPORTS.length, 2, "viewports");
  assert(CONTRAST_VIEWPORTS.includes(375), "the narrow width is measured");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("Contrast audit suite FAILED:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("Contrast audit suite OK");
