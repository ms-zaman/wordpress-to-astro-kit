// content-reconcile suite.
//
// No network, no build, no files. `surface.ts` and `reconcile.ts` are pure, so
// every rule can be exercised by handing it two strings of HTML — which is
// also the only way to test the cases that matter, because each of them is a
// specific way one page can differ from another.
import process from "node:process";

import { resolveMarkup, GUTENBERG, ELEMENTOR, PROFILES } from "../builders.ts";

import {
  problemsOfKind,
  reconcile,
  type RoutePairSurfaces,
} from "../reconcile.ts";
import { RULINGS, rulingViolations, type Ruling } from "../rulings.ts";
import {
  asked,
  MAX_LENGTH,
  normalise,
  saidBy,
  says,
  surfaceOf,
} from "../surface.ts";

// These fixtures are Elementor markup, so they are read by Elementor's rules.
// That is now a choice the test states, not a default the reader inherits.
const elementor = resolveMarkup({ builders: ["elementor"] });

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

const equal = (actual: unknown, expected: unknown, label: string): void =>
  assert(
    actual === expected,
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );

const pair = (
  liveHtml: string,
  oursHtml: string,
  route = "/pricing",
): RoutePairSurfaces => ({
  route,
  live: surfaceOf(liveHtml, { dropHidden: true, markup: elementor }),
  ours: surfaceOf(oursHtml, { dropHidden: false }),
});

// ---------------------------------------------------------------------------
console.log("\nThe comparison key");

check("two engines' spacing and entities collapse to one key", () => {
  // `$33.33/month` and `$33.33 /month` are one price rendered by two engines,
  // because one puts the figure and the period in sibling elements.
  equal(normalise("$33.33 / month"), "$33.33/month", "the slash is the join");
  equal(normalise("It&#8217;s here"), "it's here", "an entity apostrophe");
  equal(normalise("It’s here"), "it's here", "a typographic apostrophe");
  equal(normalise("A  —  B"), "a - b", "an em dash");
  equal(normalise("<b>Bold</b> text"), "bold text", "tags come out");
});

check("A MATCH ENDS WHERE A WORD ENDS", () => {
  // Plain containment is not enough, and this case is why: `$999.99/mo` sits
  // inside `$999.99/month`, so a struck-through price matched the live one and
  // a real difference reported itself as agreement.
  assert(says("plans from $999.99/month", "$999.99/month"), "the real match");
  assert(
    !says("plans from $999.99/month", "$999.99/mo"),
    "a prefix is not a match",
  );
  assert(
    says("the enterprise plan", "enterprise"),
    "a whole word inside prose",
  );
});

console.log("\nWhat a page asks, and what it says");

check("headings and things a reader acts on are what is ASKED", () => {
  const found = asked(
    "<h2>Pricing plans</h2><a href='/x'>Start free</a><p>Some prose nobody clicks</p>",
    { dropHidden: false },
  );
  assert(found.has("pricing plans"), "the heading");
  assert(found.has("start free"), "the link");
  assert(!found.has("some prose nobody clicks"), "prose is said, not asked");
});

check("a glyph is not a label and prose is not a label", () => {
  const found = asked(
    `<a href="/a">×</a><a href="/b">${"word ".repeat(40)}</a>`,
    { dropHidden: false },
  );
  equal(found.size, 0, "both are outside the length bounds");
  assert(MAX_LENGTH < 200, "the upper bound keeps prose out");
});

check("everything a page says is the corpus, prose included", () => {
  const said = saidBy("<h2>Plans</h2><p>Three plans, billed monthly.</p>", {
    dropHidden: false,
  });
  assert(said.includes("three plans, billed monthly"), said);
});

console.log("\nWhat comes off first, from both sides");

check("A SECTION HIDDEN AT EVERY WIDTH IS DROPPED BY ANCESTRY", () => {
  // A page builder emits full markup for a section it never paints, and the
  // flags sit on the SECTION, not on the heading six levels down.
  const html =
    '<section class="elementor-hidden-desktop elementor-hidden-laptop elementor-hidden-tablet elementor-hidden-mobile">' +
    "<div><div><h2>A band nobody sees</h2></div></div></section>" +
    "<h2>A band everybody sees</h2>";
  const dropped = asked(html, { dropHidden: true, markup: elementor });
  assert(!dropped.has("a band nobody sees"), "the hidden band is gone");
  assert(dropped.has("a band everybody sees"), "the painted one stays");
});

