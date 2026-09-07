// preview-audit suite.
//
// Two halves. The first exercises each module against hand-built inputs. The
// second is the MUTATION half: it writes a complete, internally consistent
// synthetic build to a temporary directory, proves the audit passes it, then
// breaks exactly one thing and proves the audit fails and says which thing.
//
// The mutation half is the part with value. A checker that has only ever seen
// output it accepts is a checker nobody has tested — the interesting question
// is not "does it pass a good build" but "does it catch a bad one", and the
// faults exercised here are the four an audit of a DEPLOYED artifact exists to
// catch: a missing route, a missing asset, an invalid manifest, and broken
// deployment metadata.
//
// The synthetic build is generated FROM `buildManifest`, not hand-written, so
// the baseline cannot drift out of agreement with the route model. Every
// mutation is applied to a fresh copy — a mutation that leaked into the next
// case would make the suite report faults it did not cause.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  buildManifest,
  serializeManifest,
  type DeploymentManifest,
} from "../../../apps/website/src/deployment/manifest.ts";
import { auditPreview } from "../audit.ts";
import {
  MANIFEST_FILE,
  checkAssets,
  checkLinks,
  checkManifest,
  checkRoutes,
  checkScripts,
} from "../checks.ts";
import { errorsIn, sortFindings } from "../finding.ts";
import { htmlPages, readBuildOutput } from "../output.ts";
import { collectReferences, declaresBase } from "../references.ts";

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

// ---------------------------------------------------------------------------
// The synthetic build
// ---------------------------------------------------------------------------

const ASSET = "assets/sample/placeholder.svg";

/** The manifest the synthetic build describes. */
const syntheticManifest = (): DeploymentManifest =>
  buildManifest({
    resolved: [
      { path: "/about", kind: "page" },
      { path: "/privacy-policy", kind: "page" },
      { path: "/blog", kind: "archive", page: 1 },
      { path: "/blog/first-post", kind: "post" },
      { path: "/blog/second-post", kind: "post" },
      { path: "/category/news", kind: "archive", page: 1 },
    ],
    collections: [
      { name: "pages", entries: 2, routed: 2 },
      { name: "posts", entries: 2, routed: 2 },
    ],
    intended: [],
    locale: "en",
  });

