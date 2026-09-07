// custom post types — the suite.
//
// Everything here is pure: profile validation, permalink expansion, the
// resolver, identity. The three fixture types in `migration.config.ts` prove
// the same rules against the real build; these prove the FAILURES, which a
// build cannot demonstrate because a build that fails produces nothing to
// inspect.
//
// The profiles below are synthetic and stay synthetic. `product`, `portfolio`
// and `event` are the three most ordinary shapes a WordPress install has, and
// naming them here is naming a shape, not a site.
import process from "node:process";

import {
  CUSTOM_TYPE_TOKENS,
  customTypeArchivePath,
  customTypePath,
  postTypeProblems,
  postTypeProfileProblems,
} from "../../../apps/website/src/routing/permalink.ts";
import {
  resolveSiteRoutes,
  type CustomEntryData,
  type EntryLike,
  type PageEntryData,
  type PostEntryData,
} from "../../../apps/website/src/routing/resolver.ts";
import {
  identityOf,
  customArchiveIdentity,
} from "../../../apps/website/src/routing/route-identity.ts";
import {
  entryId,
  kindOf,
  localeOf,
  isStructuralId,
} from "../../../apps/website/src/deployment/content-identity.ts";
import { classifyTypes, ofCapability } from "../capability.ts";
import type { PostTypeProfile } from "../../../migration.config.ts";

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
const profile = (
  overrides: Partial<PostTypeProfile> = {},
): PostTypeProfile => ({
  name: "product",
  collection: "products",
  restBase: "product",
  permalink: "/products/%postname%/",
  published: true,
  archive: { kind: "none" },
  taxonomies: { attached: [], archives: false },
  ...overrides,
});

type Entry = EntryLike<CustomEntryData> & { data: CustomEntryData };

const entry = (
  slug: string,
  overrides: Partial<CustomEntryData> = {},
): Entry => ({
  data: {
    slug,
    title: slug,
    locale: "en",
    updatedAt: "2026-01-15",
    publishedAt: "2026-01-10",
    ...overrides,
  } as CustomEntryData,
  body: "",
});

const resolve = (
  profiles: readonly PostTypeProfile[],
  custom: Record<string, readonly Entry[]>,
  locale = "en",
) =>
  resolveSiteRoutes<EntryLike<PostEntryData>, EntryLike<PageEntryData>, Entry>({
    posts: [],
    pages: [],
    authors: [],
    categories: [],
    tags: [],
    custom,
    postTypes: profiles,
    locale,
  });

/**
 * Just the custom routes.
 *
 * The resolver always emits page one of the posts listing, even with no posts —
 * `/blog/` exists whether or not anything is filed under it. So a test about
 * custom types has to say so rather than reading `routes[0]`.
 */
const customRoutes = <T extends { kind: string }>(routes: readonly T[]) =>
  routes.filter(
    (route) => route.kind === "custom" || route.kind === "custom-archive",
  );

console.log("\nPermalinks: what a custom type may say, and what it may not");

check("A FIXED PREFIX WITH %postname% IS THE ORDINARY SHAPE", () => {
  equal(postTypeProblems(profile()).length, 0, "no problems");
  equal(
    customTypePath(profile(), { slug: "analyser" }),
    "/products/analyser/",
    "the path",
  );
});

check("a date-structured pattern expands", () => {
  const dated = profile({ permalink: "/events/%year%/%monthnum%/%postname%/" });
  equal(postTypeProblems(dated).length, 0, "accepted");
  equal(
    customTypePath(dated, { slug: "summit", publishedAt: "2026-03-04" }),
    "/events/2026/03/summit/",
    "the path",
  );
});

check("A DATE PATTERN WITH NO DATE FAILS RATHER THAN EMITTING A HOLE", () => {
  // The entry schema makes `publishedAt` optional, because not every custom
  // type means anything by a date. A pattern that needs one and an entry that
  // has none must not produce `/events///summit/`.
  const dated = profile({ permalink: "/events/%year%/%postname%/" });
  const message = threw(() => customTypePath(dated, { slug: "summit" }));
  assert(message.includes("%year%"), `names the token: ${message}`);
});

check("A TAXONOMY TOKEN IS REFUSED, AND SAYS WHY", () => {
  // The capability boundary, enforced at the one place that could cross it.
  // Expanding %category% would pick one of an entry's several terms and
  // publish a URL WordPress never served.
  const problems = postTypeProblems(
    profile({ permalink: "/%category%/%postname%/" }),
  );
  equal(problems.length, 1, "one problem");
  assert(problems[0]!.includes("%category%"), "names the token");
  assert(
    problems[0]!.includes("taxonomy routing"),
    `explains the boundary: ${problems[0]}`,
  );
});