check("THREE MARKERS ARE NOT FOUR", () => {
  // Measured: a support page's FAQ band carried desktop, tablet and mobile but
  // not laptop, so it painted at exactly one width. Dropping it would hide a
  // real difference.
  const html =
    '<section class="elementor-hidden-desktop elementor-hidden-tablet elementor-hidden-mobile">' +
    "<h2>Painted at one width</h2></section>";
  assert(
    asked(html, { dropHidden: true, markup: elementor }).has(
      "painted at one width",
    ),
    "a partially hidden band is still content",
  );
});

check("a popup ships inside the document and is not the page", () => {
  const html =
    '<div data-elementor-type="popup"><h2>Wait, do not go</h2></div><h2>The page</h2>';
  const found = asked(html, { dropHidden: true, markup: elementor });
  assert(!found.has("wait, do not go"), "the popup is dropped");
  assert(found.has("the page"), "the page is not");
});

check("`aria-hidden` decoration comes off, and real labels do not", () => {
  // A footer's social links read `f Facebook` and `X X` to a naive scan,
  // because the glyph span is decorative. The accessible name is what a reader
  // gets. But a screen-reader-only label IS a real name and must survive.
  const html =
    '<a href="/f"><span aria-hidden="true">f</span>Facebook</a>' +
    '<a href="/x"><span class="screen-reader-text">X (Twitter)</span></a>';
  const found = asked(html, { dropHidden: false });
  assert(found.has("facebook"), "the glyph is gone, the name is not");
  assert(found.has("x (twitter)"), "a visually hidden name survives");
});

check("HIDDEN MARKERS ARE ONLY DROPPED ON THE SOURCE SIDE", () => {
  // This build does not emit a section it does not paint, so a class that
  // happened to collide with a marker name would silently delete real content.
  const html =
    '<section class="elementor-hidden-desktop elementor-hidden-laptop elementor-hidden-tablet elementor-hidden-mobile">' +
    "<h2>Ours</h2></section>";
  assert(
    !asked(html, { dropHidden: true, markup: elementor }).has("ours"),
    "source side drops it",
  );
  assert(asked(html, { dropHidden: false }).has("ours"), "our side keeps it");
});

check("a script full of angle brackets does not desynchronise the walk", () => {
  const html =
    "<script>if (a < b && c > d) { x('</h2>') }</script><h2>Still found</h2>";
  assert(asked(html, { dropHidden: false }).has("still found"), "found");
});

console.log("\nThe four ways it fails");

check("a string the source paints and we do not is UNPAINTED", () => {
  // The defect this exists for. A missing plan tab is exactly one absent
  // label, and it passed fourteen gates on the project this came from.
  const result = reconcile([
    pair(
      "<h2>Starter</h2><h2>Business</h2><h2>Enterprise</h2>",
      "<h2>Starter</h2><h2>Business</h2>",
    ),
  ]);
  const found = problemsOfKind(result.problems, "unpainted");
  equal(found.length, 1, "findings");
  equal(found[0]?.key, "enterprise", "the missing tab");
});

check("a string we paint and the source does not is INVENTED", () => {
  const result = reconcile([
    pair("<h2>Starter</h2>", "<h2>Starter</h2><h2>Free forever</h2>"),
  ]);
  const found = problemsOfKind(result.problems, "invented");
  equal(found.length, 1, "findings");
  equal(found[0]?.key, "free forever", "the invented copy");
});

check("MATCHING IS AGAINST THE WHOLE TEXT, not heading against heading", () => {
  // Two engines mark the same role up differently and always will. Comparing
  // element to element buried the real findings under forty differences nobody
  // can see, three prototypes running.
  const result = reconcile([
    pair("<h2>$33.33 / month</h2>", "<td><span>$33.33</span>/month</td>"),
  ]);
  equal(result.problems.length, 0, "a price in a cell still says the price");
  equal(result.routes[0]?.matched, 1, "and it counts as matched");
});

check("a ruled difference is accounted for, not a finding", () => {
  const rulings = new Map<string, Ruling>([
    [
      "enterprise",
      {
        verdict: "reworded",
        why: "This build labels the third tab `Enterprise plan` so the tab list reads as a set. Measured on the saved source page.",
      },
    ],
  ]);
  const result = reconcile(
    [pair("<h2>Starter</h2><h2>Enterprise</h2>", "<h2>Starter</h2>")],
    { rulings },
  );
  equal(problemsOfKind(result.problems, "unpainted").length, 0, "no finding");
  equal(result.routes[0]?.ruled, 1, "counted as ruled");
});

