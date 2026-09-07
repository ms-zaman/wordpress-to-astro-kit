// content-capture suite.
//
// No network. The REST client is a client for somebody else's server and is
// deliberately thin; what is tested here is everything that DECIDES:
//
//   1. The body report, which is what stops a capture writing 27 stub articles
//      and reporting success.
//   2. The paging contract, exercised against a fake reader — because a
//      capture that stops at page one is the failure mode with no symptom.
//   3. The retry rule, which must fire for a refusal and must NOT fire for a
//      404: a missing attachment is a fact about the site.
import process from "node:process";

import {
  bodyReport,
  builderInBody,
  MINIMUM_CORPUS,
  SHORT_FRACTION,
} from "../bodies.ts";
import { WordPressRest } from "../rest.ts";
import type { Fetched, PoliteReader } from "../../site-map-audit/fetch.ts";

let passed = 0;
const failures: string[] = [];

// Assertions are QUEUED and run at the end, because several of them are async
// and a section header printed eagerly would appear above results it does not
// belong to. A section is queued the same way, so the output reads in order.
type Step =
  | { kind: "section"; title: string }
  | { kind: "check"; name: string; assertion: () => void | Promise<void> };

const steps: Step[] = [];

const section = (title: string): void => {
  steps.push({ kind: "section", title });
};

const check = (name: string, assertion: () => void | Promise<void>): void => {
  steps.push({ kind: "check", name, assertion });
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const equal = (actual: unknown, expected: unknown, label: string): void =>
  assert(
    actual === expected,
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );

/**
 * A reader that answers from a script, and records what it was asked.
 *
 * An explicit field rather than a constructor parameter property: Node's
 * strip-only TypeScript rejects the latter, and it fails at LOAD rather than
 * at check time, so nothing catches it until the suite is run.
 */
class FakeReader {
  readonly asked: string[] = [];
  readonly #answer: (url: string, attempt: number) => Fetched;
  #requests = 0;
  constructor(answer: (url: string, attempt: number) => Fetched) {
    this.#answer = answer;
  }
  get requests(): number {
    return this.#requests;
  }
  async get(url: string): Promise<Fetched> {
    this.#requests += 1;
    this.asked.push(url);
    return this.#answer(url, this.asked.filter((seen) => seen === url).length);
  }
  async getRetrying(url: string, attempts = 4): Promise<Fetched> {
    let last: Fetched | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await this.get(url);
      if (response.status >= 200 && response.status < 500) return response;
      last = response;
    }
    return last!;
  }
}

const json = (
  value: unknown,
  headers: Record<string, string> = {},
  status = 200,
): Fetched => ({
  url: "",
  status,
  headers,
  contentType: "application/json",
  body: JSON.stringify(value),
});

const restWith = (
  answer: (url: string, attempt: number) => Fetched,
): { rest: WordPressRest; reader: FakeReader } => {
  const reader = new FakeReader(answer);
  return {
    rest: new WordPressRest(
      reader as unknown as PoliteReader,
      "https://example.com",
    ),
    reader,
  };
};

// ---------------------------------------------------------------------------
section("Which bodies did NOT come back whole");

/** A corpus shaped like the one that motivated this: a long tail and a cliff. */
const corpus = (long: number, short: number) => [
  ...Array.from({ length: long }, (unused, index) => ({
    id: index + 1,
    slug: `long-${index}`,
    html: "<p>" + "x".repeat(11_000) + "</p>",
  })),
  ...Array.from({ length: short }, (unused, index) => ({
    id: 1_000 + index,
    slug: `short-${index}`,
    html: "<p>" + "x".repeat(450) + "</p>",
  })),
];

check("the cliff is found, and only the entries below it", () => {
  // The measured shape: 251 complete bodies with a median around 11,000, and
  // 27 that returned an intro at around 450. An order of magnitude apart is
  // what a body living in postmeta looks like.
  const report = bodyReport(corpus(251, 27));
  equal(report.count, 278, "corpus size");
  equal(report.incomplete.length, 27, "incomplete");
  assert(
    report.incomplete.every((stat) => stat.slug.startsWith("short-")),
    "only the short ones",
  );
});

check("a uniformly short corpus flags NOTHING", () => {
  assert(
    SHORT_FRACTION > 0 && SHORT_FRACTION < 1,
    "the threshold is a fraction",
  );
  // A documentation site's articles are legitimately shorter than a
  // magazine's. The threshold is relative for exactly this reason: "short" has
  // no fixed meaning, and a flat ceiling would flag every entry on such a site.
  const report = bodyReport(
    Array.from({ length: 40 }, (unused, index) => ({
      id: index,
      slug: `note-${index}`,
      html: "<p>" + "x".repeat(400) + "</p>",
    })),
  );
  equal(report.incomplete.length, 0, "incomplete");
});

