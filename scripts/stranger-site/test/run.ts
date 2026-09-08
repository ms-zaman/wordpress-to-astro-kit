// A site this kit has never seen.
//
// ## Why the fixture exists
//
// Everything else in `scripts/` is tested against the kit's own sample content,
// which was written by the same person who wrote the code — so it proves the
// code works on the shapes its author thought of. That is the exact failure
// this kit keeps finding in itself, one level up.
//
// So: a museum. Its vocabulary shares nothing with the kit's fixtures — an
// `exhibition` post type, a `gallery_room` taxonomy, a multisite uploads path
// (`/wp-content/uploads/sites/4/`), a category tree two deep, a term slug
// (`openings`) that exists in TWO taxonomies, filenames with encoded spaces,
// one image referenced three times in three spellings, a PDF, a missing file,
// a background image, an external asset on somebody else's WordPress install,
// a query string, and a data URI.
//
// Every one of those is a shape a real migration meets and none of them is in
// the kit's own content. If an abstraction is Easy.jobs-shaped, or
// kit-fixture-shaped, it fails here.
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  identifyAsset,
  outputFileFor,
  type AssetClass,
} from "../../../apps/website/src/media/asset-identity.ts";
import {
  assetConflicts,
  distinctAssets,
  findReferences,
  rewriteReferences,
} from "../../../apps/website/src/media/references.ts";
import { scanContentTree } from "../../media/scan.ts";
import {
  allTaxonomies,
  coreTaxonomies,
  termsOf,
} from "../../../apps/website/src/routing/taxonomies.ts";
import { termPath } from "../../../apps/website/src/routing/permalink.ts";
import {
  resolveSiteRoutes,
  type CustomEntryData,
  type EntryLike,
  type PageEntryData,
  type PostEntryData,
  type TaxonomyTermRow,
} from "../../../apps/website/src/routing/resolver.ts";
import { rowId } from "../../../apps/website/src/deployment/content-identity.ts";
import type {
  MediaProfile,
  Permalinks,
  PostTypeProfile,
  TaxonomyProfile,
} from "../../../migration.config.ts";

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

function threw(run: () => unknown): string {
  try {
    run();
  } catch (cause) {
    return (cause as Error).message;
  }
  return "";
}

// ---------------------------------------------------------------------------
// The stranger's configuration. Nothing here is a kit default.
// ---------------------------------------------------------------------------

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixture/content",
);

const MEDIA: MediaProfile = {
  // A multisite child. The kit's default is `/wp-content/uploads`, and a
  // hard-coded prefix would classify this whole library as unmigratable.
  uploadsPath: "/wp-content/uploads/sites/4",
  extraPaths: ["/wp-content/plugins/museum-downloads/files"],
  migrateFrom: ["old.museum.example"],
  localBase: "/collection-media",
};

const PERMALINKS: Permalinks = {
  post: "/news/%year%/%postname%/",
  page: "/%pagename%/",
  // `category_base` is an option, and this museum changed it.
  category: "/topics/%slug%/",
  tag: "/labels/%slug%/",
  author: "/curators/%nicename%/",
  postsIndex: "/news/",
  paginationSegment: "page",
  frontPage: null,
  postsPerPage: 10,
};

const EXHIBITION: PostTypeProfile = {
  name: "exhibition",
  collection: "exhibitions",
  restBase: "exhibition",
  permalink: "/exhibitions/%postname%/",
  published: true,
  archive: { kind: "archive", path: "/exhibitions/", title: "Exhibitions" },
  taxonomies: { attached: ["gallery_room"], archives: false },
};

const GALLERY_ROOM: TaxonomyProfile = {
  name: "gallery_room",
  label: "Gallery room",
  collection: "gallery-rooms",
  restBase: "gallery_room",
  appliesTo: ["exhibitions"],
  published: true,
  // The URL base is not the taxonomy name — measured behaviour on real installs.
  permalink: "/rooms/%term%/",
  urlHierarchy: true,
  hierarchical: true,
};

// ---------------------------------------------------------------------------
console.log("\nMedia — a library the kit has never seen");

const found = scanContentTree(fixture, MEDIA);
const identities = found.map((one) => one.identity);
const owned = distinctAssets(identities);

const classes = (): Map<AssetClass, number> => {
  const counts = new Map<AssetClass, number>();
  for (const one of identities)
    counts.set(
      one.identity === undefined ? one.classification : one.classification,
      (counts.get(one.classification) ?? 0) + 1,
    );
  return counts;
};

