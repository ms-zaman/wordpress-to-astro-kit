// The media engine — and the mutations that must not produce a green build.
//
// Every stage of the pipeline is exercised over a temporary content tree, so
// each failure mode is a real file on a real disk rather than a mocked one:
//
//     DISCOVER   scanContentTree over a tree written for the test
//     IDENTIFY   six classifications, none of them "probably"
//     NORMALIZE  one file, however many spellings
//     OWN        distinctAssets / assetConflicts
//     REWRITE    rewriteReferences, by value
//     VERIFY     intended vs captured
//
// The rule the whole suite is about: **a gate cannot detect an asset it was
// never shown.** Half of these mutations are upstream omissions — a reference
// the scanner never sees, a file nobody captured — because those are the ones
// a downstream check cannot recover.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  identifyAsset,
  isMigrated,
  outputFileFor,
  splitReference,
  hostKey,
  type AssetClass,
} from "../../../apps/website/src/media/asset-identity.ts";
import { mediaRef } from "../../../apps/website/src/content-model/shared.ts";
import { migration } from "../../../migration.config.ts";
import {
  assetConflicts,
  distinctAssets,
  findReferences,
  rewriteReferences,
} from "../../../apps/website/src/media/references.ts";
import { capturedFiles, scanContentTree } from "../scan.ts";
import { prepareBody } from "../../../apps/website/src/rendering/body.ts";
import type { MediaProfile } from "../../../migration.config.ts";

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

const PROFILE: MediaProfile = {
  uploadsPath: "/wp-content/uploads",
  extraPaths: [],
  migrateFrom: ["source.example"],
  localBase: "/media",
};