check("an unknown token is refused and the supported set is listed", () => {
  const problems = postTypeProblems(
    profile({ permalink: "/products/%post_id%/" }),
  );
  assert(
    problems.some((one) => one.includes("%post_id%")),
    "names it",
  );
  assert(
    problems.some((one) => one.includes("%postname%")),
    "and lists what IS supported",
  );
  assert(
    !CUSTOM_TYPE_TOKENS.includes("post_id"),
    "post_id is genuinely not supported",
  );
});

check("A PATTERN WITH NO %postname% IS REFUSED", () => {
  // Every entry of the type would share one URL, and the last one built would
  // win silently.
  const problems = postTypeProblems(profile({ permalink: "/products/" }));
  assert(
    problems.some((one) => one.includes("%postname%")),
    "reported",
  );
});

console.log("\nProfiles cannot contradict themselves");

check("TAXONOMY ARCHIVES ARE REFUSED, EXPLICITLY", () => {
  // The kit routes taxonomies for posts only. Claiming otherwise would ship
  // listings nobody checked, which is worse than saying no.
  const problems = postTypeProblems(
    profile({ taxonomies: { attached: ["product_cat"], archives: true } }),
  );
  equal(problems.length, 1, "one problem");
  assert(problems[0]!.includes("taxonomy archives"), "names the capability");
  assert(problems[0]!.includes("Set it to false"), "and says what to do");
});

check("attached taxonomies with archives:false are fine", () => {
  // The terms are still content and still travel on the entry. Recorded, not
  // routed — and the difference is stated rather than implied.
  equal(
    postTypeProblems(
      profile({ taxonomies: { attached: ["product_cat"], archives: false } }),
    ).length,
    0,
    "accepted",
  );
});

check("an unpublished type cannot declare an archive", () => {
  const problems = postTypeProblems(
    profile({
      published: false,
      archive: { kind: "archive", path: "/products/", title: "Products" },
    }),
  );
  assert(
    problems.some((one) => one.includes("dead links")),
    "a listing of pages that do not exist",
  );
});

check("TWO TYPES CANNOT SHARE ONE COLLECTION", () => {
  // One directory cannot be told apart, and one type's entries would take the
  // other's identity.
  const problems = postTypeProfileProblems([
    profile({ name: "product" }),
    profile({ name: "portfolio" }),
  ]);
  assert(
    problems.some((one) => one.includes("both use")),
    "reported",
  );
});

check("a custom type cannot claim a core collection", () => {
  const problems = postTypeProfileProblems([
    profile({ name: "story", collection: "posts" }),
  ]);
  assert(
    problems.some((one) => one.includes("the kit's own")),
    "reported",
  );
});

console.log("\nThe resolver knows the type");

check("A SINGLE-ONLY TYPE PRODUCES ENTRIES AND NO LISTING", () => {
  const table = resolve(
    [profile({ name: "portfolio", collection: "portfolio" })],
    {
      portfolio: [entry("harbour")],
    },
  );
  const kinds = table.routes.map((route) => route.kind);
  equal(kinds.filter((kind) => kind === "custom").length, 1, "one entry");
  equal(
    kinds.filter((kind) => kind === "custom-archive").length,
    0,
    "and NO listing — has_archive defaults to false in WordPress too",
  );
});

check("a type with an archive produces the listing too", () => {
  const table = resolve(
    [
      profile({
        archive: { kind: "archive", path: "/products/", title: "Products" },
      }),
    ],
    { products: [entry("analyser"), entry("collator")] },
  );
  equal(
    table.routes.filter((route) => route.kind === "custom").length,
    2,
    "both entries",
  );
  const listings = table.routes.filter(
    (route) => route.kind === "custom-archive",
  );
  equal(listings.length, 1, "one page of listing");
  equal(listings[0]!.path, "/products/", "at the configured path");
});

check("AN UNPUBLISHED TYPE PRODUCES NOTHING", () => {
  const table = resolve([profile({ published: false })], {
    products: [entry("analyser")],
  });
  equal(customRoutes(table.routes).length, 0, "no custom routes");
  equal(table.custom["products"]?.length, 0, "and nothing routed");
});

check("a route carries its profile, not a guess from the path", () => {
  // The resolver must KNOW the type. A route that had to be identified by
  // looking at its URL would be a heuristic wearing a type.
  const table = resolve([profile()], { products: [entry("analyser")] });
  const route = customRoutes(table.routes)[0]!;
  assert(route.kind === "custom", "the kind");
  if (route.kind !== "custom") return;
  equal(route.profile.name, "product", "the WordPress type key");
  equal(route.profile.collection, "products", "the collection");
  equal(route.profile.permalink, "/products/%postname%/", "the pattern");
  equal(route.entry.data.slug, "analyser", "and the entry");
});

check("AN UNSUPPORTED PROFILE STOPS THE BUILD BEFORE ANY ROUTE EXISTS", () => {
  const message = threw(() =>
    resolve([profile({ permalink: "/%category%/%postname%/" })], {
      products: [entry("analyser")],
    }),
  );
  assert(message.includes("postTypes are not usable"), "it throws");
  assert(message.includes("%category%"), `and names the token: ${message}`);
});