check("THE RULE IS RELATIVE, WITH NO ABSOLUTE CAP", () => {
  // The defect this replaced. The floor was `min(median / 5, 1500)`, and on a
  // real corpus — median 20,790, stubs at 1,913 to 2,794 — the cap put the
  // floor BELOW every stub and found none of them. A guard added to prevent
  // over-reporting had made the rule unable to find the thing it exists for.
  const real = [
    ...Array.from({ length: 264 }, (unused, index) => ({
      id: index,
      slug: `full-${index}`,
      html: "x".repeat(20_790),
    })),
    ...Array.from({ length: 14 }, (unused, index) => ({
      id: 900 + index,
      slug: `stub-${index}`,
      html: "x".repeat(2_200),
    })),
  ];
  const report = bodyReport(real);
  equal(report.median, 20_790, "median");
  equal(report.incomplete.length, 14, "every stub is found");
  assert(
    report.incomplete.every((stat) => stat.slug.startsWith("stub-")),
    "and nothing else is",
  );
  // 2,200 is well above the 1,500 the old cap used, which is exactly why the
  // cap was wrong.
  assert(2_200 > 1_500, "the stubs sit above the old absolute cap");
});

check("OVER-REPORTING IS THE DIRECTION IT LEANS, deliberately", () => {
  // On a corpus of enormous entries, a merely-long one is flagged. That costs
  // one page fetch and a line in a list somebody reads. The other direction
  // silently writes a stub article and reports success, so the asymmetry
  // settles which way the rule errs.
  const report = bodyReport([
    ...Array.from({ length: 10 }, (unused, index) => ({
      id: index,
      slug: `huge-${index}`,
      html: "x".repeat(100_000),
    })),
    { id: 99, slug: "merely-long", html: "x".repeat(5_000) },
  ]);
  equal(report.incomplete.length, 1, "flagged");
  equal(report.incomplete[0]?.slug, "merely-long", "which one");
});

check("a corpus too small for a median flags nothing", () => {
  // A median over three entries describes nothing, and a rule built on one
  // would report whichever entry happened to be shortest.
  const tiny = Array.from({ length: MINIMUM_CORPUS - 1 }, (unused, index) => ({
    id: index,
    slug: `entry-${index}`,
    html: "x".repeat(index === 0 ? 10 : 10_000),
  }));
  equal(bodyReport(tiny).incomplete.length, 0, "nothing flagged");
  // One more entry and the rule applies.
  const enough = [
    ...tiny,
    { id: 99, slug: "another", html: "x".repeat(10_000) },
  ];
  equal(bodyReport(enough).incomplete.length, 1, "the outlier is found");
});

check("the report carries the distribution, whatever it concludes", () => {
  // A corpus where every body is 400 characters is telling you something about
  // the site, not about this heuristic, so the numbers are always printed.
  const report = bodyReport(corpus(3, 1));
  assert(report.median > 0, "median");
  assert(report.min < report.max, "min and max");
  equal(report.stats.length, 4, "one stat per entry");
});

check("an empty corpus does not divide by zero", () => {
  const report = bodyReport([]);
  equal(report.count, 0, "count");
  equal(report.median, 0, "median");
  equal(report.incomplete.length, 0, "incomplete");
});

section("Page builders leave markers, except when they do not");

check("the common builders are recognised", () => {
  equal(
    builderInBody('<div class="elementor-section">x</div>'),
    "elementor",
    "elementor",
  );
  equal(builderInBody('<div class="et_pb_row">x</div>'), "divi", "divi");
  equal(builderInBody('<div class="vc_row">x</div>'), "wpbakery", "wpbakery");
  equal(
    builderInBody('<div class="fl-builder-content">x</div>'),
    "beaver-builder",
    "beaver builder",
  );
  equal(builderInBody("<p>an ordinary post</p>"), undefined, "no builder");
});

check("A MARKER IS NOT ENOUGH ON ITS OWN, and neither is its absence", () => {
  // The case that matters most is a builder that left NO marker, because it
  // kept everything in postmeta — which is exactly when the body is missing.
  // So length is what decides `incomplete`, and a marker only earns a note.
  const report = bodyReport([
    ...Array.from({ length: 10 }, (unused, index) => ({
      id: index,
      slug: `full-${index}`,
      html: "x".repeat(10_000),
    })),
    { id: 90, slug: "stub-no-marker", html: "<p>An intro paragraph.</p>" },
    {
      id: 91,
      slug: "long-with-marker",
      html: '<div class="elementor-section">' + "x".repeat(10_000) + "</div>",
    },
  ]);
  const incomplete = report.incomplete.map((stat) => stat.slug);
  assert(incomplete.includes("stub-no-marker"), "a short body with no marker");
  assert(
    !incomplete.includes("long-with-marker"),
    "a long body that merely carries markup is not incomplete",
  );
  const marked = report.stats.find((stat) => stat.slug === "long-with-marker");
  assert(marked?.reason !== undefined, "but it is still worth a note");
});

// ---------------------------------------------------------------------------
section("The REST client");

check("`_fields` is sent, and nested selection never is", async () => {
  // Nested selection silently returns nothing on some versions, which is the
  // worst possible failure for a capture: an empty body that looks like an
  // empty post.
  const { rest, reader } = restWith(() => json([], { "x-wp-total": "0" }));
  await rest.collection("posts", ["id", "content"], {});
  const asked = reader.asked[0] ?? "";
  assert(asked.includes("_fields=id%2Ccontent"), asked);
  assert(!asked.includes("content."), "no nested selection");
});