check("A MULTISITE UPLOADS PATH IS MIGRATED, NOT REFUSED", () => {
  const one = identifyAsset(
    "/wp-content/uploads/sites/4/2026/02/gallery.jpg",
    MEDIA,
  );
  equal(one.classification, "SUPPORTED", "classified");
  equal(one.key, "uploads:2026/02/gallery.jpg", "the key is site-relative");
  equal(one.local, "/collection-media/2026/02/gallery.jpg", "and the URL");
  // The kit's own default would have called this file unmigratable.
  equal(
    identifyAsset("/wp-content/uploads/sites/4/2026/02/gallery.jpg", {
      ...MEDIA,
      uploadsPath: "/wp-content/uploads",
    }).key,
    "uploads:sites/4/2026/02/gallery.jpg",
    "a different prefix gives a different, still-deterministic key",
  );
});

check("ONE FILE IN THREE SPELLINGS IS ONE OWNED ASSET", () => {
  // Root-relative, absolute, and protocol-relative — the three forms fifteen
  // years of a WordPress body accumulates. Protocol-relative was a MEASURED
  // gap: `rendering/media.ts` did not recognise `//host/...` at all.
  const key = "uploads:2026/02/east%20wing.jpg";
  const group = owned.get(key);
  assert(group !== undefined, `owned keys: ${[...owned.keys()].join(", ")}`);
  assert(group!.length >= 3, `three spellings, got ${group!.length}`);
  equal(
    new Set(group!.map((one) => one.local)).size,
    1,
    "and they agree on one output",
  );
});

check("AN ENCODED FILENAME IS NEVER DECODED", () => {
  // `%20` and a literal space are different bytes in a URL, and WordPress
  // serves the encoded form. Decoding here would produce a URL the source
  // never had — and re-encoding it could produce a third.
  const one = identifyAsset(
    "/wp-content/uploads/sites/4/2026/02/east%20wing.jpg",
    MEDIA,
  );
  assert(one.local!.includes("%20"), `kept: ${one.local}`);
  assert(!one.local!.includes(" "), "and not decoded");
  equal(
    outputFileFor(one, MEDIA),
    "collection-media/2026/02/east%20wing.jpg",
    "the output path matches the URL exactly",
  );
});

check("SOMEBODY ELSE'S WORDPRESS IS EXTERNAL, NOT OURS", () => {
  // The rule that makes this engine safe: the test is the HOST, never
  // "contains /wp-content/uploads/". Rewriting a partner's logo would point
  // this site at a file it never captured.
  const one = identifyAsset(
    "https://partner.example.org/wp-content/uploads/2025/09/their-logo.png",
    MEDIA,
  );
  equal(one.classification, "EXTERNAL", "classified");
  assert(one.local === undefined, "and no local path is invented");
});

check("A DATA URI AND A FRAGMENT ARE UNSUPPORTED, EXPLICITLY", () => {
  for (const [raw, expected] of [
    ["data:image/gif;base64,R0lGODlhAQABAAAAACw=", "UNSUPPORTED"],
    ["#section", "UNSUPPORTED"],
    ["mailto:curator@museum.example", "UNSUPPORTED"],
    ["images/relative.png", "UNSUPPORTED"],
  ] as const) {
    const one = identifyAsset(raw, MEDIA);
    equal(one.classification, expected, raw);
    assert(one.reason !== undefined, `${raw} says why`);
  }
});

check("A QUERY STRING SURVIVES, AND DOES NOT SPLIT THE ASSET", () => {
  const plain = identifyAsset(
    "/wp-content/uploads/sites/4/2026/02/banner.jpg",
    MEDIA,
  );
  const busted = identifyAsset(
    "/wp-content/uploads/sites/4/2026/02/banner.jpg?ver=3",
    MEDIA,
  );
  equal(busted.key, plain.key, "one file, whatever the query");
  equal(busted.query, "?ver=3", "and the query is kept");
});

check("A PDF IS AN ASSET; A LINK TO A PAGE IS NOT", () => {
  const pdf = found.filter((one) =>
    one.identity.source.endsWith("season-guide.pdf"),
  );
  equal(pdf.length, 1, "the download is found");
  equal(pdf[0]!.identity.classification, "SUPPORTED", "and migrated");
  assert(
    !found.some((one) => one.identity.source === "/about/"),
    "and an ordinary internal link is not reported as media",
  );
});

check("SRCSET, LAZY ATTRIBUTES AND CSS url() ARE ALL FOUND", () => {
  const kinds = new Set(found.map((one) => one.field));
  for (const kind of ["src", "srcset", "lazy", "css", "href"])
    assert(
      kinds.has(kind),
      `${kind} was scanned — found ${[...kinds].join(", ")}`,
    );
  // Every srcset candidate, not just the first.
  const candidates = found.filter(
    (one) => one.field === "srcset" && one.identity.key !== undefined,
  );
  assert(candidates.length >= 2, `candidates: ${candidates.length}`);
});

