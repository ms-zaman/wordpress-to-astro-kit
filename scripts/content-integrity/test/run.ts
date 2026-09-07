// content-integrity suite.
//
// The model is pure — it takes what content intended, what the manifest
// claims, and what is on disk — so every branch can be exercised without a
// build. That matters more here than in most gates: the cases worth proving
// are the ones where a build SUCCEEDS and is still wrong, and those are
// expensive to stage for real and trivial to state as three sets.
import process from "node:process";

import {
  checkContentIntegrity,
  expectedFileFor,
  findingsOfKind,
  localeExclusions,
  type Exclusion,
  type EmittedRoute,
  type IntendedContent,
} from "../../../apps/website/src/deployment/content-integrity.ts";
import {
  entryId,
  kindOf,
  localeOf,
  rowId,
} from "../../../apps/website/src/deployment/content-identity.ts";

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

function assert(condition: boolean, detail: string): void {
  if (!condition) throw new Error(detail);
}

function equal<T>(actual: T, expected: T, detail: string): void {
  if (actual !== expected)
    throw new Error(
      `${detail}: expected ${String(expected)}, got ${String(actual)}`,
    );
}

// ---------------------------------------------------------------------------
// A minimal site: one post, one page, one category. Enough to state every
// case, small enough that a failure names the case rather than the fixture.
const POST = entryId("posts", "hello-world", "en");
const PAGE = entryId("pages", "about", "en");
const CATEGORY = rowId("categories", "news");

const intended: IntendedContent[] = [
  { id: POST, expectedRoute: "/hello-world/" },
  { id: PAGE, expectedRoute: "/about/" },
  { id: CATEGORY, expectedRoute: "/category/news/" },
];

const emitted: EmittedRoute[] = [
  { path: "/", file: "index.html", origin: "static" },
  { path: "/404", file: "404.html", origin: "static" },
  {
    path: "/hello-world",
    file: "hello-world/index.html",
    origin: "post",
    entry: POST,
  },
  { path: "/about", file: "about/index.html", origin: "page", entry: PAGE },
  {
    path: "/category/news",
    file: "category/news/index.html",
    origin: "archive",
    entry: CATEGORY,
  },
];

const allFiles = new Set(emitted.map((route) => route.file));

const run = (
  overrides: Partial<Parameters<typeof checkContentIntegrity>[0]> = {},
) =>
  checkContentIntegrity({
    intended,
    emitted,
    exclusions: [],
    filesInDist: allFiles,
    ...overrides,
  });

console.log("\nThe healthy case");

check("every intended entry that arrived is reported as emitted", () => {
  const report = run();
  equal(report.findings.length, 0, "a whole site has no findings");
  equal(report.emitted.length, 3, "all three arrived");
  equal(report.counts.posts, 1, "posts counted");
  equal(report.counts.pages, 1, "pages counted");
  equal(report.counts.categories, 1, "categories counted");
  equal(report.counts.total, 3, "and the total");
});

check("A STATIC ROUTE NEEDS NO CONTENT BEHIND IT", () => {
  // `/` and `/404` come from a module, not from an entry. Demanding an
  // identity for them would make the gate cry wolf on every build.
  equal(run().findings.length, 0, "static routes are not OUTPUT_ONLY");
});

console.log("\nSOURCE_ONLY — content that did not cross the boundary");

check("AN ENTRY THE RESOLVER DROPPED, WITH NO REASON, IS A FAILURE", () => {
  // The defect this whole gate exists for: `resolveSiteRoutes` filters, the
  // build succeeds, every other gate reads one side of the boundary, and the
  // entry is gone without a word.
  const report = run({
    emitted: emitted.filter((route) => route.entry !== POST),
  });
  const found = findingsOfKind(report.findings, "SOURCE_ONLY");
  equal(found.length, 1, "exactly one");
  equal(found[0]!.subject, POST, "named by identity");
  equal(found[0]!.expectedRoute, "/hello-world/", "with where to look");
  equal(
    found[0]!.expectedOutput,
    "hello-world/index.html",
    "and what should be there",
  );
});

check("a route the manifest CLAIMS but did not write is a failure", () => {
  // The manifest is a claim, not the artifact. A build that resolves a route
  // and emits no file passes any check that reads only the manifest.
  const report = run({
    filesInDist: new Set(
      [...allFiles].filter((file) => file !== "hello-world/index.html"),
    ),
  });
  const found = findingsOfKind(report.findings, "SOURCE_ONLY");
  equal(found.length, 1, "one");
  equal(found[0]!.subject, POST, "the post");
  assert(
    found[0]!.detail.includes("did not write what it said it wrote"),
    "and the detail says which half failed",
  );
});

console.log("\nEXCLUDED — withheld on purpose, and typed");

check("A DECLARED EXCLUSION IS NOT A FAILURE", () => {
  const withheld = entryId("pages", "sobre", "pt-BR");
  const exclusions: Exclusion[] = [
    {
      id: withheld,
      reason: "locale-not-built",
      detail: 'locale "pt-BR"; this build publishes "en".',
    },
  ];
  const report = run({
    intended: [...intended, { id: withheld }],
    exclusions,
  });
  equal(report.findings.length, 0, "no findings");
  equal(report.excluded.length, 1, "one excluded");
  equal(
    report.excluded[0]!.reason,
    "locale-not-built",
    "with its typed reason",
  );
});