check("a custom route colliding with another path throws by name", () => {
  const table = () =>
    resolve(
      [
        profile({ name: "a", collection: "aa", permalink: "/x/%postname%/" }),
        profile({ name: "b", collection: "bb", permalink: "/x/%postname%/" }),
      ],
      { aa: [entry("one")], bb: [entry("one")] },
    );
  const message = threw(table);
  assert(
    message.includes("Two routes claim"),
    `collision reported: ${message}`,
  );
});

console.log("\nIdentity survives, and a shared slug does not collide");

check("A CUSTOM ENTRY'S IDENTITY IS COLLECTION + SLUG + LOCALE", () => {
  const table = resolve([profile()], { products: [entry("analyser")] });
  equal(
    identityOf(customRoutes(table.routes)[0]!),
    "products/analyser@en",
    "the collection, not the WordPress type key",
  );
});

check("TWO LOCALES SHARING A SLUG ARE TWO IDENTITIES", () => {
  // The lesson this kit already paid for once: Astro's loader derived entry ids
  // from front-matter `slug`, two translations collided, and one was silently
  // never loaded. Identity is not the display slug.
  const en = entryId("products", "analyser", "en");
  const pt = entryId("products", "analyser", "pt-BR");
  assert(en !== pt, "distinct");
  equal(localeOf(en), "en", "and each names its locale");
  equal(localeOf(pt), "pt-BR", "including a regional form");
  equal(kindOf(en), "products", "and its collection");
});

check("neither disappears when the resolver runs", () => {
  const table = resolve([profile()], {
    products: [
      entry("analyser"),
      entry("analyser", { locale: "pt-BR", title: "O Analisador" }),
    ],
  });
  const routed = customRoutes(table.routes);
  equal(routed.length, 1, "one is routed — this build is en");
  equal(
    identityOf(routed[0]!),
    "products/analyser@en",
    "and it is the English one",
  );
  // The other is not lost: it is still in the source the manifest names as
  // intended, which is what `content:integrity` joins on.
});

check("A LISTING'S IDENTITY IS STRUCTURAL, NOT AN ENTRY'S", () => {
  const id = customArchiveIdentity("products");
  assert(isStructuralId(id), "marked structural");
  equal(
    localeOf(id),
    undefined,
    "and its `@` is not read as a locale — that bug withheld a published listing",
  );
});

console.log("\nDiscovery: a type nobody configured is a decision waiting");

const restType = (name: string, taxonomies: string[] = []) => ({
  name,
  label: name,
  restBase: name,
  taxonomies,
});

check(
  "REST-DISCOVERED WITH NO PROFILE IS `unconfigured`, NEVER SILENCE",
  () => {
    const rows = classifyTypes(
      [restType("post"), restType("page"), restType("product")],
      [],
    );
    equal(ofCapability(rows, "unconfigured").length, 1, "one");
    equal(ofCapability(rows, "unconfigured")[0]!.type.name, "product", "named");
    equal(ofCapability(rows, "core").length, 2, "and the core two are core");
  },
);

check("a configured type is distinguished from a withheld one", () => {
  const rows = classifyTypes(
    [restType("product"), restType("internal_note")],
    [
      profile(),
      profile({
        name: "internal_note",
        collection: "internal-notes",
        published: false,
      }),
    ],
  );
  equal(ofCapability(rows, "configured").length, 1, "one configured");
  equal(ofCapability(rows, "withheld").length, 1, "one withheld");
  equal(ofCapability(rows, "unconfigured").length, 0, "none unconfigured");
});

check("WordPress's own machinery is not reported as content", () => {
  const rows = classifyTypes(
    [restType("attachment"), restType("wp_block"), restType("product")],
    [],
  );
  equal(ofCapability(rows, "internal").length, 2, "two internal");
  equal(
    ofCapability(rows, "unconfigured").length,
    1,
    "and the real one stands out",
  );
});

check("A CONFIGURED TYPE'S UNROUTABLE TAXONOMIES ARE STILL REPORTED", () => {
  // The more dangerous case than an unconfigured type: the profile looks
  // complete and the taxonomy archives silently do not exist.
  const rows = classifyTypes(
    [restType("product", ["product_cat", "product_tag"])],
    [profile({ taxonomies: { attached: ["product_cat"], archives: false } })],
  );
  equal(rows[0]!.capability, "configured", "configured");
  equal(rows[0]!.unroutableTaxonomies.length, 2, "and both are named");
});

console.log("\nArchive paths");

check("asking a type with no archive for its archive path throws", () => {
  const message = threw(() => customTypeArchivePath(profile()));
  assert(message.includes("has no archive"), `by name: ${message}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("\nCustom post type suite FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("Custom post type suite OK\n");