check("REWRITING MOVES ONLY WHAT IT OWNS", () => {
  const document = [
    '<img src="/wp-content/uploads/sites/4/2026/02/gallery.jpg" />',
    '<img srcset="/wp-content/uploads/sites/4/2026/02/gallery-480x320.jpg 480w, /wp-content/uploads/sites/4/2026/02/gallery.jpg 1200w" />',
    '<img src="https://partner.example.org/wp-content/uploads/2025/09/their-logo.png" />',
    '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />',
    "<div style=\"background-image: url('/wp-content/uploads/sites/4/2026/02/banner.jpg?ver=3')\"></div>",
    '<a href="/about/">About</a>',
    "![A caption](/wp-content/uploads/sites/4/2026/02/gallery.jpg)",
  ].join("\n");
  const { html } = rewriteReferences(document, MEDIA);

  assert(
    !html.includes("/wp-content/uploads/sites/4/"),
    `no stale uploads path remains:\n${html}`,
  );
  assert(
    html.includes("https://partner.example.org/wp-content/uploads/"),
    "the partner's URL is untouched",
  );
  assert(html.includes("data:image/gif"), "the data URI is untouched");
  assert(html.includes('href="/about/"'), "the page link is untouched");
  assert(
    html.includes("/collection-media/2026/02/banner.jpg?ver=3"),
    `the query rode along: ${html}`,
  );
  assert(
    html.includes("/collection-media/2026/02/gallery-480x320.jpg 480w"),
    "srcset descriptors are preserved",
  );
  assert(
    html.includes("![A caption](/collection-media/2026/02/gallery.jpg)"),
    "and Markdown is rewritten",
  );
});

check("TWO HOSTS CLAIMING ONE OUTPUT IS A CONFLICT, NOT A CHOICE", () => {
  const both = [
    identifyAsset(
      "https://old.museum.example/wp-content/uploads/sites/4/2026/02/x.jpg",
      MEDIA,
    ),
    identifyAsset(
      "https://cdn.museum.example/wp-content/uploads/sites/4/2026/02/x.jpg",
      { ...MEDIA, migrateFrom: [...MEDIA.migrateFrom, "cdn.museum.example"] },
    ),
  ];
  const conflicts = assetConflicts(both);
  equal(conflicts.length, 1, "reported");
  equal(conflicts[0]!.sources.length, 2, "naming both hosts");
  // And the ordinary case — one host, two spellings — is not a conflict.
  equal(
    assetConflicts(
      findReferences(
        '<img src="/wp-content/uploads/sites/4/a.jpg"><img src="https://old.museum.example/wp-content/uploads/sites/4/a.jpg">',
      ).map((one) => identifyAsset(one.url, MEDIA)),
    ).length,
    0,
    "one host, two spellings, one asset",
  );
});

check("A CONFIGURED EXTRA PATH IS CLASSIFIED AS CONFIGURED", () => {
  const one = identifyAsset(
    "/wp-content/plugins/museum-downloads/files/map.pdf",
    MEDIA,
  );
  equal(one.classification, "CONFIGURED", "somebody decided this");
  equal(one.local, "/collection-media/map.pdf", "and it moves");
  // Without the profile entry it is not migrated at all.
  equal(
    identifyAsset("/wp-content/plugins/museum-downloads/files/map.pdf", {
      ...MEDIA,
      extraPaths: [],
    }).classification,
    "UNSUPPORTED",
    "and nothing is migrated by accident",
  );
});

check("A PATH THAT ESCAPES THE UPLOADS DIRECTORY IS REFUSED", () => {
  const one = identifyAsset(
    "/wp-content/uploads/sites/4/../../../wp-config.php",
    MEDIA,
  );
  equal(one.classification, "UNSUPPORTED", "refused");
  assert(one.reason!.includes("escapes"), `said why: ${one.reason}`);
});

check("THE MISSING FILE IS NAMED, NOT ROUNDED DOWN", () => {
  // `absent.jpg` is referenced and will never be captured. It must appear as a
  // migrated asset so that `media verify` can fail on it — an asset the
  // discovery stage drops is one no downstream gate can miss.
  const absent = found.filter((one) =>
    one.identity.source.includes("absent.jpg"),
  );
  equal(absent.length, 1, "discovered");
  equal(absent[0]!.identity.classification, "SUPPORTED", "and claimed");
});

check("a custom post type's body is scanned like any other", () => {
  // Measured gap in the previous media manifest: it iterated posts and pages
  // and never `allCustom`, so a CPT's images were invisible to it.
  const fromExhibition = found.filter((one) =>
    one.where.startsWith("exhibitions/"),
  );
  assert(fromExhibition.length > 0, "the exhibition's image was found");
});

// ---------------------------------------------------------------------------
console.log("\nTaxonomy — a vocabulary the kit has never seen");

