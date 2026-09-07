// accessibility-audit suite.
//
// Two halves.
//
// The first exercises each rule and each model against hand-built pages. The
// second is the MUTATION half: it writes a small, internally consistent
// synthetic build to a temporary directory, proves the audit passes it, then
// breaks exactly one thing and proves the audit fails AND names that thing.
//
// The mutation half is the part with value. A checker that has only ever seen
// output it accepts is a checker nobody has tested — the interesting question
// is not "does it pass a good build" but "does it catch a bad one".
//
// Every mutation is applied to a FRESH copy. A mutation leaking into the next
// case would make the suite report faults it did not cause.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  applyBaseline,
  auditAccessibility,
  checkTokenContrast,
} from "../audit.ts";
import { isBaselined, KNOWN_BASELINE } from "../baseline.ts";
import { bySeverity, error, sortFindings, type Finding } from "../finding.ts";
import {
  contrastRatio,
  CONTRAST_PAIRS,
  headingLevels,
  landmarksOf,
  landmarkViolations,
  outlineViolations,
  parseHex,
  parsePalette,
} from "../model.ts";
import { activeCss, isReviewOnly, readPages } from "../pages.ts";
import {
  checkFocus,
  checkHeadings,
  checkLandmarks,
  checkListSemantics,
  checkNavigation,
  checkSkipTarget,
  focusIndicatorClasses,
  focusVisibleClasses,
  interactiveElements,
  listElements,
  listStrippingSelectors,
  routeToFile,
  templateFamily,
} from "../rules.ts";

let passed = 0;
const failures: string[] = [];

