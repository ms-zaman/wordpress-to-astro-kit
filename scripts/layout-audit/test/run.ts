#!/usr/bin/env node
// Tests for the layout audit.
//
// The measuring half needs a browser and is exercised by `pnpm layout:audit`
// itself. What is tested here is the JUDGEMENT half: `findingsFor` is pure,
// and it is where a suppression bug would hide.
//
// Every case is mutation-shaped — it proves the checker RESPONDS, not that it
// always returns the same answer.
import process from "node:process";

import { findingsFor, type Measurement } from "../audit.ts";
import { KNOWN_LAYOUT_BASELINE } from "../baseline.ts";
import { bySeverity, idOf, sortFindings } from "../finding.ts";

let passed = 0;
const failures: string[] = [];
const check = (name: string, assertion: () => void): void => {
  try {
    assertion();
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
const equal = <T>(actual: T, expected: T, message: string): void => {
  if (actual !== expected)
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
};

const fit = (route: string, viewport: number): Measurement => ({
  route,
  viewport,
  scrollWidth: viewport,
  offenders: [],
  controlOverflows: [],
});
const over = (route: string, viewport: number, by = 100): Measurement => ({
  route,
  viewport,
  scrollWidth: viewport + by,
  offenders: [`code (right ${viewport + by}, width 400)`],
  controlOverflows: [],
});

/**
 * A page whose document fits and whose FORM does not.
 *
 * The whole point of the second measurement: `scrollWidth` is clean here,
 * because a control overflowing its own grid cell sits inside a panel wide
 * enough to hold it.
 */
const controlOver = (route: string, viewport: number): Measurement => ({
  ...fit(route, viewport),
  controlOverflows: [
    "input.wpk-form__control is 487px inside div.wpk-form__field at 453px",
  ],
});

console.log("Layout audit");

check("a page that fits produces no finding", () => {
  equal(findingsFor([fit("/", 320)], []).length, 0, "findings");
});

check("a page one pixel over the viewport is an error", () => {
  const findings = findingsFor([over("/", 320, 1)], []);
  equal(findings.length, 1, "findings");
  equal(findings[0]!.severity, "error", "severity");
});

check("the offending elements reach the message", () => {
  const findings = findingsFor([over("/about/", 320)], []);
  assert(
    findings[0]!.detail.includes("code (right 420, width 400)"),
    `offender missing from: ${findings[0]!.detail}`,
  );
});

check("MUTATION: shrinking the page removes the finding", () => {
  const overflowing = over("/", 320);
  equal(findingsFor([overflowing], []).length, 1, "before");
  equal(
    findingsFor([{ ...overflowing, scrollWidth: 320 }], []).length,
    0,
    "after",
  );
});

check("a control wider than its owner is an error, on a page that fits", () => {
  const measurement = controlOver("/contact/", 1440);
  equal(measurement.scrollWidth, 1440, "the document fits");
  const findings = findingsFor([measurement], []);
  equal(findings.length, 1, "findings");
  equal(findings[0]!.severity, "error", "severity");
  equal(findings[0]!.check, "control-overflow", "check");
  assert(
    findings[0]!.detail.includes("487px inside div.wpk-form__field at 453px"),
    `the control and its owner are missing from: ${findings[0]!.detail}`,
  );
});

check("MUTATION: a control that fits its owner removes the finding", () => {
  const measurement = controlOver("/contact/", 1440);
  equal(findingsFor([measurement], []).length, 1, "before");
  equal(
    findingsFor([{ ...measurement, controlOverflows: [] }], []).length,
    0,
    "after",
  );
});

check("the two overflows are separate findings, not one", () => {
  // Without this, a page with both would report one finding and fixing either
  // half would look like fixing the page.
  const both: Measurement = {
    ...over("/contact/", 1440),
    controlOverflows: ["input is 487px inside div at 453px"],
  };
  const findings = findingsFor([both], []);
  equal(findings.length, 2, "findings");
  equal(
    findings
      .map((finding) => finding.check)
      .sort()
      .join(","),
    "control-overflow,overflow",
    "checks",
  );
});

check("a recorded overflow is a baseline finding, not an error", () => {
  const id = idOf({
    severity: "error",
    check: "overflow",
    at: "/about/",
    key: "320",
    detail: "",
  });
  const findings = findingsFor(
    [over("/about/", 320)],
    [{ id, cause: "an embed nobody here controls" }],
  );
  equal(findings.length, 1, "findings");
  equal(findings[0]!.severity, "baseline", "severity");
  assert(
    findings[0]!.detail.includes("an embed nobody here controls"),
    "the recorded cause should reach the message",
  );
});

check(
  "BOTH DIRECTIONS: a recorded overflow that stopped happening is an error",
  () => {
    // The assertion that makes the baseline a record rather than a suppression
    // file. A defect that quietly disappears means behaviour moved without the
    // record moving.
    const findings = findingsFor(
      [fit("/about/", 320)],
      [{ id: "overflow|/about/|320", cause: "an embed" }],
    );
    equal(findings.length, 1, "findings");
    equal(findings[0]!.severity, "error", "severity");
    assert(
      findings[0]!.detail.includes("does not produce it"),
      `expected the disappearance to be named, got: ${findings[0]!.detail}`,
    );
  },
);

check(
  "an empty measurement set is reported rather than passing silently",
  () => {
    const findings = findingsFor([], []);
    equal(findings.length, 1, "findings");
    equal(findings[0]!.check, "viewport-coverage", "check");
  },
);

check("findings sort by route then viewport", () => {
  const sorted = sortFindings(
    findingsFor([over("/z/", 320), over("/a/", 1024), over("/a/", 320)], []),
  );
  equal(
    sorted.map((f) => `${f.at}@${f.key}`).join(" "),
    "/a/@320 /a/@1024 /z/@320",
    "order",
  );
});

check("the shipped baseline is empty, and that is the assertion", () => {
  // An entry here means a defect is waiting on a person. The kit ships with
  // none, so a project that adds one is making a deliberate record.
  equal(KNOWN_LAYOUT_BASELINE.length, 0, "baseline entries");
});

check("severity helpers partition the findings", () => {
  const findings = findingsFor([over("/", 320), fit("/", 1024)], []);
  equal(bySeverity(findings, "error").length, 1, "errors");
  equal(bySeverity(findings, "baseline").length, 0, "baselines");
});

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log("Layout audit tests FAILED:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log("Layout audit tests OK");