check("A RULING FOR A STRING THAT MATCHES IS CONTRADICTED", () => {
  // One of the two is wrong and there is no way to tell which from here. A
  // silent pass would leave a ruling standing for a difference that is gone.
  const rulings = new Map<string, Ruling>([
    [
      "starter",
      {
        verdict: "declined",
        why: "Deliberately not built, recorded in decisions/ADR/0003. Measured on the saved source page of 2026-09-07.",
      },
    ],
  ]);
  const result = reconcile([pair("<h2>Starter</h2>", "<h2>Starter</h2>")], {
    rulings,
  });
  equal(problemsOfKind(result.problems, "contradicted").length, 1, "findings");
});

check("a ruling no route needs is STALE", () => {
  const rulings = new Map<string, Ruling>([
    [
      "a string that left the site",
      {
        verdict: "recorded",
        why: "A known difference, deliberately open, recorded on the 2026-09-07 crawl of the pricing page.",
      },
    ],
  ]);
  const result = reconcile([pair("<h2>Starter</h2>", "<h2>Starter</h2>")], {
    rulings,
  });
  equal(problemsOfKind(result.problems, "stale").length, 1, "findings");
});

check("STALE IS NOT REPORTED OVER A SUBSET", () => {
  // Every ruling for the routes left out would otherwise read as stale, which
  // would make a partial run useless and a full run the only safe one.
  const rulings = new Map<string, Ruling>([
    [
      "/other:something",
      {
        verdict: "ours",
        why: "A commitment this project made on its own, recorded against the other route's saved page.",
      },
    ],
  ]);
  const result = reconcile([pair("<h2>Starter</h2>", "<h2>Starter</h2>")], {
    rulings,
    reportStale: false,
  });
  equal(result.problems.length, 0, "nothing reported");
});

check("A RULING CAN BE SCOPED TO ONE ROUTE", () => {
  // One string can mean different things on different pages: a plan
  // description on a pricing page can be the heading of a shared feature list
  // elsewhere. A flat map can only rule a string everywhere, so the first page
  // to start painting it reports the others contradicted.
  const rulings = new Map<string, Ruling>([
    [
      "/pricing:powerful core features",
      {
        verdict: "reworded",
        why: "On /pricing this build renders the plan description inside the plan table rather than as a heading. Measured on the saved source page.",
      },
    ],
  ]);
  const scoped = reconcile(
    [pair("<h2>Powerful core features</h2>", "<h2>Plans</h2>", "/pricing")],
    { rulings, reportStale: false },
  );
  equal(problemsOfKind(scoped.problems, "unpainted").length, 0, "ruled here");

  const elsewhere = reconcile(
    [pair("<h2>Powerful core features</h2>", "<h2>Plans</h2>", "/features")],
    { rulings, reportStale: false },
  );
  equal(
    problemsOfKind(elsewhere.problems, "unpainted").length,
    1,
    "and not ruled on another route",
  );
});

check("every asked string is accounted for, on both sides", () => {
  // Totality. A string that fell out of the accounting would be content nobody
  // had to answer for, which is the failure this whole tool is written against.
  const result = reconcile([
    pair("<h2>One</h2><h2>Two</h2><h2>Three</h2>", "<h2>One</h2><h2>Four</h2>"),
  ]);
  const report = result.routes[0]!;
  const findings = result.problems.filter(
    (problem) => problem.kind !== "stale",
  ).length;
  equal(
    report.matched + report.ruled + findings,
    report.liveAsked + report.oursAsked - report.matched,
    "matched, ruled and reported cover both sides",
  );
});

console.log("\nThe ruling table's own rules");

check("the kit ships no rulings, and that is the starting state", () => {
  equal(RULINGS.size, 0, "rulings");
  equal(rulingViolations().length, 0, "violations");
});

check("A VAGUE REASON IS REJECTED", () => {
  // A row that silences a finding without recording anything a later reader
  // can check is worse than no row.
  const violations = rulingViolations(
    new Map<string, Ruling>([
      ["x", { verdict: "declined", why: "not needed" }],
    ]),
  );
  equal(violations.length, 1, "violations");
  assert(violations[0]!.includes("claim about evidence"), violations[0]!);
});

check('a "reworded" ruling must name what this build says instead', () => {
  const vague = rulingViolations(
    new Map<string, Ruling>([
      [
        "x",
        {
          verdict: "reworded",
          why: "We put this differently on our version of the page, which was checked.",
        },
      ],
    ]),
  );
  equal(vague.length, 1, "a reason that names nothing is rejected");

  const named = rulingViolations(
    new Map<string, Ruling>([
      [
        "x",
        {
          verdict: "reworded",
          why: "This build labels it `Enterprise plan` so the tab list reads as a set. Measured on the saved source page.",
        },
      ],
    ]),
  );
  equal(named.length, 0, "one that names ours is accepted");
});

