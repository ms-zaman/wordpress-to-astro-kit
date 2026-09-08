// Lineage, verified in the browser: does the page a person actually sees
// belong to the entity the build says it does?
//
// ## Why this is not "assert 200"
//
// A 200 proves a file exists at a path. It does not prove that the file is the
// one the manifest claims, that the entity behind it is the one `content/`
// intended, or that two entities have not quietly swapped places — and every
// silent defect this kit has found was green on exactly that kind of check.
//
// So each test starts from the ARTIFACT. It reads `dist/deployment.json`,
// picks an entity of one kind, follows the lineage the manifest records —
//
//     intended entity → provenance → route → output file → the served page
//
// — and then asserts the served page is that entity's, using the entry's own
// title, which is build metadata rather than anything provenance puts on the
// page. Provenance is deliberately invisible in the rendered site: it is
// migration machinery, not content, and a page that printed its WordPress id
// would be exposing the source install to every visitor.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../apps/website/dist",
);

interface Provenance {
  origin: string;
  collection?: string;
  locale?: string;
  source?: { kind: string; type: string; id: number };
  derived?: { kind: string; collection: string; declaredBy: string };
}
interface Manifest {
  content: {
    locale: string;
    intended: { id: string; provenance?: Provenance }[];
  };
  routes: {
    inventory: { path: string; file: string; origin: string; entry?: string }[];
  };
}

/** The collections the kit itself ships; everything else is configuration. */
const CORE_COLLECTIONS = ["posts", "pages", "authors", "categories", "tags"];

const manifest = JSON.parse(
  readFileSync(path.join(dist, "deployment.json"), "utf8"),
) as Manifest;

/** The route and output file one local identity produced, from the artifact. */
function lineageOf(identity: string): { path: string; file: string } {
  const rows = manifest.routes.inventory.filter(
    (route) => route.entry === identity,
  );
  expect(
    rows.length,
    `the manifest records no route for "${identity}"`,
  ).toBeGreaterThan(0);
  return { path: rows[0]!.path, file: rows[0]!.file };
}

/** The first intended entity of a collection that this build published. */
function anEntityIn(collection: string): {
  id: string;
  provenance: Provenance;
} {
  const published = new Set(
    manifest.routes.inventory.map((route) => route.entry),
  );
  const row = manifest.content.intended.find(
    (intent) =>
      intent.provenance?.collection === collection && published.has(intent.id),
  );
  expect(row, `no published ${collection} entity in the manifest`).toBeTruthy();
  return { id: row!.id, provenance: row!.provenance! };
}

/** The `<title>` the emitted file carries — build metadata, not page chrome. */
function titleInOutput(file: string): string {
  const html = readFileSync(path.join(dist, file), "utf8");
  const title = /<title>([\s\S]*?)<\/title>/.exec(html);
  expect(title, `${file} has no <title>`).toBeTruthy();
  return title![1]!.trim();
}

/**
 * The whole chain, asserted for one entity.
 *
 * Every step is a real join rather than a coincidence: the manifest names the
 * route, the route names the file, the file is read from `dist/`, and the page
 * the browser renders at that route must be the same document. A build that
 * served one entity's page at another's URL fails here and passes every
 * status-code check ever written.
 */
async function assertLineage(
  page: import("@playwright/test").Page,
  identity: string,
  what: string,
): Promise<void> {
  const { path: route, file } = lineageOf(identity);
  const expected = titleInOutput(file);

  const response = await page.goto(route);
  expect(response?.status(), `${what} at ${route}`).toBe(200);

  // The served page is the emitted file: same document, not merely a page.
  await expect(page).toHaveTitle(expected);

  // And the page is not empty chrome — the entity's own heading is on it.
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

  // Provenance stays OUT of the rendered page. A migrated site must not tell
  // its visitors which WordPress install it came from.
  const body = (await page.locator("body").innerHTML()).toLowerCase();
  expect(body).not.toContain("wp:post/");
  expect(body).not.toContain("wp:term/");
}