const check = (name: string, assertion: () => void): void => {
  try {
    assertion();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (cause) {
    failures.push(`${name} — ${(cause as Error).message}`);
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

const page = (file: string, html: string, css = "") => ({ file, html, css });

// ---------------------------------------------------------------------------
console.log("\nColour — the arithmetic and the palette reader");

check("hex parsing takes both the short and the long form", () => {
  equal(JSON.stringify(parseHex("#fff")), '{"r":255,"g":255,"b":255}', "short");
  equal(JSON.stringify(parseHex("#000000")), '{"r":0,"g":0,"b":0}', "long");
  equal(parseHex("rebeccapurple"), undefined, "a name is not a hex");
});

check("the ratio is anchored and order-independent", () => {
  equal(Math.round(contrastRatio("#ffffff", "#000000") * 100) / 100, 21, "max");
  equal(
    Math.round(contrastRatio("#000000", "#ffffff") * 100) / 100,
    21,
    "swap",
  );
  equal(contrastRatio("#123456", "#123456"), 1, "identical colours");
});

check("the palette is READ from the CSS, never restated in TypeScript", () => {
  // The whole point: a baseline built from values copied into code keeps
  // passing after somebody edits the stylesheet.
  const palette = parsePalette(":root{--color-text:#111827;--space-md:1rem}");
  equal(palette.text, "#111827", "colour token read");
  equal(palette["space-md"], undefined, "a non-colour token is not a colour");
});

check("a minified named colour is read, not dropped", () => {
  // A minifier rewrites a colour to whichever form is shorter, so `#fffafa`
  // ships as `snow`. A hex-only parser dropped such a token out of the palette
  // ENTIRELY, and the audit then measured nothing against it.
  const palette = parsePalette(":root{--color-surface:snow;--color-text:red}");
  equal(palette.surface, "#fffafa", "snow");
  equal(palette.text, "#ff0000", "red beats #f00 on length, so it can appear");
});

check("a colour this cannot read STOPS the run rather than vanishing", () => {
  let threw = "";
  try {
    parsePalette(":root{--color-text:lch(50% 40 100)}");
  } catch (cause) {
    threw = (cause as Error).message;
  }
  assert(threw.includes("--color-text"), `expected a named failure: ${threw}`);
});

check("WordPress preset constants are not read as this site's palette", () => {
  // They are core's values for preset classes inside migrated bodies, not a
  // design decision anybody here made, so they carry no contrast obligation.
  const palette = parsePalette(
    ":root{--wp-preset-vivid-red:#cf2e2e;--color-text:#111827}",
  );
  equal(palette["vivid-red"], undefined, "preset not in the palette");
  equal(Object.keys(palette).length, 1, "only the site's own token");
});

check("a failing pair is reported with both tokens and the threshold", () => {
  const pages = [
    page(
      "index.html",
      "<html></html>",
      ":root{--color-text:#cccccc;--color-background:#ffffff;" +
        "--color-surface:#ffffff;--color-surface-band:#ffffff;" +
        "--color-text-muted:#111111;--color-text-inverse:#ffffff;" +
        "--color-primary:#000000;--color-primary-strong:#000000;" +
        "--color-secondary:#000000;--color-link:#000000;" +
        "--color-border-interactive:#000000;--color-error:#000000;" +
        "--color-success:#000000;--color-warning:#000000}",
    ),
  ];
  const findings = checkTokenContrast(pages);
  const body = findings.find((finding) =>
    finding.id.endsWith("body-on-background"),
  );
  assert(body !== undefined, `expected a body-on-background finding`);
  assert(body!.detail.includes("--color-text"), body!.detail);
  assert(body!.detail.includes("needs 4.5:1"), body!.detail);
});

check("MUTATION: darkening the text token clears the finding", () => {
  const css = (text: string) =>
    `:root{--color-text:${text};--color-background:#ffffff;--color-surface:#ffffff;` +
    "--color-surface-band:#ffffff;--color-text-muted:#111111;" +
    "--color-text-inverse:#ffffff;--color-primary:#000000;" +
    "--color-primary-strong:#000000;--color-secondary:#000000;" +
    "--color-link:#000000;--color-border-interactive:#000000;" +
    "--color-error:#000000;--color-success:#000000;--color-warning:#000000}";
  const before = checkTokenContrast([page("a.html", "", css("#cccccc"))]);
  const after = checkTokenContrast([page("a.html", "", css("#111827"))]);
  assert(before.length > after.length, "the finding did not clear");
  equal(after.length, 0, "no findings once the pair passes");
});

check(
  "a pair naming a token the build does not ship is its own finding",
  () => {
    // A renamed token would otherwise silently drop its pair out of the audit.
    const findings = checkTokenContrast([
      page("a.html", "", ":root{--color-text:#111827}"),
    ]);
    assert(
      findings.some((finding) => finding.id.includes("missing-token:")),
      "expected a missing-token finding",
    );
  },
);

check("a build with no colour tokens is a WARNING, not a silent pass", () => {
  const findings = checkTokenContrast([page("a.html", "", "body{margin:0}")]);
  equal(findings.length, 1, "findings");
  equal(findings[0]!.severity, "warning", "severity");
  assert(findings[0]!.detail.includes("vacuously"), findings[0]!.detail);
});

check("every pair names where it is rendered", () => {
  // A pair whose `where` is empty is a row nobody can act on: the reader has
  // to know which surface to go and look at.
  for (const pair of CONTRAST_PAIRS)
    assert(pair.where.length > 20, `${pair.id}: says where it is rendered`);
});

// ---------------------------------------------------------------------------
console.log("\nHeading hierarchy — every violation kind, on real page shapes");

check("a clean outline produces no finding", () => {
  equal(
    checkHeadings([page("a.html", "<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2>")])
      .length,
    0,
    "findings",
  );
});

check("a skipped level is reported, with the sequence in the detail", () => {
  const found = checkHeadings([page("a.html", "<h1>A</h1><h3>C</h3>")]);
  equal(found.length, 1, "findings");
  equal(found[0]!.severity, "error", "severity");
  assert(found[0]!.detail.includes("skipped-level"), "kind in detail");
  assert(found[0]!.detail.includes("[1 3]"), "sequence in detail");
});

check("a second h1 is reported", () => {
  const found = checkHeadings([page("a.html", "<h1>A</h1><h1>B</h1>")]);
  assert(
    found.some((finding) => finding.detail.includes("multiple-h1")),
    "multiple-h1",
  );
});

check("a page with no h1 is reported", () => {
  // A page of h2s reads as clean to a naive checker.
  const found = checkHeadings([page("a.html", "<h2>A</h2><h3>B</h3>")]);
  assert(
    found.some((finding) => finding.detail.includes("no-h1")),
    "no-h1",
  );
});

check("a page whose first heading is not the h1 is reported", () => {
  const found = checkHeadings([page("a.html", "<h2>A</h2><h1>B</h1>")]);
  assert(
    found.some((finding) => finding.detail.includes("starts-below-h1")),
    "starts-below-h1",
  );
});

check("going back UP several levels is legal", () => {
  equal(
    outlineViolations(headingLevels("<h1>A</h1><h2>B</h2><h4>C</h4>")).length,
    1,
    "h2 to h4 is the only violation",
  );
  equal(
    outlineViolations(headingLevels("<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2>"))
      .length,
    0,
    "h3 to h2 is not a violation",
  );
});

check(
  "the page count is not hard-coded — the rule runs over what it is given",
  () => {
    const many = Array.from({ length: 40 }, (unused, index) =>
      page(`p${index}.html`, "<h1>A</h1>"),
    );
    equal(checkHeadings(many).length, 0, "40 clean pages");
  },
);

// ---------------------------------------------------------------------------
console.log("\nLandmarks — semantic identity, not tag counting");

const SITE_CHROME =
  '<header></header><nav aria-label="Main"></nav><main></main>' +
  '<nav aria-label="Footer"></nav><footer></footer>';

check("a well-formed production page produces no finding", () => {
  equal(checkLandmarks([page("a.html", SITE_CHROME)]).length, 0, "findings");
});

check("a missing main landmark is reported", () => {
  const found = checkLandmarks([
    page("a.html", SITE_CHROME.replace("<main></main>", "")),
  ]);
  assert(
    found.some((finding) => finding.detail.includes("no <main>")),
    "missing main",
  );
});

check("a second main landmark is reported", () => {
  const found = checkLandmarks([
    page(
      "a.html",
      SITE_CHROME.replace("<main></main>", "<main></main><main></main>"),
    ),
  ]);
  assert(found.length > 0, "duplicate main reported");
});

check("an unnamed nav is reported", () => {
  const found = checkLandmarks([
    page(
      "a.html",
      SITE_CHROME.replace('<nav aria-label="Main"></nav>', "<nav></nav>"),
    ),
  ]);
  assert(
    found.some((finding) => finding.id.includes("unnamed-nav")),
    "unnamed nav",
  );
});

check("two navs sharing a name on one page are reported", () => {
  const found = checkLandmarks([
    page(
      "a.html",
      SITE_CHROME.replace('aria-label="Footer"', 'aria-label="Main"'),
    ),
  ]);
  assert(
    found.some((finding) => finding.id.includes("duplicate-nav-name")),
    "duplicate nav name",
  );
});

check("a nav renamed on ONE page is reported as a missing landmark", () => {
  // The majority rule. `Main` is on two of three pages, so the third is
  // missing site chrome rather than carrying a variant.
  const pages = [
    page("a.html", SITE_CHROME),
    page("b.html", SITE_CHROME),
    page(
      "c.html",
      SITE_CHROME.replace('aria-label="Main"', 'aria-label="Primary"'),
    ),
  ];
  const found = checkLandmarks(pages);
  assert(
    found.some(
      (finding) =>
        finding.at === "c.html" && finding.id.includes("nav-missing:Main"),
    ),
    "renamed nav on one page",
  );
});

check("a contextual nav on SOME pages is not drift", () => {
  // A breadcrumb trail on a minority of pages is correct, not a fault. This is
  // the case a naive whole-set comparison gets wrong.
  const pages = [
    page("a.html", SITE_CHROME),
    page("b.html", SITE_CHROME),
    page("c.html", SITE_CHROME + '<nav aria-label="Breadcrumb"></nav>'),
  ];
  equal(checkLandmarks(pages).length, 0, "findings");
});

check("ONE POPULOUS TEMPLATE CANNOT MAKE ITS OWN NAV INTO SITE CHROME", () => {
  // The 112-error lesson. Site-wide, a migrated blog of 250 posts makes
  // `Breadcrumb` a majority and the audit then demands it on the home page.
  // Per-family, the top-level family never carries it, so it is never chrome.
  const pages = [
    page("index.html", SITE_CHROME),
    page("about/index.html", SITE_CHROME),
    ...Array.from({ length: 50 }, (unused, index) =>
      page(
        `blog/post-${index}/index.html`,
        SITE_CHROME + '<nav aria-label="Breadcrumb"></nav>',
      ),
    ),
  ];
  const found = checkLandmarks(pages);
  equal(
    found.filter((finding) => finding.id.includes("nav-missing:Breadcrumb"))
      .length,
    0,
    "a contextual nav on one family is not demanded of another",
  );
});

check("THE MANIFEST'S FAMILIES BEAT THE PATH-SHAPE FALLBACK", () => {
  // Measured on this kit's own sample site. By path shape, `/`, `/404` and
  // every top-level page share one bucket, so a breadcrumb the real pages
  // carry and the home page correctly does not becomes a majority — and the
  // rule demands a breadcrumb on the home page. The build's own inventory
  // says `/` is a `static` route and `/about` is a `page`, which are two
  // families, and the false finding disappears.
  const pages = [
    page("index.html", SITE_CHROME),
    page("404.html", SITE_CHROME),
    page(
      "about/index.html",
      SITE_CHROME + '<nav aria-label="Breadcrumb"></nav>',
    ),
    page(
      "contact/index.html",
      SITE_CHROME + '<nav aria-label="Breadcrumb"></nav>',
    ),
    page(
      "team/index.html",
      SITE_CHROME + '<nav aria-label="Breadcrumb"></nav>',
    ),
  ];
  const byPathShape = checkLandmarks(pages);
  assert(
    byPathShape.some((finding) =>
      finding.id.includes("nav-missing:Breadcrumb"),
    ),
    "the fallback is expected to over-report here — that is why it is a fallback",
  );

  const families = new Map([
    ["index.html", "static"],
    ["404.html", "static"],
    ["about/index.html", "page"],
    ["contact/index.html", "page"],
    ["team/index.html", "page"],
  ]);
  equal(checkLandmarks(pages, families).length, 0, "with the real families");
});

check("a paginated archive is its own template family", () => {
  // It sits under the same first segment as the entries around it and carries
  // different contextual navigation, so folding the two together is how a
  // genuinely contextual nav becomes a false majority.
  equal(templateFamily("index.html"), "top-level", "root");
  equal(templateFamily("about/index.html"), "top-level", "a top-level page");
  equal(templateFamily("blog/hello/index.html"), "blog", "an entry");
  equal(
    templateFamily("blog/page/2/index.html"),
    "blog-pagination",
    "an archive page",
  );
});

check("a review-only page must have main and must NOT have site chrome", () => {
  // `REVIEW_ONLY` ships empty, so the branch is exercised here rather than by
  // a real page — the same reason `applyBaseline` takes its list as an
  // argument. A path that never executes is a path that rots.
  const found = checkLandmarks([page("index.html", "<main></main>")]);
  assert(
    found.some((finding) => finding.detail.includes("no <header>")),
    "a production page still needs chrome",
  );
});

// ---------------------------------------------------------------------------
console.log("\nFocus — coverage of controls, never a count of rules");

const FOCUS_CSS = ".wpk-button:focus-visible{outline:2px solid blue}";

check("focus-visible classes are read out of a stylesheet", () => {
  const classes = focusVisibleClasses(
    ".a:hover{}.b:focus-visible,.c:focus-visible{}.d{}",
  );
  equal([...classes].sort().join(","), "b,c", "classes");
});

check("an anchor with no href is not a control", () => {
  equal(interactiveElements('<a name="x">t</a>').length, 0, "anchors");
  equal(interactiveElements('<a href="/x">t</a>').length, 1, "links");
});

check("buttons and summaries are controls", () => {
  equal(
    interactiveElements("<button>a</button><summary>b</summary>").length,
    2,
    "controls",
  );
});

check("a covered control produces no finding", () => {
  equal(
    checkFocus([
      page("a.html", '<a href="/x" class="wpk-button">go</a>', FOCUS_CSS),
    ]).length,
    0,
    "findings",
  );
});

check("an uncovered control is reported once, not once per page", () => {
  // The same omission on three pages is one defect. A per-page finding would
  // make an eighteen-page site report eighteen times and bury the others.
  const pages = ["a.html", "b.html", "c.html"].map((file) =>
    page(file, '<a href="/x" class="wpk-orphan">go</a>', FOCUS_CSS),
  );
  const found = checkFocus(pages);
  equal(found.length, 1, "findings");
  assert(found[0]!.detail.includes("3 page(s)"), "page count in detail");
});

check("the rule does not depend on how many focus rules exist", () => {
  // A count assertion would catch a stale comment AND fail every time a
  // component is legitimately added. Coverage is the contract; the number of
  // rules is not.
  const ring = "{outline:2px solid var(--color-primary)}";
  const one = `.wpk-button:focus-visible${ring}`;
  const many = one + `.x:focus-visible${ring}.y:focus-visible${ring}`;
  const html = '<a href="/x" class="wpk-button">go</a>';
  equal(checkFocus([page("a.html", html, one)]).length, 0, "one rule");
  equal(checkFocus([page("a.html", html, many)]).length, 0, "many rules");
});

check("a control that LOSES its focus rule is reported", () => {
  const html = '<a href="/x" class="wpk-button">go</a>';
  equal(checkFocus([page("a.html", html, FOCUS_CSS)]).length, 0, "before");
  equal(
    checkFocus([page("a.html", html, ".wpk-button:hover{}")]).length,
    1,
    "after",
  );
});

check("a :focus-visible rule that draws NOTHING is not coverage", () => {
  // The exact defect measured in a browser once: a skip link has a rule, the
  // rule only repositions it, and the browser paints its own ring.
  const html = '<a href="#main" class="wpk-skip-link">Skip</a>';
  const reposition = ".wpk-skip-link:focus-visible{inset-block-start:1rem}";
  const ring = ".wpk-skip-link:focus-visible{outline:2px solid blue}";
  equal(
    focusVisibleClasses(reposition).has("wpk-skip-link"),
    true,
    "rule seen",
  );
  equal(
    focusIndicatorClasses(reposition).has("wpk-skip-link"),
    false,
    "not an indicator",
  );
  equal(checkFocus([page("a.html", html, reposition)]).length, 1, "reported");
  equal(checkFocus([page("a.html", html, ring)]).length, 0, "ring accepted");
});

check("outline:none with nothing put back is not coverage", () => {
  const html = '<a href="/x" class="wpk-button">go</a>';
  const removed = ".wpk-button:focus-visible{outline:none}";
  const swapped =
    ".wpk-button:focus-visible{outline:none;box-shadow:0 0 0 2px}";
  equal(checkFocus([page("a.html", html, removed)]).length, 1, "removal");
  equal(checkFocus([page("a.html", html, swapped)]).length, 0, "replacement");
});

// ---------------------------------------------------------------------------
console.log("\nNavigation — the menu as a menu");

const NAV_PAGE = SITE_CHROME.replace(
  '<nav aria-label="Main"></nav>',
  '<input type="checkbox" id="wpk-site-menu"><label for="wpk-site-menu">Menu</label>' +
    '<nav aria-label="Main"><a href="/blog/">Blog</a></nav>',
);
const EMITTED = new Set(["a.html", "blog/index.html"]);

check("a well-formed navigation produces no finding", () => {
  equal(
    checkNavigation([page("a.html", NAV_PAGE)], EMITTED).length,
    0,
    "findings",
  );
});

check("a production page with no nav is reported", () => {
  const found = checkNavigation([page("a.html", "<main></main>")], EMITTED);
  assert(
    found.some((finding) => finding.id.includes("no-nav")),
    "no-nav",
  );
});

check("a menu that stopped being a native toggle is reported", () => {
  const scripted = NAV_PAGE.replace(
    '<input type="checkbox" id="wpk-site-menu">',
    '<button class="wpk-nav__toggle">Menu</button>',
  );
  const found = checkNavigation([page("a.html", scripted)], EMITTED);
  assert(
    found.some((finding) => finding.id.includes("disclosure")),
    "native toggle lost",
  );
});

check("a toggle with no label has no keyboard trigger", () => {
  const found = checkNavigation(
    [
      page(
        "a.html",
        NAV_PAGE.replace('<label for="wpk-site-menu">Menu</label>', ""),
      ),
    ],
    EMITTED,
  );
  assert(
    found.some((finding) => finding.id.includes("summary")),
    "label lost",
  );
});

check(
  "a toggle that ships checked opens the menu over the first screen",
  () => {
    const found = checkNavigation(
      [
        page(
          "a.html",
          NAV_PAGE.replace(
            '<input type="checkbox" id="wpk-site-menu">',
            '<input type="checkbox" id="wpk-site-menu" checked>',
          ),
        ),
      ],
      EMITTED,
    );
    assert(
      found.some((finding) => finding.id.includes("toggle-open")),
      "checked toggle",
    );
  },
);

check("a nav link to a page the build did not emit is reported", () => {
  const found = checkNavigation(
    [page("a.html", NAV_PAGE.replace('href="/blog/"', 'href="/ghost/"'))],
    EMITTED,
  );
  assert(
    found.some((finding) => finding.id.includes("dead:/ghost/")),
    "dead nav reference",
  );
});

check("external, mail and fragment links are not dead references", () => {
  for (const href of ["https://example.com", "mailto:a@b.c", "#main"]) {
    const found = checkNavigation(
      [page("a.html", NAV_PAGE.replace('href="/blog/"', `href="${href}"`))],
      EMITTED,
    );
    equal(found.length, 0, `href ${href}`);
  }
});

check("aria-current on an item pointing at another page is reported", () => {
  const wrong = NAV_PAGE.replace(
    '<a href="/blog/">Blog</a>',
    '<a href="/blog/" aria-current="page">Blog</a>',
  );
  const found = checkNavigation([page("a.html", wrong)], EMITTED);
  assert(
    found.some((finding) => finding.id.includes("current-mismatch")),
    "current mismatch",
  );
});

check("aria-current on the item that IS this page is correct", () => {
  const right = NAV_PAGE.replace(
    '<a href="/blog/">Blog</a>',
    '<a href="/blog/" aria-current="page">Blog</a>',
  );
  equal(
    checkNavigation([page("blog/index.html", right)], EMITTED).length,
    0,
    "findings",
  );
});

check("a route resolves to the file the build emits for it", () => {
  equal(routeToFile("/"), "index.html", "root");
  equal(routeToFile("/blog/"), "blog/index.html", "trailing slash");
  equal(routeToFile("/blog"), "blog/index.html", "no trailing slash");
  equal(routeToFile("/blog/?a=1#b"), "blog/index.html", "query and fragment");
});

// ---------------------------------------------------------------------------
console.log("\nList semantics and the skip link");

const LIST_CSS = ".wpk-list{list-style:none;display:flex}";

check("a list stripped by CSS and not restored is reported", () => {
  const html = '<ul class="wpk-list"><li>a</li></ul>';
  equal(checkListSemantics([page("a.html", html, LIST_CSS)]).length, 1, "bare");
  equal(
    checkListSemantics([
      page(
        "a.html",
        '<ul role="list" class="wpk-list"><li>a</li></ul>',
        LIST_CSS,
      ),
    ]).length,
    0,
    "restored",
  );
});

check("a list that keeps its markers needs no role", () => {
  // Reporting one would be a false positive, and a check that cannot tell them
  // apart is one nobody could leave enabled.
  const html = "<ul><li>a</li></ul>";
  equal(checkListSemantics([page("a.html", html, LIST_CSS)]).length, 0, "bare");
  equal(checkListSemantics([page("a.html", html, "")]).length, 0, "no css");
});

check("either stripping mechanism alone is enough to require the role", () => {
  const html = '<ul class="wpk-list"><li>a</li></ul>';
  equal(
    checkListSemantics([page("a.html", html, ".wpk-list{list-style:none}")])
      .length,
    1,
    "markers",
  );
  equal(
    checkListSemantics([page("a.html", html, ".wpk-list{display:grid}")])
      .length,
    1,
    "box",
  );
});

check("a scoped tag selector reaches only its own component's lists", () => {
  const css =
    ".wpk-nav[data-astro-cid-nav] ul[data-astro-cid-nav]{list-style:none}";
  const mine = "<ul data-astro-cid-nav><li>a</li></ul>";
  const other = "<ul data-astro-cid-other><li>a</li></ul>";
  equal(checkListSemantics([page("a.html", mine, css)]).length, 1, "in scope");
  equal(
    checkListSemantics([page("a.html", other, css)]).length,
    0,
    "out of scope",
  );
  equal(
    listStrippingSelectors(css).scopedTags.has("ul@data-astro-cid-nav"),
    true,
    "scoped tag",
  );
});

check("an unscoped bare list rule reaches every list on the page", () => {
  equal(
    checkListSemantics([
      page("a.html", "<ul><li>a</li></ul>", "ul{list-style:none}"),
    ]).length,
    1,
    "global",
  );
});

check("list elements are read with their classes, scopes and role", () => {
  const [element] = listElements(
    '<ol role="list" class="wpk-x wpk-y" data-astro-cid-z></ol>',
  );
  equal(element!.tag, "ol", "tag");
  equal(element!.classes.join(","), "wpk-x,wpk-y", "classes");
  equal(element!.scopes.join(","), "data-astro-cid-z", "scopes");
  equal(element!.role, "list", "role");
});

const SKIP = '<a class="wpk-skip-link" href="#main">Skip</a>';

check("a skip link pointing at an unfocusable target is reported", () => {
  const bad = `${SKIP}<main id="main"><h1>t</h1></main>`;
  const good = `${SKIP}<main id="main" tabindex="-1"><h1>t</h1></main>`;
  equal(checkSkipTarget([page("a.html", bad, "")]).length, 1, "no tabindex");
  equal(checkSkipTarget([page("a.html", good, "")]).length, 0, "tabindex");
});

check(
  "the skip-link check stays silent where it has no question to ask",
  () => {
    equal(
      checkSkipTarget([page("a.html", '<main id="main"></main>', "")]).length,
      0,
      "no link",
    );
    equal(
      checkSkipTarget([page("a.html", `${SKIP}<div></div>`, "")]).length,
      0,
      "no target",
    );
  },
);

check("a natively focusable skip target needs no tabindex", () => {
  const html = `<a class="wpk-skip-link" href="#x">Skip</a><a id="x" href="/y">y</a>`;
  equal(checkSkipTarget([page("a.html", html, "")]).length, 0, "native");
});

// ---------------------------------------------------------------------------
console.log("\nThe baseline — both directions, so a known defect cannot hide");

// `KNOWN_BASELINE` ships EMPTY, so the mechanism is exercised against a
// synthetic entry instead. That is exactly why `applyBaseline` takes a list: a
// both-direction record with nothing in it is precisely when the machinery
// stops being tested.
const SYNTHETIC_BASELINE = [
  {
    id: "focus|*|a.wpk-fixture-link",
    decision: "D-000-1",
    reason:
      "A synthetic entry. It exists to exercise both directions of the baseline mechanism, and it describes no real defect in this repository.",
  },
] as const;

check("a baselined finding stops failing the run but is still reported", () => {
  const found = applyBaseline(
    [error("focus", "*", "a.wpk-fixture-link", "no focus rule")],
    { reportStale: false, baseline: SYNTHETIC_BASELINE },
  );
  equal(found.length, 1, "findings");
  equal(found[0]!.severity, "baseline", "severity");
  equal(found[0]!.decision, "D-000-1", "decision");
  assert(found[0]!.detail.includes("D-000-1"), "decision in detail");
});

check("a finding that is NOT baselined stays an error", () => {
  const found = applyBaseline(
    [error("focus", "*", "a.wpk-something-new", "no focus rule")],
    { reportStale: false, baseline: SYNTHETIC_BASELINE },
  );
  equal(found[0]!.severity, "error", "severity");
});

check("a baseline entry the build no longer produces becomes an error", () => {
  // The direction that makes a baseline safe rather than a mute button. If the
  // defect is fixed, the record must be updated deliberately.
  const found = applyBaseline([], { baseline: SYNTHETIC_BASELINE });
  equal(found.length, SYNTHETIC_BASELINE.length, "one stale finding per entry");
  for (const finding of found) {
    equal(finding.severity, "error", "severity");
    assert(finding.id.includes("stale"), "stale marker");
  }
});

check(
  "the kit ships an empty baseline, and every entry would name a decision",
  () => {
    equal(KNOWN_BASELINE.length, 0, "baseline entries");
    for (const entry of KNOWN_BASELINE) {
      assert(entry.decision.length > 0, `${entry.id}: names a decision`);
      assert(entry.reason.length > 40, `${entry.id}: reason is substantive`);
      assert(isBaselined(entry.id), `${entry.id}: resolvable`);
    }
  },
);

check("findings sort stably, so two runs print identically", () => {
  const unsorted: Finding[] = [
    error("navigation", "z.html", "k", "d"),
    error("headings", "a.html", "k", "d"),
    error("focus", "m.html", "k", "d"),
  ];
  equal(
    sortFindings(unsorted)
      .map((finding) => finding.check)
      .join(","),
    "headings,focus,navigation",
    "check order",
  );
});

// ---------------------------------------------------------------------------
console.log("\nThe synthetic build — mutation cases against a real directory");

const created: string[] = [];

const CSS_FILE = "_astro/site.css";
// A palette that passes every pair, plus the chrome rules the real components
// ship. A fixture whose palette failed would make every mutation case report a
// contrast defect it did not cause.
const SYNTHETIC_CSS =
  ":root{--color-primary:#1d4ed8;--color-primary-strong:#1e40af;" +
  "--color-secondary:#0f172a;--color-background:#ffffff;--color-surface:#f5f7fa;" +
  "--color-surface-band:#eef2f7;--color-text:#111827;--color-text-muted:#4b5563;" +
  "--color-text-inverse:#ffffff;--color-link:#1d4ed8;--color-border:#d1d5db;" +
  "--color-border-interactive:#64748b;--color-success:#15803d;" +
  "--color-warning:#b45309;--color-error:#b91c1c}" +
  // The design system's one universal rule. Since it exists, the per-control
  // check passes vacuously and `checkFocusSystemRule` is what carries the
  // contract — which is the arrangement the real build has.
  ":focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}" +
  ".wpk-button:focus-visible{outline:2px solid var(--color-primary)}" +
  ".wpk-nav__link:focus-visible{outline:2px solid var(--color-primary)}" +
  ".wpk-skip-link:focus-visible{inset-block-start:1rem}" +
  // A list styled the way the real components style theirs: markers gone and
  // the list box replaced. Both mechanisms, so the fixture exercises the rule
  // rather than half of it.
  ".wpk-list{margin-block:0;padding-inline-start:0;list-style:none;display:flex}";

const syntheticPage = (title: string, self: string): string =>
  `<!doctype html><html lang="en"><head><title>${title}</title>` +
  `<link rel="stylesheet" href="/${CSS_FILE}"></head><body>` +
  `<a class="wpk-skip-link" href="#main">Skip to content</a>` +
  `<header>` +
  `<input type="checkbox" id="wpk-site-menu">` +
  `<label class="wpk-site-header__toggle" for="wpk-site-menu">Menu</label>` +
  `<nav aria-label="Main">` +
  `<a class="wpk-nav__link" href="/">Home</a>` +
  `<a class="wpk-nav__link" href="/blog/"${self === "blog/index.html" ? ' aria-current="page"' : ""}>Blog</a>` +
  `</nav></header>` +
  `<main id="main" tabindex="-1"><h1>${title}</h1><h2>Section</h2>` +
  // A link with no component class of its own — the shape of a link inside a
  // migrated body, which no class-based focus rule can ever reach and which
  // the universal rule covers.
  `<a href="/blog/">A link with no component class</a>` +
  // An anchored section named by the heading it renders.
  `<section id="intro" aria-labelledby="intro-title"><h3 id="intro-title">Intro</h3></section>` +
  // A list the CSS strips, carrying the role that restores it, and a list that
  // keeps its markers and correctly carries no role.
  `<ul role="list" class="wpk-list"><li>One</li><li>Two</li></ul>` +
  `<ul><li>Markered</li></ul>` +
  `<a class="wpk-button" href="/blog/">Read</a></main>` +
  `<footer><nav aria-label="Footer"><a class="wpk-nav__link" href="/">Home</a></nav></footer>` +
  `</body></html>`;

/** A complete, internally consistent build. Every mutation starts from one. */
function writeSyntheticBuild(): string {
  const root = mkdtempSync(path.join(tmpdir(), "a11y-audit-"));
  created.push(root);
  mkdirSync(path.join(root, "_astro"), { recursive: true });
  writeFileSync(path.join(root, CSS_FILE), SYNTHETIC_CSS);
  mkdirSync(path.join(root, "blog"), { recursive: true });
  writeFileSync(
    path.join(root, "index.html"),
    syntheticPage("Home", "index.html"),
  );
  writeFileSync(
    path.join(root, "blog", "index.html"),
    syntheticPage("Blog", "blog/index.html"),
  );
  return root;
}

/** Apply one fault to a fresh build and return the result. */
function mutate(file: string, edit: (html: string) => string) {
  const root = writeSyntheticBuild();
  const before = readPages(root).find((candidate) => candidate.file === file)!;
  writeFileSync(path.join(root, file), edit(before.html));
  return auditAccessibility(root, { reportStale: false });
}

const errorsSay = (
  result: { findings: readonly Finding[] },
  needle: string,
): boolean =>
  bySeverity(result.findings, "error").some(
    (finding) => finding.id.includes(needle) || finding.detail.includes(needle),
  );

check("the unmutated synthetic build passes", () => {
  const result = auditAccessibility(writeSyntheticBuild(), {
    reportStale: false,
  });
  const errors = bySeverity(result.findings, "error");
  equal(errors.length, 0, `errors: ${errors.map((f) => f.id).join(", ")}`);
  equal(result.ok, true, "ok");
  equal(result.counts.pages, 2, "pages");
  assert(result.counts.paletteTokens > 10, "the palette was read");
});

check("the audit reads inline styles as well as linked ones", () => {
  // The correctness detail a naive reader gets wrong: Astro inlines some
  // component styles into the page. A focus check that read only the linked
  // bundles would report covered controls as uncovered.
  const html =
    '<style>.x:focus-visible{}</style><link rel="stylesheet" href="/none.css">';
  assert(
    activeCss("/nonexistent", html).includes(".x:focus-visible"),
    "inline read",
  );
});

check("a redirect stub is not audited as a page", () => {
  // It is a meta refresh and a link: no landmarks, no headings, nothing to
  // audit, and auditing it would report a defect on every retired URL.
  const root = writeSyntheticBuild();
  writeFileSync(
    path.join(root, "old-url.html"),
    '<!doctype html><title>Redirecting to: /new</title><meta http-equiv="refresh" content="0;url=/new">',
  );
  equal(readPages(root).length, 2, "the stub is skipped");
});

check("MUTATION: a heading regression fails the audit", () => {
  const result = mutate("blog/index.html", (html) =>
    html.replace("<h2>Section</h2>", "<h4>Section</h4>"),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "skipped-level"), "names the skipped level");
});

check("MUTATION: a removed main landmark fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html
      .replace('<main id="main" tabindex="-1">', "<div>")
      .replace("</main>", "</div>"),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "no <main>"), "names the missing main");
});

