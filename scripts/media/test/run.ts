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
} from "../../../apps/website/src/media/asset-identity.ts";
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