function withTree<T>(
  files: Record<string, string>,
  run: (root: string) => T,
): T {
  const root = mkdtempSync(path.join(tmpdir(), "wpk-media-"));
  try {
    for (const [relative, body] of Object.entries(files)) {
      const file = path.join(root, relative);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, body);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const entry = (body: string): string =>
  [
    "---",
    "slug: one",
    "title: One",
    "locale: en",
    "cluster: posts/one",
    "updatedAt: 2026-01-10",
    "publishedAt: 2026-01-10",
    "author: jane",
    "categories:",
    "  - news",
    "source:",
    "  system: authored",
    "---",
    "",
    body,
    "",
  ].join("\n");

// ---------------------------------------------------------------------------
console.log("\nIdentity — four names, and none of them is the raw URL");

check("the normalized key ignores host, scheme and www", () => {
  const forms = [
    "/wp-content/uploads/2026/01/a.png",
    "https://source.example/wp-content/uploads/2026/01/a.png",
    "http://www.source.example/wp-content/uploads/2026/01/a.png",
    "//source.example/wp-content/uploads/2026/01/a.png",
  ];
  const keys = new Set(forms.map((form) => identifyAsset(form, PROFILE).key));
  equal(keys.size, 1, `one key, got ${[...keys].join(", ")}`);
  equal([...keys][0], "uploads:2026/01/a.png", "and it names the file");
});

check(
  "the output path preserves the uploads structure, and hashes nothing",
  () => {
    const january = identifyAsset("/wp-content/uploads/2026/01/a.png", PROFILE);
    const february = identifyAsset(
      "/wp-content/uploads/2026/02/a.png",
      PROFILE,
    );
    equal(outputFileFor(january, PROFILE), "media/2026/01/a.png", "january");
    equal(outputFileFor(february, PROFILE), "media/2026/02/a.png", "february");
    // Two files with one name in two months stay two files. Flattening would
    // collide them and hashing would only rename the collision.
    assert(
      outputFileFor(january, PROFILE) !== outputFileFor(february, PROFILE),
      "same filename, different months, different outputs",
    );
  },
);

check("splitReference never decodes and never reorders", () => {
  const parts = splitReference("/a/b%20c.png?ver=2&x=1#frag");
  equal(parts.path, "/a/b%20c.png", "path");
  equal(parts.query, "?ver=2&x=1", "query");
  equal(parts.fragment, "#frag", "fragment");
  equal(hostKey("WWW.Source.Example"), "source.example", "host key");
});

// ---------------------------------------------------------------------------
console.log("\nClassification — six answers, no warnings");

check("every class is reachable, and each says why when it must", () => {
  const cases: [string, string][] = [
    ["/wp-content/uploads/2026/01/a.png", "SUPPORTED"],
    ["https://source.example/wp-content/uploads/2026/01/a.png", "SUPPORTED"],
    ["https://other.example/wp-content/uploads/2026/01/a.png", "EXTERNAL"],
    ["https://source.example/elsewhere/a.png", "EXTERNAL"],
    ["data:image/gif;base64,AAA", "UNSUPPORTED"],
    ["/not-uploads/a.png", "UNSUPPORTED"],
    ["relative/a.png", "UNSUPPORTED"],
    ["/wp-content/uploads/2026/01/", "UNSUPPORTED"],
  ];
  for (const [raw, expected] of cases)
    equal(identifyAsset(raw, PROFILE).classification, expected, raw);

  const configured = identifyAsset("/downloads/a.pdf", {
    ...PROFILE,
    extraPaths: ["/downloads"],
  });
  equal(configured.classification, "CONFIGURED", "an extra path");
});

check("A HOST IS THE TEST, NOT THE PATH", () => {
  // The rule that keeps this engine safe. Both URLs contain the uploads path;
  // only one of them is ours, and rewriting the other would point this site at
  // a file nobody captured.
  equal(
    identifyAsset(
      "https://other.example/wp-content/uploads/2026/01/a.png",
      PROFILE,
    ).classification,
    "EXTERNAL",
    "somebody else's WordPress",
  );
  equal(
    identifyAsset("/wp-content/uploads/2026/01/a.png", {
      ...PROFILE,
      migrateFrom: [],
    }).classification,
    "SUPPORTED",
    "a root-relative path is always the site's own",
  );
});

// ---------------------------------------------------------------------------
console.log("\nThe mutations");

check("M1: A REFERENCE WITH NO CAPTURED FILE IS MISSING, BY NAME", () => {
  withTree(
    {
      "posts/one.md": entry(
        '<img src="/wp-content/uploads/2026/01/absent.png" alt="x" />',
      ),
    },
    (root) => {
      const found = scanContentTree(root, PROFILE);
      equal(found.length, 1, "discovered");
      const file = outputFileFor(found[0]!.identity, PROFILE)!;
      const captured = capturedFiles(root, PROFILE.localBase);
      assert(!captured.has(file), "and nothing captured it");
    },
  );
});

check("M2: A CAPTURED FILE NOTHING REFERENCES IS UNCLAIMED", () => {
  withTree(
    {
      "posts/one.md": entry("<p>No media at all.</p>"),
      "media/2026/01/orphan.png": "x",
    },
    (root) => {
      const found = scanContentTree(root, PROFILE);
      const claimed = new Set(
        found
          .filter((one) => isMigrated(one.identity))
          .map((one) => outputFileFor(one.identity, PROFILE)),
      );
      const captured = capturedFiles(root, PROFILE.localBase);
      const unclaimed = [...captured].filter((file) => !claimed.has(file));
      equal(unclaimed.length, 1, "reported");
      equal(unclaimed[0], "media/2026/01/orphan.png", "and named");
    },
  );
});

check("M3: TWO HOSTS, ONE OUTPUT — A CONFLICT, NEVER A CHOICE", () => {
  const both = ["source.example", "mirror.example"].map((host) =>
    identifyAsset(`https://${host}/wp-content/uploads/2026/01/a.png`, {
      ...PROFILE,
      migrateFrom: ["source.example", "mirror.example"],
    }),
  );
  const conflicts = assetConflicts(both);
  equal(conflicts.length, 1, "reported");
  equal(conflicts[0]!.key, "uploads:2026/01/a.png", "named by key");
});

check("M4: ONE FILE REFERENCED MANY TIMES IS NOT A CONFLICT", () => {
  const many = [
    "/wp-content/uploads/2026/01/a.png",
    "https://source.example/wp-content/uploads/2026/01/a.png",
    "//www.source.example/wp-content/uploads/2026/01/a.png",
    "/wp-content/uploads/2026/01/a.png?ver=9",
  ].map((raw) => identifyAsset(raw, PROFILE));
  equal(assetConflicts(many).length, 0, "no conflict");
  equal(distinctAssets(many).size, 1, "and one owned asset");
});

check("M5: A STALE REFERENCE CANNOT SURVIVE THE REWRITE", () => {
  const { html } = rewriteReferences(
    '<img src="/wp-content/uploads/2026/01/a.png"><a href="/wp-content/uploads/2026/01/b.pdf">b</a>',
    PROFILE,
  );
  assert(!html.includes("/wp-content/uploads/"), `rewritten: ${html}`);
  assert(html.includes("/media/2026/01/a.png"), "image");
  assert(html.includes("/media/2026/01/b.pdf"), "download");
});

check(
  "M6: REMOVING THE PROFILE'S HOST STOPS MIGRATION, LOUDLY NOT SILENTLY",
  () => {
    // A profile change must not quietly leave the site pointing at a host it no
    // longer migrates from. With no host, an ABSOLUTE reference is EXTERNAL and
    // is left alone — visible in the classification, not rewritten to nothing.
    const stripped = { ...PROFILE, migrateFrom: [] };
    const one = identifyAsset(
      "https://source.example/wp-content/uploads/2026/01/a.png",
      stripped,
    );
    equal(one.classification, "EXTERNAL", "classified, not dropped");
    const { html } = rewriteReferences(
      '<img src="https://source.example/wp-content/uploads/2026/01/a.png">',
      stripped,
    );
    assert(html.includes("source.example"), "and untouched in the output");
  },
);

check("M7: A MALFORMED URL IS REFUSED, NOT GUESSED AT", () => {
  for (const raw of ["https://", "//", "http://[bad"]) {
    const one = identifyAsset(raw, PROFILE);
    assert(
      one.classification === "UNSUPPORTED" || one.classification === "EXTERNAL",
      `${raw}: ${one.classification}`,
    );
    assert(one.local === undefined, `${raw} invents no local path`);
  }
});

check("M8: A PATH ESCAPING THE OUTPUT DIRECTORY IS REFUSED", () => {
  const one = identifyAsset("/wp-content/uploads/../../../etc/passwd", PROFILE);
  equal(one.classification, "UNSUPPORTED", "refused");
  assert(one.local === undefined, "and writes nowhere");
});

check("M9: AN UNSCANNED FIELD IS AN ASSET NOTHING CAN REPORT", () => {
  // The upstream-omission mutation, and the reason the scanner walks JSON for
  // any `url` rather than reading a field list. A list goes stale the moment a
  // schema gains a field, and the asset then reaches no gate at all.
  withTree(
    {
      "posts/one.md": entry("<p>None in the body.</p>"),
      "authors.json": JSON.stringify([
        {
          slug: "jane",
          name: "Jane",
          avatar: { url: "/wp-content/uploads/2026/01/avatar.png" },
        },
      ]),
      "seo/overrides.json": JSON.stringify([
        {
          path: "/",
          locale: "en",
          ogImage: { url: "/wp-content/uploads/2026/01/og.png" },
        },
      ]),
    },
    (root) => {
      const found = scanContentTree(root, PROFILE);
      const keys = found.map((one) => one.identity.key).sort();
      assert(
        keys.includes("uploads:2026/01/avatar.png"),
        `avatar found: ${keys.join(", ")}`,
      );
      assert(keys.includes("uploads:2026/01/og.png"), "and the og image");
    },
  );
});

check("M10: FRONT-MATTER MEDIA IS SCANNED, INCLUDING VARIANTS", () => {
  withTree(
    {
      "posts/one.md": [
        "---",
        "slug: one",
        "title: One",
        "locale: en",
        "cluster: posts/one",
        "updatedAt: 2026-01-10",
        "publishedAt: 2026-01-10",
        "author: jane",
        "categories:",
        "  - news",
        "featuredImage:",
        '  url: "/wp-content/uploads/2026/01/hero.png"',
        "  variants:",
        '    - url: "/wp-content/uploads/2026/01/hero-300x200.png"',
        "      width: 300",
        "      height: 200",
        "source:",
        "  system: authored",
        "---",
        "",
        "<p>Body.</p>",
        "",
      ].join("\n"),
    },
    (root) => {
      const keys = scanContentTree(root, PROFILE)
        .map((one) => one.identity.key)
        .filter((key) => key !== undefined);
      assert(
        keys.includes("uploads:2026/01/hero.png"),
        `hero: ${keys.join(", ")}`,
      );
      assert(
        keys.includes("uploads:2026/01/hero-300x200.png"),
        "and its rendition",
      );
    },
  );
});

check("M10b: A STYLE ATTRIBUTE'S QUOTES ARRIVE AS HTML ENTITIES", () => {
  // A `style` attribute is HTML before it is CSS, so `esc_attr()` escapes the
  // quotes inside it. Measured on ja.wordpress.org: six absolute image URLs
  // were classified "a document-relative reference" because the value the
  // engine read began with `&apos;`.
  const forms = [
    ["&apos;", "&apos;"],
    ["&quot;", "&quot;"],
    ["&#39;", "&#39;"],
    ["&#034;", "&#034;"],
    ["'", "'"],
    ['"', '"'],
    ["", ""],
  ] as const;
  for (const [open, close] of forms) {
    const document = `<div style="background-image:url(${open}/wp-content/uploads/a.png${close})"></div>`;
    const references = findReferences(document);
    equal(references.length, 1, `one reference for ${open || "no quote"}`);
    equal(
      references[0]!.url,
      "/wp-content/uploads/a.png",
      `the URL alone for ${open || "no quote"}`,
    );
    equal(
      rewriteReferences(document, PROFILE).html,
      `<div style="background-image:url(${open}/media/a.png${close})"></div>`,
      `rewritten, keeping the quote spelling for ${open || "no quote"}`,
    );
  }
});

check("M11: EVERY SRCSET CANDIDATE IS OWNED, NOT JUST THE FIRST", () => {
  const references = findReferences(
    '<img srcset="/wp-content/uploads/a.png 480w, /wp-content/uploads/b.png 1200w">',
  );
  equal(references.length, 2, "both candidates");
  const { html } = rewriteReferences(
    '<img srcset="/wp-content/uploads/a.png 480w, /wp-content/uploads/b.png 1200w">',
    PROFILE,
  );
  equal(
    html,
    '<img srcset="/media/a.png 480w, /media/b.png 1200w">',
    "rewritten with descriptors intact",
  );
});

check("M12: A QUERY AND A FRAGMENT SURVIVE THE REWRITE", () => {
  const { html } = rewriteReferences(
    '<a href="/wp-content/uploads/a.pdf?download=1#page=3">a</a>',
    PROFILE,
  );
  assert(html.includes("/media/a.pdf?download=1#page=3"), `preserved: ${html}`);
});

check("M13: THE LIVE RENDER PATH REWRITES, AND LEAVES THE REST", () => {
  // `prepareBody` is what a page actually calls. It reads the kit's own
  // configured profile, so this asserts the wiring rather than the model.
  const html = prepareBody(
    '<img src="/wp-content/uploads/2026/01/gallery.svg">' +
      '<img src="https://partner.example.org/wp-content/uploads/x.png">',
  );
  assert(html.includes("/media/2026/01/gallery.svg"), `migrated: ${html}`);
  assert(html.includes("partner.example.org"), "and the partner's stayed");
});

// ---------------------------------------------------------------------------
console.log("\nOne authority — mediaRef and the engine cannot disagree");

/**
 * Every reference form that has ever been argued about, and what each layer
 * must say about it.
 *
 * `mediaRef` used to carry its OWN uploads regex. Measured across these
 * eighteen forms before the cleanup, the two authorities disagreed on eleven,
 * and three of those were live defects: `/media/…` — the engine's own output
 * form — was rejected by the schema, while a `..` path escape and a bare
 * directory were accepted by it.
 *
 * `accepts` is what the SCHEMA must do. It is not simply "is it migrated":
 * an external https URL is a legal media reference and is not migrated, and an
 * external URL inside the uploads namespace is refused for a reason that is
 * about content hygiene rather than about the namespace — see shared.ts.
 */
const AGREEMENT: {
  url: string;
  classification: AssetClass;
  accepts: boolean;
  why: string;
}[] = [
  {
    url: "/wp-content/uploads/2026/01/a.png",
    classification: "SUPPORTED",
    accepts: true,
    why: "relative uploads",
  },
  {
    url: "https://source.example/wp-content/uploads/2026/01/a.png",
    classification: "SUPPORTED",
    accepts: true,
    why: "absolute on a migratable host",
  },
  {
    url: "//source.example/wp-content/uploads/2026/01/a.png",
    classification: "SUPPORTED",
    accepts: true,
    why: "protocol-relative",
  },
  {
    url: "http://www.source.example/wp-content/uploads/2026/01/a.png",
    classification: "SUPPORTED",
    accepts: true,
    why: "http and www",
  },
  {
    url: "/wp-content/uploads/2026/01/a.png?ver=2",
    classification: "SUPPORTED",
    accepts: true,
    why: "query string",
  },
  {
    url: "/wp-content/uploads/2026/01/a.png#frag",
    classification: "SUPPORTED",
    accepts: true,
    why: "fragment",
  },
  {
    url: "/wp-content/uploads/2026/01/east%20wing.jpg",
    classification: "SUPPORTED",
    accepts: true,
    why: "encoded filename",
  },
  {
    url: "/media/2026/01/a.png",
    classification: "SUPPORTED",
    accepts: true,
    why: "the local output namespace",
  },
  {
    url: "/downloads/a.pdf",
    classification: "CONFIGURED",
    accepts: true,
    why: "a configured extra path",
  },
  {
    url: "https://images.example.net/photo.jpg",
    classification: "EXTERNAL",
    accepts: true,
    why: "an ordinary remote image",
  },
  {
    url: "http://images.example.net/photo.jpg",
    classification: "EXTERNAL",
    accepts: false,
    why: "external must be https",
  },
  {
    url: "https://other.example/wp-content/uploads/2026/01/a.png",
    classification: "EXTERNAL",
    accepts: false,
    why: "somebody else's uploads namespace",
  },
  {
    url: "data:image/gif;base64,AAA",
    classification: "UNSUPPORTED",
    accepts: false,
    why: "data URI",
  },
  {
    url: "mailto:a@b.example",
    classification: "UNSUPPORTED",
    accepts: false,
    why: "mailto",
  },
  {
    url: "images/relative.png",
    classification: "UNSUPPORTED",
    accepts: false,
    why: "document-relative",
  },
  {
    url: "/wp-content/uploads/../../etc/passwd",
    classification: "UNSUPPORTED",
    accepts: false,
    why: "path escape",
  },
  {
    url: "/wp-content/uploads/2026/01/",
    classification: "UNSUPPORTED",
    accepts: false,
    why: "a directory",
  },
  {
    url: "/not-a-namespace/a.png",
    classification: "UNSUPPORTED",
    accepts: false,
    why: "outside every namespace",
  },
];

/** The profile the SCHEMA reads. The table above is written against it. */
const SCHEMA_PROFILE: MediaProfile = {
  uploadsPath: "/wp-content/uploads",
  extraPaths: ["/downloads"],
  migrateFrom: ["source.example"],
  localBase: "/media",
};

check("THE CLASSIFIER AGREES WITH THE TABLE ON EVERY FORM", () => {
  for (const row of AGREEMENT)
    equal(
      identifyAsset(row.url, SCHEMA_PROFILE).classification,
      row.classification,
      `${row.why}: ${row.url}`,
    );
});

check("MEDIAREF AGREES WITH THE CLASSIFIER ON EVERY FORM", () => {
  // The invariant this cleanup exists for. `mediaRefAccepts` reimplements the
  // schema's decision from the classifier — which is exactly what the schema
  // itself now does, so a divergence in either direction fails here.
  for (const row of AGREEMENT) {
    const identity = identifyAsset(row.url, SCHEMA_PROFILE);
    const migrated =
      identity.classification === "SUPPORTED" ||
      identity.classification === "CONFIGURED";
    const uploads = `${SCHEMA_PROFILE.uploadsPath}/`;
    const accepted = migrated
      ? true
      : identity.classification === "EXTERNAL"
        ? /^https:\/\//i.test(row.url) && !row.url.includes(uploads)
        : false;
    equal(accepted, row.accepts, `${row.why}: ${row.url}`);
  }
});

check("M14: A MIGRATED ASSET THE SCHEMA REFUSES IS A CONTRADICTION", () => {
  // Direction one. Anything the engine will copy must be storable in a
  // `featuredImage`, or a migration cannot record its own output.
  for (const row of AGREEMENT) {
    const identity = identifyAsset(row.url, migration.media);
    if (
      identity.classification !== "SUPPORTED" &&
      identity.classification !== "CONFIGURED"
    )
      continue;
    const parsed = mediaRef.safeParse({ url: row.url });
    assert(
      parsed.success,
      `${row.url} is ${identity.classification} and the schema refused it: ` +
        `${parsed.success ? "" : parsed.error.issues[0]?.message}`,
    );
  }
});

check("M15: AN ASSET THE SCHEMA ACCEPTS IS NEVER UNSUPPORTED", () => {
  // Direction two. The schema must not admit a URL the engine cannot act on —
  // that is how `/wp-content/uploads/../../etc/passwd` used to validate.
  for (const row of AGREEMENT) {
    if (!mediaRef.safeParse({ url: row.url }).success) continue;
    const identity = identifyAsset(row.url, migration.media);
    assert(
      identity.classification !== "UNSUPPORTED",
      `${row.url} validated but is ${identity.classification}: ${identity.reason}`,
    );
  }
});

check("a variant url is judged by the same authority as its parent", () => {
  // The rendition list used to accept any non-empty string, so a library could
  // record a `srcset` candidate the engine would never copy.
  const bad = mediaRef.safeParse({
    url: "/wp-content/uploads/2026/01/a.png",
    variants: [
      { url: "/wp-content/uploads/../../etc/passwd", width: 1, height: 1 },
    ],
  });
  assert(!bad.success, "a variant escaping the namespace is refused");
  const good = mediaRef.safeParse({
    url: "/wp-content/uploads/2026/01/a.png",
    variants: [
      {
        url: "/wp-content/uploads/2026/01/a-300x200.png",
        width: 300,
        height: 200,
      },
    ],
  });
  assert(good.success, "and an ordinary rendition is not");
});

check("THE SCHEMA READS THE PROFILE, NOT A HARD-CODED PREFIX", () => {
  // The hard-coded `/wp-content/uploads/` made a multisite library — the most
  // ordinary non-default there is — unrepresentable. The classifier reads
  // `media.uploadsPath`, so the schema does too.
  const multisite = "/wp-content/uploads/sites/4/2026/01/a.png";
  equal(
    identifyAsset(multisite, {
      ...SCHEMA_PROFILE,
      uploadsPath: "/wp-content/uploads/sites/4",
    }).key,
    "uploads:2026/01/a.png",
    "the configured prefix is stripped",
  );
});

// ---------------------------------------------------------------------------
console.log("\nThe kit's own tree");

check(
  "scanning the repository finds its media and classifies all of it",
  () => {
    const root = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../../content",
    );
    const found = scanContentTree(root, {
      uploadsPath: "/wp-content/uploads",
      extraPaths: [],
      migrateFrom: ["old.example.com"],
      localBase: "/media",
    });
    assert(found.length > 0, "the tree references media");
    for (const one of found)
      assert(
        one.identity.classification !== "MISSING" &&
          one.identity.classification !== "CONFLICT",
        `${one.identity.source}: ${one.identity.classification}`,
      );
    const external = found.filter(
      (one) => one.identity.classification === "EXTERNAL",
    );
    assert(external.length > 0, "including one deliberately external asset");
  },
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nMedia suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Media suite OK\n");