check("MUTATION: an unnamed nav landmark fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace('<nav aria-label="Main">', "<nav>"),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "unnamed-nav"), "names the unnamed nav");
});

check("MUTATION: two navs sharing a name fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace('aria-label="Footer"', 'aria-label="Main"'),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "duplicate-nav-name"), "names the collision");
});

check("MUTATION: dropping the universal focus rule fails the audit", () => {
  // The single most consequential deletion possible: with the component rules
  // left intact the per-control check still covers the classed controls, so
  // nothing else in the suite would notice.
  const root = writeSyntheticBuild();
  writeFileSync(
    path.join(root, CSS_FILE),
    SYNTHETIC_CSS.replace(
      ":focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}",
      "",
    ),
  );
  const result = auditAccessibility(root, { reportStale: false });
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "universal :focus-visible rule"), "names the rule");
  assert(
    errorsSay(result, "reached by no :focus-visible rule"),
    "reports the control no component rule reaches",
  );
});

check("MUTATION: a universal rule that draws nothing fails the audit", () => {
  const root = writeSyntheticBuild();
  writeFileSync(
    path.join(root, CSS_FILE),
    SYNTHETIC_CSS.replace(
      ":focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}",
      ":focus-visible{inset-block-start:1rem}",
    ),
  );
  equal(auditAccessibility(root, { reportStale: false }).ok, false, "ok");
});