const write = (root: string, file: string, contents: string): void => {
  const absolute = path.join(root, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
};

/** A page that links to the site root and loads the one shared asset. */
const documentFor = (route: { path: string }): string =>
  [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="robots" content="noindex" />',
    `<title>${route.path}</title>`,
    "</head>",
    "<body>",
    '<a href="/">Home</a>',
    '<a href="/privacy-policy">Privacy</a>',
    `<img src="/${ASSET}" alt="" />`,
    "</body>",
    "</html>",
    "",
  ].join("\n");

/**
 * Write a complete synthetic build and return its root.
 *
 * Every file the manifest promises is emitted, which is what makes the
 * baseline a real baseline: if this function forgot one, the first assertion
 * below would fail rather than every mutation passing for the wrong reason.
 */
function createBuild(
  mutateManifest?: (manifest: DeploymentManifest) => DeploymentManifest,
): string {
  const root = mkdtempSync(path.join(tmpdir(), "preview-audit-"));
  const manifest = syntheticManifest();

  for (const route of manifest.routes.inventory) {
    if (route.kind === "page") write(root, route.file, documentFor(route));
    else if (route.file !== MANIFEST_FILE) write(root, route.file, "[]\n");
  }

  write(root, ASSET, '<svg xmlns="http://www.w3.org/2000/svg" />\n');
  write(
    root,
    MANIFEST_FILE,
    serializeManifest(mutateManifest ? mutateManifest(manifest) : manifest),
  );

  return root;
}

const created: string[] = [];
const build = (
  mutateManifest?: (manifest: DeploymentManifest) => DeploymentManifest,
): string => {
  const root = createBuild(mutateManifest);
  created.push(root);
  return root;
};

/** Deep clone through JSON — the manifest is a JSON document by construction. */
const clone = (manifest: DeploymentManifest): DeploymentManifest =>
  JSON.parse(JSON.stringify(manifest)) as DeploymentManifest;

const detailsOf = (findings: readonly { detail: string }[]): string =>
  findings.map((finding) => finding.detail).join(" | ");

/**
 * Where the findings point. Manifest findings name the offending key in `at`
 * (`deployment.json#routes.total`) and describe the fault in `detail`.
 */
const locationsOf = (findings: readonly { at: string }[]): string =>
  findings.map((finding) => finding.at).join(" | ");

// ---------------------------------------------------------------------------
console.log("\nReading a build output");

check("a build output is read into dist-relative POSIX paths", () => {
  const output = readBuildOutput(build());
  assert(output.files.has("index.html"), "the site root was not read");
  assert(output.files.has("about/index.html"), "a nested page was not read");
  for (const file of output.files.keys())
    assert(!file.includes("\\"), `${file} carries a platform separator`);
});

check("text is attached for parsed types and byte sizes for everything", () => {
  const output = readBuildOutput(build());
  const page = output.files.get("index.html");
  assert(page?.text?.includes("<html") === true, "no HTML text was read");
  assert((page?.bytes ?? 0) > 0, "no byte size was recorded");
});

check(
  "a missing output directory throws rather than reporting a vacuous pass",
  () => {
    let threw = "";
    try {
      readBuildOutput(path.join(tmpdir(), "preview-audit-does-not-exist"));
    } catch (thrown) {
      threw = (thrown as Error).message;
    }
    assert(threw.includes("no build output"), `unexpected message: ${threw}`);
  },
);

check("an empty output directory throws", () => {
  const empty = mkdtempSync(path.join(tmpdir(), "preview-empty-"));
  created.push(empty);
  let threw = "";
  try {
    readBuildOutput(empty);
  } catch (thrown) {
    threw = (thrown as Error).message;
  }
  assert(threw.includes("is empty"), `unexpected message: ${threw}`);
});

check("htmlPages returns only documents, in path order", () => {
  const pages = htmlPages(readBuildOutput(build()));
  assert(pages.length > 0, "no pages");
  for (const page of pages)
    assert(page.file.endsWith(".html"), `${page.file} is not HTML`);
  const paths = pages.map((page) => page.file);
  assert(
    paths.join("\n") ===
      [...paths].sort((a, b) => a.localeCompare(b)).join("\n"),
    "pages are not in path order",
  );
});

console.log("\nReading what a page points at");

check("an anchor href is a page reference and an img src is an asset", () => {
  const references = collectReferences(
    "index.html",
    '<a href="/blog">Blog</a><img src="/x.svg" alt="" />',
  );
  equal(references.length, 2, "reference count");
  equal(references[0]!.isAsset, false, "anchor treated as asset");
  equal(references[1]!.isAsset, true, "image not treated as asset");
});

check("scope separates internal, relative, external and fragment", () => {
  const references = collectReferences(
    "blog/index.html",
    '<a href="/blog">a</a><a href="../x">b</a>' +
      '<a href="https://example.com">c</a><a href="#main">d</a>' +
      '<a href="mailto:someone@example.com">e</a><a href="//cdn.example">f</a>',
  );
  equal(
    references.map((reference) => reference.scope).join(","),
    "internal,relative,external,fragment,external,external",
    "scopes",
  );
});

check("the query and fragment are stripped from the checked target", () => {
  const [reference] = collectReferences(
    "index.html",
    '<a href="/search?q=a#top">s</a>',
  );
  equal(reference!.raw, "/search?q=a#top", "raw is not preserved");
  equal(reference!.target, "/search", "target");
});

check("every srcset candidate is read, without its descriptor", () => {
  const references = collectReferences(
    "index.html",
    '<img srcset="/a.png 1x, /b.png 2x" src="/a.png" alt="" />',
  );
  equal(
    references
      .map((reference) => reference.target)
      .sort()
      .join(","),
    "/a.png,/a.png,/b.png",
    "srcset targets",
  );
  for (const reference of references)
    equal(reference.isAsset, true, "srcset asset flag");
});

check("a stylesheet link is an asset and a canonical link is not", () => {
  const [stylesheet] = collectReferences(
    "index.html",
    '<link rel="stylesheet" href="/a.css" />',
  );
  const [canonical] = collectReferences(
    "index.html",
    '<link rel="canonical" href="https://example.com/x" />',
  );
  equal(stylesheet!.isAsset, true, "stylesheet");
  equal(canonical!.isAsset, false, "canonical");
});

check("an empty attribute value is not a reference", () => {
  equal(
    collectReferences("index.html", '<a href="">x</a><img src="" />').length,
    0,
    "count",
  );
});

check("a <base href> is detected", () => {
  equal(declaresBase('<base href="/preview/" />'), true, "base detected");
  equal(declaresBase("<basefont />"), false, "false positive");
});

console.log("\nThe five checks, in isolation");

check("a build with no manifest reports one error and no manifest", () => {
  const root = build();
  rmSync(path.join(root, MANIFEST_FILE));
  const result = checkManifest(readBuildOutput(root));
  equal(result.manifest, undefined, "manifest returned");
  equal(errorsIn(result.findings).length, 1, "error count");
  assert(
    detailsOf(result.findings).includes("no deployment manifest"),
    "wrong finding",
  );
});

check("an unparseable manifest is an error, not a crash", () => {
  const root = build();
  write(root, MANIFEST_FILE, '{"manifestVersion": 1,');
  const result = checkManifest(readBuildOutput(root));
  equal(errorsIn(result.findings).length, 1, "error count");
  assert(
    detailsOf(result.findings).includes("not valid JSON"),
    "wrong finding",
  );
});

check("the build-timestamp placeholder is a warning, never an error", () => {
  const result = checkManifest(readBuildOutput(build()));
  equal(errorsIn(result.findings).length, 0, "errors on a clean build");
  equal(result.findings.length, 1, "finding count");
  equal(result.findings[0]!.severity, "warning", "severity");
});

check("an HTML page the manifest does not claim is an error", () => {
  const root = build();
  write(root, "orphan/index.html", "<html><body>orphan</body></html>");
  const output = readBuildOutput(root);
  const findings = checkRoutes(output, checkManifest(output).manifest);
  equal(findings.length, 1, "finding count");
  assert(
    detailsOf(findings).includes("route inventory does not claim"),
    "wrong finding",
  );
});

check("a route emitted as a zero-byte file is an error", () => {
  const root = build();
  write(root, "about/index.html", "");
  const output = readBuildOutput(root);
  const findings = checkRoutes(output, checkManifest(output).manifest);
  equal(findings.length, 1, "finding count");
  assert(detailsOf(findings).includes("empty file"), "wrong finding");
});

check(
  "routes cannot be verified without a manifest, and the audit says so",
  () => {
    const findings = checkRoutes(readBuildOutput(build()), undefined);
    equal(findings.length, 1, "finding count");
    assert(
      detailsOf(findings).includes("without a usable manifest"),
      "wrong finding",
    );
  },
);

check("all three spellings of a link to an emitted page resolve", () => {
  const root = build();
  write(
    root,
    "index.html",
    '<html><body><a href="/privacy-policy">a</a>' +
      '<a href="/privacy-policy/">b</a>' +
      '<a href="/deployment.json">c</a>' +
      '<a href="/">d</a></body></html>',
  );
  equal(checkLinks(readBuildOutput(root)).length, 0, "findings on valid links");
});

check("a relative link is resolved against the page that makes it", () => {
  const root = build();
  write(
    root,
    "blog/index.html",
    '<html><body><a href="../privacy-policy">up</a></body></html>',
  );
  equal(checkLinks(readBuildOutput(root)).length, 0, "a valid relative link");
});

check("a relative link escaping the output is an error", () => {
  const root = build();
  write(
    root,
    "index.html",
    '<html><body><a href="../../etc/passwd">x</a></body></html>',
  );
  const findings = checkLinks(readBuildOutput(root));
  equal(findings.length, 1, "finding count");
  assert(
    detailsOf(findings).includes("outside the build output"),
    "wrong finding",
  );
});

check("an external link is recorded and never followed", () => {
  const root = build();
  write(
    root,
    "index.html",
    '<html><body><a href="https://nothing.invalid/x">x</a></body></html>',
  );
  equal(checkLinks(readBuildOutput(root)).length, 0, "no finding");
});

check("a <base href> is an error because it changes every relative URL", () => {
  const root = build();
  write(
    root,
    "index.html",
    '<html><head><base href="/p/" /></head><body>x</body></html>',
  );
  assert(
    detailsOf(checkLinks(readBuildOutput(root))).includes("<base href>"),
    "wrong finding",
  );
});

check("a zero-byte asset is an error", () => {
  const root = build();
  write(root, ASSET, "");
  const findings = checkAssets(readBuildOutput(root));
  assert(findings.length > 0, "no finding");
  assert(detailsOf(findings).includes("zero-byte"), "wrong finding");
});

check("an undeclared <script> tag is a client-script regression", () => {
  const root = build();
  write(
    root,
    "index.html",
    "<html><body><script>console.log(1)</script></body></html>",
  );
  const findings = checkScripts(readBuildOutput(root));
  equal(findings.length, 1, "finding count");
  assert(
    detailsOf(findings).includes("undeclared executable"),
    "wrong finding",
  );
});

check("a typed or module script is still a regression", () => {
  // The rule was narrowed so structured data could be emitted. These are the
  // cases that must not have been narrowed away with it — a rule that stopped
  // catching `type="module"` would leave the whole property unenforced.
  for (const tag of [
    '<script type="module">import "./x.js"</script>',
    '<script type="text/javascript">go()</script>',
    '<script src="/x.js"></script>',
    '<script type="application/json">{"a":1}</script>',
  ]) {
    const root = build();
    write(root, "index.html", `<html><body>${tag}</body></html>`);
    assert(
      detailsOf(checkScripts(readBuildOutput(root))).includes(
        "undeclared executable",
      ),
      `not caught: ${tag}`,
    );
  }
});

check("an ld+json data block is not a client-script regression", () => {
  // It is data. No engine executes it, and the SEO audit is what checks that
  // it parses and names a type.
  const root = build();
  write(
    root,
    "index.html",
    '<html><body><script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting"}</script></body></html>',
  );
  equal(checkScripts(readBuildOutput(root)).length, 0, "finding count");
});

check(
  "A DECLARED INLINE ISLAND IS ALLOWED; one that loads a bundle is not",
  () => {
    // The two islands this kit ships are inline and declared. The narrowing has
    // to keep exactly that shape allowed and everything else out.
    const root = build();
    write(
      root,
      "index.html",
      '<html><body><script data-wpk-island="search">go()</script></body></html>',
    );
    equal(checkScripts(readBuildOutput(root)).length, 0, "an inline island");

    const other = build();
    write(
      other,
      "index.html",
      '<html><body><script data-wpk-island="search" src="/i.js"></script></body></html>',
    );
    assert(
      detailsOf(checkScripts(readBuildOutput(other))).includes(
        "loads a bundle",
      ),
      "an island that fetches a bundle",
    );

    const module = build();
    write(
      module,
      "index.html",
      '<html><body><script data-wpk-island="search" type="module">go()</script></body></html>',
    );
    assert(
      detailsOf(checkScripts(readBuildOutput(module))).includes(
        "loads a bundle",
      ),
      "an island that is a module",
    );
  },
);

check("a hydration island is a client-script regression", () => {
  const root = build();
  write(
    root,
    "index.html",
    '<html><body><astro-island uid="x"></astro-island></body></html>',
  );
  assert(
    detailsOf(checkScripts(readBuildOutput(root))).includes("hydration island"),
    "wrong finding",
  );
});

check("an inline event handler is a client-script regression", () => {
  const root = build();
  write(
    root,
    "index.html",
    '<html><body><button onclick="go()">x</button></body></html>',
  );
  const findings = checkScripts(readBuildOutput(root));
  equal(findings.length, 1, "finding count");
  assert(detailsOf(findings).includes("inline event handler"), "wrong finding");
});

check('an attribute merely beginning with "on" is not a handler', () => {
  const root = build();
  write(
    root,
    "index.html",
    '<html><body><div only="x" data-once="y">z</div></body></html>',
  );
  equal(checkScripts(readBuildOutput(root)).length, 0, "false positive");
});

console.log("\nMutations — one fault at a time, over a whole build");

check("the unmutated synthetic build passes", () => {
  const result = auditPreview(build());
  assert(result.ok, `baseline failed: ${detailsOf(errorsIn(result.findings))}`);
  equal(errorsIn(result.findings).length, 0, "errors");
  assert(
    result.counts.pages >= 8,
    `only ${result.counts.pages} pages in the baseline`,
  );
});

check(
  "MUTATION missing route — a promised page that was not emitted fails",
  () => {
    const root = build();
    rmSync(path.join(root, "blog/first-post"), { recursive: true });
    const result = auditPreview(root);
    assert(!result.ok, "the audit passed a build missing a page");
    const routeErrors = errorsIn(result.findings).filter(
      (finding) => finding.check === "routes",
    );
    equal(routeErrors.length, 1, "route error count");
    equal(
      routeErrors[0]!.at,
      "blog/first-post/index.html",
      "the missing file is named",
    );
    assert(routeErrors[0]!.detail.includes("not emitted"), "wrong finding");
    assert(
      routeErrors[0]!.detail.includes("[...path].astro"),
      "the finding does not name the route module that should have produced it",
    );
  },
);

check("MUTATION missing route — the pages that link to it fail too", () => {
  const root = build();
  rmSync(path.join(root, "privacy-policy"), { recursive: true });
  const result = auditPreview(root);
  const linkErrors = errorsIn(result.findings).filter(
    (finding) => finding.check === "links",
  );
  assert(
    linkErrors.length >= 2,
    `a deleted page every document links to produced ${linkErrors.length} link error(s)`,
  );
  assert(
    detailsOf(linkErrors).includes("broken internal link"),
    "wrong finding",
  );
});

check("MUTATION missing asset — a referenced file that is absent fails", () => {
  const root = build();
  rmSync(path.join(root, ASSET));
  const result = auditPreview(root);
  assert(!result.ok, "the audit passed a build missing an asset");
  const assetErrors = errorsIn(result.findings).filter(
    (finding) => finding.check === "assets",
  );
  assert(assetErrors.length > 0, "no asset error");
  assert(detailsOf(assetErrors).includes("did not emit"), "wrong finding");
  // The asset is not a route, so nothing in `routes` should fire for it.
  equal(
    errorsIn(result.findings).filter((finding) => finding.check === "routes")
      .length,
    0,
    "a missing asset was misreported as a missing route",
  );
});

check("MUTATION invalid manifest — a structurally wrong document fails", () => {
  const root = build();
  write(
    root,
    MANIFEST_FILE,
    JSON.stringify({ manifestVersion: 1, routes: {} }, null, 2),
  );
  const result = auditPreview(root);
  assert(!result.ok, "the audit passed an invalid manifest");
  const manifestErrors = errorsIn(result.findings).filter(
    (finding) => finding.check === "manifest",
  );
  assert(
    manifestErrors.length >= 3,
    `only ${manifestErrors.length} manifest error(s)`,
  );
  const locations = locationsOf(manifestErrors);
  assert(locations.includes("#generator"), "the generator was not checked");
  assert(locations.includes("#build"), "the build metadata was not checked");
  assert(
    locations.includes("#routes.inventory"),
    "the inventory was not checked",
  );
  assert(locations.includes("#content"), "the content summary was not checked");
  assert(
    locations.includes("#hosting"),
    "the hosting statement was not checked",
  );
});

check("MUTATION invalid manifest — a tampered route count fails", () => {
  const root = build();
  const manifest = syntheticManifest();
  write(
    root,
    MANIFEST_FILE,
    serializeManifest({
      ...manifest,
      routes: { ...manifest.routes, total: manifest.routes.total + 5 },
    }),
  );
  const result = auditPreview(root);
  assert(!result.ok, "counts that disagree with the inventory");
  assert(
    locationsOf(errorsIn(result.findings)).includes("#routes.total"),
    "wrong finding location",
  );
});

check("MUTATION invalid manifest — a duplicated route path fails", () => {
  // `buildManifest` itself refuses to build one, so the duplicate is injected
  // after the fact — which is exactly what a hand-edited manifest looks like.
  const root = build();
  const manifest = clone(syntheticManifest());
  const inventory = [
    ...manifest.routes.inventory,
    manifest.routes.inventory[0]!,
  ];
  write(
    root,
    MANIFEST_FILE,
    serializeManifest({
      ...manifest,
      routes: { ...manifest.routes, total: inventory.length, inventory },
    }),
  );
  const result = auditPreview(root);
  assert(!result.ok, "the audit passed a manifest claiming one path twice");
  assert(
    detailsOf(errorsIn(result.findings)).includes("more than one route"),
    "wrong finding",
  );
});

check(
  "MUTATION broken metadata — a placeholder source with a real timestamp fails",
  () => {
    const root = build((manifest) => ({
      ...manifest,
      build: { ...manifest.build, timestamp: "2026-08-21T10:00:00Z" },
    }));
    const result = auditPreview(root);
    assert(!result.ok, "the audit passed metadata that contradicts itself");
    assert(
      detailsOf(errorsIn(result.findings)).includes(
        'timestampSource is "placeholder" but the timestamp is',
      ),
      "wrong finding",
    );
  },
);

check("MUTATION broken metadata — an unknown environment fails", () => {
  // `preview` and `production` are the two the launch switch produces;
  // anything else describes a deployment no build made.
  const root = build((manifest) => ({
    ...manifest,
    build: { ...manifest.build, environment: "staging" },
  }));
  const result = auditPreview(root);
  assert(!result.ok, "the audit accepted an unknown environment");
  assert(
    detailsOf(errorsIn(result.findings)).includes('"preview"'),
    "wrong finding",
  );
});

check(
  "MUTATION broken metadata — a configured adapter or provider fails",
  () => {
    // The kit chooses no host. A manifest naming one is describing a build this
    // repository did not make.
    const root = build((manifest) => ({
      ...manifest,
      build: { ...manifest.build, adapter: "some-adapter" as unknown as null },
      hosting: {
        ...manifest.hosting,
        provider: "some-host" as unknown as null,
      },
    }));
    const result = auditPreview(root);
    assert(!result.ok, "the audit accepted a manifest naming a vendor");
    const locations = locationsOf(errorsIn(result.findings));
    assert(locations.includes("#build.adapter"), "the adapter was not checked");
    assert(
      locations.includes("#hosting.provider"),
      "the provider was not checked",
    );
  },
);

check("MUTATION broken metadata — a non-static output mode fails", () => {
  const root = build((manifest) => ({
    ...manifest,
    build: { ...manifest.build, output: "server" },
  }));
  assert(
    !auditPreview(root).ok,
    "the audit accepted a server-rendered manifest",
  );
});

check(
  "MUTATION broken metadata — collection counts that do not sum fail",
  () => {
    const root = build((manifest) => ({
      ...manifest,
      content: { ...manifest.content, entries: 99 },
    }));
    const result = auditPreview(root);
    assert(!result.ok, "a content total that does not sum");
    assert(
      detailsOf(errorsIn(result.findings)).includes("collections sum to"),
      "wrong finding",
    );
  },
);

check(
  "MUTATION broken metadata — more routed entries than entries fails",
  () => {
    const root = build((manifest) => {
      const copy = clone(manifest);
      const collections = copy.content.collections.map((collection) =>
        collection.name === "posts" ? { ...collection, routed: 9 } : collection,
      );
      return { ...copy, content: { ...copy.content, collections } };
    });
    const result = auditPreview(root);
    assert(!result.ok, "the audit accepted more pages than entries");
    assert(
      detailsOf(errorsIn(result.findings)).includes("cannot publish more"),
      "wrong finding",
    );
  },
);

check(
  "MUTATION script regression — an injected snippet fails every page it lands on",
  () => {
    const root = build();
    for (const file of ["index.html", "about/index.html"])
      write(
        root,
        file,
        '<html><body><script src="/a.js"></script></body></html>',
      );
    const result = auditPreview(root);
    assert(!result.ok, "the audit passed a build with injected script");
    equal(
      errorsIn(result.findings).filter((finding) => finding.check === "scripts")
        .length,
      2,
      "one finding per affected page",
    );
  },
);

check("each mutation is independent — a fresh build still passes", () => {
  const result = auditPreview(build());
  assert(
    result.ok,
    `state leaked between mutations: ${detailsOf(errorsIn(result.findings))}`,
  );
});

check("findings come back in a stable, grouped order", () => {
  const root = build();
  rmSync(path.join(root, ASSET));
  write(
    root,
    "index.html",
    '<html><body><a href="/nowhere">x</a><script>1</script></body></html>',
  );
  const result = auditPreview(root);
  const checks = result.findings.map((finding) => finding.check);
  equal(
    checks.join(","),
    sortFindings(result.findings)
      .map((finding) => finding.check)
      .join(","),
    "findings are not sorted",
  );
  assert(checks.indexOf("links") < checks.indexOf("scripts"), "check order");
});

// ---------------------------------------------------------------------------
console.log("\nThe real build, when one is present");

check("the real build passes the preview audit", () => {
  let result;
  try {
    result = auditPreview(path.resolve(process.cwd(), "apps/website/dist"));
  } catch {
    console.log("    (no build present — skipped)");
    return;
  }
  const errors = errorsIn(result.findings);
  equal(errors.length, 0, `errors: ${detailsOf(errors)}`);
});

// ---------------------------------------------------------------------------

for (const root of created) rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nPreview audit suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Preview audit suite OK\n");