check("an UNDECLARED entry in the same position IS a failure", () => {
  // The two are indistinguishable in a build log and must not be
  // indistinguishable here. Same entry, same absence, no declaration.
  const withheld = entryId("pages", "sobre", "pt-BR");
  const report = run({ intended: [...intended, { id: withheld }] });
  equal(findingsOfKind(report.findings, "SOURCE_ONLY").length, 1, "reported");
});

check("AN EXCLUSION THAT EXCUSES NOTHING IS REPORTED", () => {
  // A stale rule is how a real defect gets waved through a year later.
  const report = run({
    exclusions: [
      {
        id: entryId("pages", "deleted-long-ago", "de"),
        reason: "locale-not-built",
        detail: "a page that no longer exists",
      },
    ],
  });
  const found = findingsOfKind(report.findings, "UNUSED_EXCLUSION");
  equal(found.length, 1, "one");
  assert(found[0]!.detail.includes("Delete it"), "and it says what to do");
});

console.log("\nOUTPUT_ONLY — pages nothing explains");

check("a page emitted from content that is not intended is a failure", () => {
  const report = run({
    emitted: [
      ...emitted,
      {
        path: "/ghost",
        file: "ghost/index.html",
        origin: "post",
        entry: entryId("posts", "ghost", "en"),
      },
    ],
  });
  const found = findingsOfKind(report.findings, "OUTPUT_ONLY");
  equal(found.length, 1, "one");
  equal(found[0]!.subject, "/ghost", "named by route");
});

check("A CONTENT ROUTE THAT NAMES NO SOURCE IS A FAILURE", () => {
  // Without this, the whole contract is opt-in: a route that simply omits its
  // identity would be joined against nothing and pass.
  const report = run({
    emitted: [
      ...emitted,
      { path: "/orphan", file: "orphan/index.html", origin: "post" },
    ],
  });
  const found = findingsOfKind(report.findings, "OUTPUT_ONLY");
  equal(found.length, 1, "reported");
  assert(
    found[0]!.detail.includes("carries no content identity"),
    "and says why",
  );
});

check("the posts listing is structural, not orphaned", () => {
  // It is derived from the whole collection the way `/search` is, so it has no
  // single entry — but a CATEGORY archive does, and the same relaxation must
  // not cover that.
  const report = run({
    emitted: [
      ...emitted,
      {
        path: "/blog",
        file: "blog/index.html",
        origin: "archive",
        entry: "@posts-index",
      },
    ],
  });
  equal(report.findings.length, 0, "a structural identity is accepted");
});

console.log("\nThe locale rule");

check("LOCALE EXCLUSIONS ARE DERIVED, AND NAME EVERY ENTRY", () => {
  // Derived from the rule rather than hand-listed — nobody maintains a list of
  // 1,235 translated entries — but each one still appears by name, which is
  // the difference between "withheld" and "vanished".
  const translated = [
    { id: entryId("pages", "sobre", "pt-BR") },
    { id: entryId("pages", "guanyu", "zh-Hans") },
    { id: PAGE },
    { id: CATEGORY },
  ];
  const exclusions = localeExclusions(translated, "en");
  equal(exclusions.length, 2, "both translations, and nothing else");
  assert(
    exclusions.every((one) => one.reason === "locale-not-built"),
    "typed",
  );
  assert(
    exclusions[0]!.detail.includes("pt-BR") ||
      exclusions[1]!.detail.includes("pt-BR"),
    "and the detail names the locale",
  );
});

check("a registry row is never excluded by locale", () => {
  // A category row carries a name for every language; it is not a translation
  // of anything. Excluding it would withhold an archive the site needs.
  equal(localeExclusions([{ id: CATEGORY }], "en").length, 0, "not excluded");
});

check("REGIONAL AND SCRIPT LOCALES SURVIVE THE ROUND TRIP", () => {
  // The identity has to carry the locale form the registry now accepts, or
  // the gate's exclusions would name something the content tree does not.
  for (const code of ["pt-BR", "zh-Hans", "en-GB", "en"]) {
    const id = entryId("pages", "about", code);
    equal(localeOf(id), code, `localeOf("${id}")`);
    equal(kindOf(id), "pages", "and the kind");
  }
});

console.log("\nDiagnostics are pasteable");

check("a trailing slash does not produce a double slash", () => {
  // Found by reading this gate's own first output: a permalink hint arrives as
  // `/a-second-post/` and the expected file read `a-second-post//index.html`,
  // a path that exists nowhere, in a line whose only job is to be pasteable.
  equal(expectedFileFor("/a-second-post/"), "a-second-post/index.html", "post");
  equal(
    expectedFileFor("/a-second-post"),
    "a-second-post/index.html",
    "no slash",
  );
  equal(expectedFileFor("/"), "index.html", "the root");
  equal(expectedFileFor("/404"), "404.html", "and Astro's one exception");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nContent integrity suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Content integrity suite OK\n");