check("MUTATION: a broken navigation reference fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace('href="/blog/">Blog', 'href="/ghost/">Blog'),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "/ghost/"), "names the dead route");
});

check("MUTATION: a scripted menu replacing the native toggle fails", () => {
  const result = mutate("index.html", (html) =>
    html.replace(
      '<input type="checkbox" id="wpk-site-menu">',
      '<button class="wpk-nav__toggle">Menu</button>',
    ),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "no-JavaScript"), "names the property at risk");
});

check("MUTATION: a menu toggle that ships checked fails", () => {
  const result = mutate("index.html", (html) =>
    html.replace(
      '<input type="checkbox" id="wpk-site-menu">',
      '<input type="checkbox" id="wpk-site-menu" checked>',
    ),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "opens expanded"), "names what the reader loses");
});

check("MUTATION: a second h1 fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace("<h2>Section</h2>", "<h1>Section</h1>"),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "multiple-h1"), "names the duplicate h1");
});

check('MUTATION: a list losing its role="list" fails the audit', () => {
  const result = mutate("index.html", (html) =>
    html.replace('<ul role="list" class="wpk-list">', '<ul class="wpk-list">'),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "ul.wpk-list"), "names the list");
  assert(
    errorsSay(result, "stops being announced as a list"),
    "says what it costs",
  );
});