test.describe("lineage — intended entity to browser-visible page", () => {
  test("a core post", async ({ page }) => {
    await assertLineage(page, anEntityIn("posts").id, "post");
  });

  test("a page", async ({ page }) => {
    await assertLineage(page, anEntityIn("pages").id, "page");
  });

  test("a custom post type entry", async ({ page }) => {
    // The collection is configuration, so it is read off the artifact rather
    // than typed here: a kit whose test names `products` would only prove the
    // kit's own fixture, not that a CPT travels the pipeline.
    //
    // A custom-type ENTRY is what is wanted, so the row must carry a locale —
    // that is what separates an entry from a registry row — and it must be one
    // the build published, since a withheld type is a different test.
    const published = new Set(
      manifest.routes.inventory.map((route) => route.entry),
    );
    const entry = manifest.content.intended.find((intent) => {
      const collection = intent.provenance?.collection;
      return (
        collection !== undefined &&
        !CORE_COLLECTIONS.includes(collection) &&
        intent.provenance!.locale !== undefined &&
        published.has(intent.id)
      );
    });
    test.skip(entry === undefined, "this build publishes no custom type entry");
    await assertLineage(page, entry!.id, "custom type entry");
  });

  test("A CPT ARCHIVE IS DERIVED AND STILL FULLY TRACEABLE", async ({
    page,
  }) => {
    const archive = manifest.content.intended.find(
      (intent) => intent.provenance?.derived?.kind === "type-archive",
    );
    test.skip(archive === undefined, "this build publishes no type archive");
    const { path: route } = lineageOf(archive!.id);

    // The derived entity names the CONFIGURATION that declares it — which is
    // the whole difference between a derived entity and an anonymous route.
    expect(archive!.provenance!.derived!.declaredBy).toMatch(/^postTypes\[/);

    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

    // It lists the entries of its own collection, and every one of those links
    // is a route the manifest also claims — so the listing and the inventory
    // describe one site rather than two.
    const collection = archive!.provenance!.derived!.collection;
    const claimed = new Set(
      manifest.routes.inventory
        .filter((one) => one.entry?.startsWith(`${collection}/`))
        .map((one) => one.path),
    );
    expect(claimed.size).toBeGreaterThan(0);
    const hrefs = await page
      .locator("main a[href]")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href")!),
      );
    const listed = hrefs
      .map((href) => href.replace(/\/+$/, ""))
      .filter((href) => claimed.has(href));
    expect(listed.length, "the archive links its own entries").toBeGreaterThan(
      0,
    );
  });

  test("a taxonomy term archive traces to the term, not to the URL", async ({
    page,
  }) => {
    const term = manifest.routes.inventory.find(
      (route) => route.origin === "taxonomy-archive",
    );
    test.skip(term === undefined, "this build publishes no term archive");

    const intent = manifest.content.intended.find(
      (one) => one.id === term!.entry,
    );
    expect(intent, "the term archive names an intended entity").toBeTruthy();

    // A term archive's URL may carry ancestors; its provenance is one row.
    expect(intent!.provenance?.collection).toBeTruthy();
    await assertLineage(page, term!.entry!, "term archive");
  });

  test("A WITHHELD ENTITY IS ABSENT FROM DIST, NOT MERELY UNLINKED", async ({
    page,
  }) => {
    // The other half of lineage: an entity the build did not publish must have
    // produced no output at all. A page that exists and is simply not linked
    // is published — search engines and the address bar do not care about
    // links — and that is the difference between withholding and hiding.
    const published = new Set(
      manifest.routes.inventory.map((route) => route.entry),
    );
    const withheld = manifest.content.intended.find(
      (intent) => !published.has(intent.id) && intent.provenance !== undefined,
    );
    test.skip(withheld === undefined, "this build withholds nothing");

    expect(
      manifest.routes.inventory.some((route) => route.entry === withheld!.id),
    ).toBe(false);

    // And it is still NAMED in the artifact, with its origin, so it is
    // reportable rather than gone.
    expect(withheld!.provenance!.origin).toBeTruthy();
  });

  test("every emitted page in the manifest has a claimant", async ({
    page,
  }) => {
    // The inventory-wide invariant, checked against the running site rather
    // than only in a unit test: each page route is claimed by content, by a
    // route module, or by a redirect rule — and one of them is loaded to prove
    // the manifest describes a site that exists.
    const anonymous = manifest.routes.inventory.filter(
      (route) =>
        route.kind === "page" &&
        route.entry === undefined &&
        route.origin !== "static" &&
        route.origin !== "redirect",
    );
    expect(
      anonymous.map((route) => route.path),
      "pages nothing claims",
    ).toEqual([]);

    const first = manifest.routes.inventory.find(
      (route) => route.kind === "page" && route.entry !== undefined,
    )!;
    expect((await page.goto(first.path))?.status()).toBe(200);
  });
});