type Post = EntryLike<PostEntryData>;
type Page = EntryLike<PageEntryData>;
type Custom = EntryLike<CustomEntryData>;

const wp = (id: number) => ({
  system: "wordpress",
  sourceId: String(id),
  capturedAt: "2026-02-01",
});

const term = (slug: string, id: number, parent?: string): TaxonomyTermRow => ({
  slug,
  ...(parent === undefined ? {} : { parent }),
  name: { en: slug },
  source: wp(id),
});

const strangerSite = (overrides: { categories?: TaxonomyTermRow[] } = {}) =>
  resolveSiteRoutes<Post, Page, Custom>({
    posts: [
      {
        data: {
          slug: "spring-opening",
          title: "The spring opening",
          locale: "en",
          publishedAt: "2026-02-01",
          updatedAt: "2026-02-01",
          author: "a-curator",
          categories: ["announcements", "openings"],
          tags: ["free-entry"],
          source: wp(501),
        },
      },
    ],
    pages: [],
    authors: [
      {
        slug: "a-curator",
        name: "A Curator",
        nicename: "a-curator",
        source: wp(2),
      },
    ],
    categories: overrides.categories ?? [
      term("announcements", 11),
      term("openings", 12, "announcements"),
      term("closures", 13, "announcements"),
    ],
    tags: [term("free-entry", 40)],
    locale: "en",
    postTypes: [EXHIBITION],
    taxonomies: [GALLERY_ROOM],
    custom: {
      exhibitions: [
        {
          data: {
            slug: "printmaking",
            title: "Printmaking now",
            locale: "en",
            updatedAt: "2026-02-01",
            publishedAt: "2026-02-01",
            terms: { gallery_room: ["print-room"] },
            source: wp(900),
          },
        },
      ],
    },
    terms: {
      "gallery-rooms": [
        term("east-wing", 70),
        term("print-room", 71, "east-wing"),
        term("openings", 72),
      ],
    },
  });

const table = strangerSite();
const paths = table.routes.map((route) => route.path).sort();

check("a moved category_base moves core URLs and nothing else", () => {
  const [category] = coreTaxonomies(PERMALINKS);
  equal(
    termPath(category!, "openings", ["announcements"]),
    "/topics/announcements/openings/",
    "the museum's own base",
  );
});

check("A NESTED CORE CATEGORY AND A NESTED CUSTOM TERM BOTH NEST", () => {
  assert(
    paths.includes("/category/announcements/openings/"),
    `core: ${paths.join(", ")}`,
  );
  assert(
    paths.includes("/rooms/east-wing/print-room/"),
    `custom: ${paths.join(", ")}`,
  );
});

check("ONE SLUG IN TWO TAXONOMIES STAYS TWO ENTITIES", () => {
  // `openings` is a category AND a gallery room, with different WordPress term
  // ids. Their identities, their URLs and their archives are all separate.
  assert(paths.includes("/category/announcements/openings/"), "the category");
  assert(paths.includes("/rooms/openings/"), "the room");
  assert(
    rowId("categories", "openings") !== rowId("gallery-rooms", "openings"),
    "two identities",
  );
});

check("an exhibition is filed by the map, a post by its fields", () => {
  const [category] = coreTaxonomies();
  equal(
    termsOf(category!, { categories: ["announcements"] }).join(","),
    "announcements",
    "the post's field",
  );
  equal(
    termsOf(allTaxonomies([GALLERY_ROOM])[2]!, {
      terms: { gallery_room: ["print-room"] },
    }).join(","),
    "print-room",
    "the exhibition's map",
  );
});

check("AN EXHIBITION FILED UNDER AN UNKNOWN ROOM FAILS LOUDLY", () => {
  const message = threw(() =>
    resolveSiteRoutes<Post, Page, Custom>({
      ...strangerSite(),
      posts: [],
      pages: [],
      authors: [],
      categories: [],
      tags: [],
      locale: "en",
      postTypes: [EXHIBITION],
      taxonomies: [GALLERY_ROOM],
      custom: {
        exhibitions: [
          {
            data: {
              slug: "printmaking",
              title: "Printmaking now",
              locale: "en",
              updatedAt: "2026-02-01",
              terms: { gallery_room: ["basement"] },
              source: wp(900),
            },
          },
        ],
      },
      terms: { "gallery-rooms": [term("east-wing", 70)] },
    }),
  );
  assert(message.includes('"basement"'), `named: ${message}`);
});

check("the stranger's category hierarchy is validated like the kit's", () => {
  const message = threw(() =>
    strangerSite({
      categories: [term("openings", 12, "announcements")],
    }),
  );
  assert(message.includes('names parent "announcements"'), `named: ${message}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nStranger-site suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Stranger-site suite OK\n");