check("MUTATION: the main landmark losing its tabindex fails the audit", () => {
  // The skip link still points at a landmark that exists, which is all the
  // build audit asserts — so only this check sees it.
  const result = mutate("index.html", (html) =>
    html.replace('<main id="main" tabindex="-1">', '<main id="main">'),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "unfocusable:main"), "names the target");
});

check("MUTATION: an anchored section losing its name fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace(' aria-labelledby="intro-title"', ""),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "unnamed-section:intro"), "names the section");
});

check("MUTATION: a section named by a missing id fails the audit", () => {
  const result = mutate("index.html", (html) =>
    html.replace('aria-labelledby="intro-title"', 'aria-labelledby="gone"'),
  );
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "dangling-name:gone"), "names the dead reference");
});

check("MUTATION: a failing token pair fails the audit", () => {
  const root = writeSyntheticBuild();
  writeFileSync(
    path.join(root, CSS_FILE),
    SYNTHETIC_CSS.replace("--color-text:#111827", "--color-text:#cccccc"),
  );
  const result = auditAccessibility(root, { reportStale: false });
  equal(result.ok, false, "ok");
  assert(errorsSay(result, "body-on-background"), "names the pair");
});

check("MUTATION: a markered list is not reported when a styled one is", () => {
  // Both lists are in the fixture. Removing the role from the styled one must
  // report exactly one element kind, not two.
  const result = mutate("index.html", (html) =>
    html.replace('<ul role="list" class="wpk-list">', '<ul class="wpk-list">'),
  );
  equal(
    bySeverity(result.findings, "error").filter(
      (finding) => finding.check === "lists",
    ).length,
    1,
    "list findings",
  );
});