check("PAGING FOLLOWS x-wp-totalpages, NOT a short page", async () => {
  // The failure with no symptom. A filter that removes a row after the query
  // runs makes a full page look short, and a reader that stopped there would
  // capture part of a site and report success.
  const { rest } = restWith((url) => {
    const page = Number(new URL(url).searchParams.get("page") ?? "1");
    const headers = { "x-wp-total": "5", "x-wp-totalpages": "3" };
    // Every page comes back SHORT of `per_page`.
    return json([{ id: page * 10 }, { id: page * 10 + 1 }], headers);
  });
  const { items, declaredTotal, pages } = await rest.collection<{ id: number }>(
    "posts",
    ["id"],
    {},
  );
  equal(pages, 3, "pages followed from the header");
  equal(items.length, 6, "every page was read despite each being short");
  equal(declaredTotal, 5, "and the declared total is carried for comparison");
});

check(
  "a limit stops the paging early, and is not a truncation bug",
  async () => {
    const { rest } = restWith(() =>
      json([{ id: 1 }, { id: 2 }, { id: 3 }], {
        "x-wp-total": "300",
        "x-wp-totalpages": "3",
      }),
    );
    const { items } = await rest.collection<{ id: number }>("posts", ["id"], {
      limit: 2,
    });
    equal(items.length, 2, "limited");
  },
);

check(
  "a count is one request, and names a refusal for what it is",
  async () => {
    const { rest, reader } = restWith(() => json([], { "x-wp-total": "278" }));
    const count = await rest.count("posts");
    equal(count.total, 278, "total");
    equal(reader.requests, 1, "one request");

    const { rest: refused } = restWith(() => json({}, {}, 403));
    const denied = await refused.count("private");
    equal(denied.total, null, "no total");
    assert(
      denied.note?.includes("may genuinely need a credential") === true,
      denied.note ?? "",
    );
  },
);

check("a 200 with no total header is unknown, not zero", async () => {
  // Zero would read as "this collection is empty", which is a different and
  // much worse claim than "the size is unknown".
  const { rest } = restWith(() => json([]));
  const count = await rest.count("posts");
  equal(count.total, null, "unknown");
  assert(count.note?.includes("no x-wp-total") === true, count.note ?? "");
});

check("types and taxonomies survive a route that answers nothing", async () => {
  const { rest } = restWith(() => json(null, {}, 404));
  equal((await rest.postTypes()).length, 0, "types");
  equal((await rest.taxonomies()).length, 0, "taxonomies");
});

check(
  "a type's REST base is used, because it is not always its name",
  async () => {
    const { rest } = restWith((url) => {
      if (url.includes("/types"))
        return json({
          docs: { slug: "docs", name: "Docs", rest_base: "docs-articles" },
        });
      return json([], { "x-wp-total": "0" });
    });
    const [type] = await rest.postTypes();
    equal(type?.name, "docs", "name");
    equal(type?.restBase, "docs-articles", "rest base");
  },
);

section("The retry rule");

check(
  "A REFUSAL IS RETRIED, because not retrying rewrites content",
  async () => {
    // Measured: 278 back-to-back media requests, 80 refused, and the catch
    // around each one turned that into 80 posts quietly losing their featured
    // image. A transient condition had rewritten somebody's content.
    const { rest, reader } = restWith((url, attempt) =>
      attempt < 3
        ? json({}, {}, 503)
        : json({ source_url: "https://example.com/x.png" }),
    );
    const media = await rest.media(7);
    equal(
      media.sourceUrl,
      "https://example.com/x.png",
      "resolved after retries",
    );
    equal(reader.requests, 3, "it took three attempts");
  },
);

check(
  "A 404 IS NOT RETRIED, because a missing attachment is a fact",
  async () => {
    const { rest, reader } = restWith(() => json({}, {}, 404));
    const media = await rest.media(9);
    equal(media.status, 404, "status");
    equal(media.sourceUrl, undefined, "no url");
    equal(reader.requests, 1, "one request, not four");
  },
);

check("a refusal that never clears is returned, not thrown", async () => {
  // The capture records it and the CLI reports it. Throwing would lose every
  // row already captured.
  const { rest, reader } = restWith(() => json({}, {}, 503));
  const media = await rest.media(11);
  equal(media.status, 503, "the last status");
  equal(reader.requests, 4, "bounded at four attempts");
});

// ---------------------------------------------------------------------------
for (const step of steps) {
  if (step.kind === "section") {
    console.log(`\n${step.title}`);
    continue;
  }
  try {
    await step.assertion();
    passed += 1;
    console.log(`  ✓ ${step.name}`);
  } catch (thrown) {
    failures.push(`${step.name} — ${(thrown as Error).message}`);
    console.log(`  ✗ ${step.name}`);
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nContent capture suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Content capture suite OK\n");