console.log("\nWordPress is not one editor");

check("ELEMENTOR'S CLASSES DO NOT APPLY TO A GUTENBERG SITE", () => {
  // The defect this whole seam exists for. The first version hard-coded
  // Elementor's four markers, so a Gutenberg site was read by rules that match
  // nothing while the report claimed to have dropped the hidden sections.
  const gutenberg = resolveMarkup({ builders: ["gutenberg"] });
  equal(gutenberg.hiddenEverywhere.length, 0, "core hides nothing by class");
  const elementorMarkup =
    '<section class="elementor-hidden-desktop elementor-hidden-laptop ' +
    'elementor-hidden-tablet elementor-hidden-mobile"><h2>A band</h2></section>';
  assert(
    asked(elementorMarkup, { dropHidden: true, markup: gutenberg }).has(
      "a band",
    ),
    "configured for Gutenberg, Elementor's markers mean nothing",
  );
  assert(
    !asked(elementorMarkup, { dropHidden: true, markup: elementor }).has(
      "a band",
    ),
    "configured for Elementor, they mean everything",
  );
});

check(
  "core's own hidden-section utility is EMPTY, and that is measured",
  () => {
    // Not an unfinished profile. @wordpress/block-library@10.5.0's stylesheet
    // has no responsive-hide utility of any spelling; its only `.hide` rule is
    // an internal of the image block's lightbox.
    equal(GUTENBERG.hiddenEverywhere.length, 0, "nothing to drop");
    assert(
      GUTENBERG.measuredFrom.includes("block-library"),
      "and it says what was read",
    );
  },
);

check("a screen-reader-only label SURVIVES every profile", () => {
  // `screen-reader-text` is WordPress core's, and it is a real accessible name
  // a reader genuinely gets. Silencing it would hide a real difference.
  const html =
    '<a href="/x"><span class="screen-reader-text">Read more about pricing</span></a>';
  for (const profile of PROFILES) {
    const markup = resolveMarkup({ builders: [profile.name] });
    assert(
      asked(html, { dropHidden: true, markup }).has("read more about pricing"),
      `${profile.name} keeps it`,
    );
  }
});

check("A DIALOG IS NOT THE PAGE, WHATEVER BUILT IT", () => {
  // A role, not a builder's class: Gutenberg's navigation overlay, Elementor's
  // popup, a theme's search drawer all mark themselves this way. So a site
  // whose builder has no profile still gets the one rule that holds
  // everywhere.
  const html =
    '<div role="dialog"><h2>Subscribe now</h2></div><h2>The page</h2>';
  const bare = resolveMarkup({ builders: [] });
  const found = asked(html, { dropHidden: true, markup: bare });
  assert(!found.has("subscribe now"), "the dialog is dropped with no profile");
  assert(found.has("the page"), "the page is not");
});

check("an unmeasured builder is an ERROR, never a silent no-op", () => {
  // A typo that selected nothing would produce a report claiming to have
  // dropped the hidden sections when it dropped none — the exact failure this
  // module exists to prevent, reintroduced one level up.
  let threw = "";
  try {
    resolveMarkup({ builders: ["divi"] });
  } catch (cause) {
    threw = (cause as Error).message;
  }
  assert(threw.includes("divi"), "it names what was asked for");
  assert(threw.includes("gutenberg"), "and what is available");
  assert(
    threw.includes("hiddenEverywhere"),
    "and tells the reader what to do instead",
  );
});

check("a site adds its OWN sets on top of a profile", () => {
  // A Gutenberg site that hides sections does it with theme or plugin classes,
  // because core has none. That has to be expressible without a profile.
  const markup = resolveMarkup({
    builders: ["gutenberg"],
    hiddenEverywhere: [["hide-sm", "hide-md", "hide-lg"]],
  });
  const html =
    '<section class="hide-sm hide-md hide-lg"><h2>Theme-hidden</h2></section>' +
    '<section class="hide-sm hide-md"><h2>Two of three</h2></section>';
  const found = asked(html, { dropHidden: true, markup });
  assert(!found.has("theme-hidden"), "the full set is dropped");
  assert(found.has("two of three"), "a partial set still paints somewhere");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nContent reconcile suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Content reconcile suite OK\n");