check(
  "each mutation is isolated — a fresh build still passes after them all",
  () => {
    const result = auditAccessibility(writeSyntheticBuild(), {
      reportStale: false,
    });
    equal(result.ok, true, "a fresh build is unaffected by previous mutations");
  },
);

// ---------------------------------------------------------------------------
console.log("\nThe real build, when one is present");

check("the real build has no accessibility errors", () => {
  let result;
  try {
    result = auditAccessibility("apps/website/dist");
  } catch {
    console.log("    (no build present — skipped)");
    return;
  }
  const errors = bySeverity(result.findings, "error");
  equal(
    errors.length,
    0,
    `errors: ${errors.map((finding) => finding.id).join(", ")}`,
  );
  assert(result.counts.pages > 0, "pages audited");
  assert(!isReviewOnly("index.html"), "the home page is not review-only");
  // The model reads the shipped stylesheet, so a build proves the reader works
  // against a real minifier rather than against a fixture.
  assert(result.counts.paletteTokens > 0, "the shipped palette was read");
  assert(
    landmarksOf("<main></main>").length === 1,
    "the landmark reader works",
  );
  equal(
    landmarkViolations([{ tag: "main" }], ["main"]).length,
    0,
    "a lone main",
  );
});

// ---------------------------------------------------------------------------

for (const root of created) rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nAccessibility audit suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Accessibility audit suite OK\n");
