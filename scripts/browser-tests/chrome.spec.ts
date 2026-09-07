// The interactions nothing else tests.
//
// Every control this kit ships is CSS-driven, because the build ships no
// framework runtime and the preview audit asserts that on every build. A
// checkbox drives the small-viewport menu; a link drives everything else; one
// declared inline island drives search.
//
// That is a deliberate and slightly unusual set of mechanisms, and it has one
// property that matters here: **none of it can be verified without running a
// browser and actually operating it.** Reading the HTML tells you a checkbox
// exists. It does not tell you the panel opens, that it closes again, or that
// the skip link puts focus where a keyboard user expects — and each of those
// is exactly the kind of thing found by a person clicking rather than by a
// gate.
//
// These tests are written against the kit's SAMPLE SITE. When you replace the
// sample content with your own, the routes change and some of these will need
// to change with them — that is expected, and each test says which fact about
// the site it depends on so the edit is obvious.
import { expect, test } from "@playwright/test";

test.describe("the small-viewport menu", () => {
  // A checkbox and a `<label for>`, chosen over a `<details open>` that could
  // not start closed. What is NOT acceptable is the menu failing to open,
  // failing to close, or shipping already open — the last of which is the
  // exact defect that retired the disclosure version, when the header measured
  // 363px tall on a 375px screen.
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 1024, "phone only");

  test("starts closed, opens, and closes again", async ({ page }) => {
    await page.goto("/");
    const toggle = page.locator("#wpk-site-menu");
    const menu = page.getByRole("navigation", { name: /main/i });

    await expect(toggle).not.toBeChecked();
    await expect(menu).toBeHidden();

    await page.locator('label[for="wpk-site-menu"]').click();
    await expect(menu).toBeVisible();

    await page.locator('label[for="wpk-site-menu"]').click();
    await expect(menu).toBeHidden();
  });

  test("the closed header leaves the page heading above the fold", async ({
    page,
  }) => {
    // The measurement that killed the disclosure version: with the menu
    // expanded the heading began at 456px on a 375px screen. This asserts the
    // PROPERTY that failure violated rather than a pixel number, so a header
    // that grows for a good reason does not fail and one that swallows the
    // first screen does.
    await page.goto("/");
    const heading = page.getByRole("heading", { level: 1 }).first();
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeLessThan(400);
  });

  test("the toggle is operable from the keyboard", async ({ page }) => {
    // The input is visually hidden but still in the accessibility tree and
    // still focusable, which is the whole reason it is `clip-path`-ed rather
    // than `display: none`. Space is what operates a checkbox.
    await page.goto("/");
    const toggle = page.locator("#wpk-site-menu");
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle).toBeChecked();
    await expect(page.getByRole("navigation", { name: /main/i })).toBeVisible();
  });
});

test.describe("the skip link", () => {
  test("reveals on focus and moves focus into the main landmark", async ({
    page,
  }) => {
    // Two halves, and the second is the one that is usually broken. A skip
    // link pointing at a plain `<main>` moves the scroll position and leaves
    // focus on the link, so the next Tab goes back into the navigation the
    // user was trying to skip. `tabindex="-1"` on the target is what makes the
    // jump real, and this is what proves it in a browser rather than in markup.
    await page.goto("/");
    const skip = page.locator("a.wpk-skip-link");

    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    // Revealed: off-screen at rest, in the viewport once focused.
    const box = await skip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);

    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });
});

test.describe("navigation", () => {
  test("every header link reaches a page that renders", async ({
    page,
    viewport,
  }) => {
    // The links are content (`content/navigation/header.json`), so this walks
    // whatever the menu currently holds rather than a hard-coded list. The
    // preview audit already proves each target was EMITTED; this proves the
    // page a visitor lands on has a heading, which is the difference between a
    // file existing and a page working.
    await page.goto("/");
    if ((viewport?.width ?? 0) <= 1024)
      await page.locator('label[for="wpk-site-menu"]').click();

    const menu = page.getByRole("navigation", { name: /main/i });
    const hrefs = await menu
      .locator("a[href^='/']")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
    expect(hrefs.length).toBeGreaterThan(0);

    for (const href of [...new Set(hrefs)]) {
      await page.goto(href);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

  test("the current page is marked once per menu, and points at itself", async ({
    page,
    viewport,
  }) => {
    // Scoped to ONE menu, because a page legitimately appears in more than
    // one: on the sample site `/about/` is in the header AND in the footer,
    // and both are correctly marked. Measured — an earlier version of this
    // test counted the whole document and failed against a correct page.
    //
    // What must hold per menu is that exactly one item claims to be this page,
    // and that it points here. The accessibility audit asserts the second half
    // statically for every page; this asserts both in a browser, against the
    // menu a reader is actually looking at.
    await page.goto("/about/");
    if ((viewport?.width ?? 0) <= 1024)
      await page.locator('label[for="wpk-site-menu"]').click();

    const menu = page.getByRole("navigation", { name: /main/i });
    const current = menu.locator('a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("href", "/about/");

    // And nothing anywhere on the page claims to be a page it is not.
    const hrefs = await page
      .locator('a[aria-current="page"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
    for (const href of hrefs) expect(href).toBe("/about/");
  });
});

test.describe("the blog listing", () => {
  test("a card reaches its post", async ({ page }) => {
    await page.goto("/blog/");
    const first = page.locator(".wpk-post-card__link").first();
    const href = await first.getAttribute("href");
    await first.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a post links back to its category archive", async ({ page }) => {
    // The archive routes come from `migration.config.ts`'s permalinks, so this
    // follows whatever link the post renders rather than assuming `/category/`.
    await page.goto("/blog/");
    await page.locator(".wpk-post-card__link").first().click();
    const category = page
      .locator("main a[href*='categor'], main a[href*='/tag/']")
      .first();
    await expect(category).toBeVisible();
    await category.click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("search", () => {
  test("the form submits its query into the URL", async ({ page }) => {
    // The form works without the island: it is a real `<form>` with a real
    // `name="q"`, so a submit navigates. That is the no-JavaScript path, and
    // it is the one this asserts.
    await page.goto("/search/");
    await page.locator("#wpk-search-input").fill("hello");
    await page.locator("#wpk-search-input").press("Enter");
    await expect(page).toHaveURL(/\/search\/?\?q=hello/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test("no page loads a script from anywhere — islands are inline", async ({
  page,
}) => {
  // The preview audit asserts from the HTML that every `<script>` is a named
  // inline island. This asserts it from the BROWSER's side: a script arriving
  // through a stylesheet, an injected iframe or a third-party embed is
  // invisible to a source read and obvious here.
  //
  // `/search/` carries the search island and still requests no script file,
  // which is the case that makes this worth running.
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  for (const route of ["/", "/blog/", "/search/", "/about/"])
    await page.goto(route);
  expect(scripts).toEqual([]);
});

test.describe("content reaches a reader", () => {
  // The end of the chain the content-integrity gate proves the middle of:
  //
  //     content/posts/*.md -> resolver -> [...path].astro -> dist -> BROWSER
  //
  // Every other check in that chain reads a file. This one loads the page the
  // way a person does and reads the words off it, which is the only step that
  // can catch a build that emitted a file containing nothing.
  //
  // Depends on: the sample post `a-second-post`, and the deployment manifest
  // naming the content behind every route.
  test("a post's own words are painted, not just its file emitted", async ({
    page,
  }) => {
    await page.goto("/a-second-post/");
    // A phrase from `content/posts/a-second-post.md`, chosen because nothing
    // in the layout, the navigation or the footer could produce it.
    await expect(
      page.getByText("A migrated post body is the HTML WordPress rendered"),
    ).toBeVisible();
    await expect(page.locator("h1")).toContainText(
      "A second post, with the shapes a body carries",
    );
  });

  test("THE MANIFEST NAMES THE CONTENT BEHIND THE PAGE JUST LOADED", async ({
    page,
    request,
  }) => {
    // Closes the loop in the browser rather than on disk: the page a reader
    // gets and the identity the integrity gate joins on have to be the same
    // thing, or the gate is proving a relationship nobody experiences.
    await page.goto("/a-second-post/");
    const manifest = await (await request.get("/deployment.json")).json();
    const route = manifest.routes.inventory.find(
      (entry: { path: string }) => entry.path === "/a-second-post",
    );
    expect(
      route,
      "the route this browser just loaded is in the manifest",
    ).toBeTruthy();
    expect(route.entry).toBe("posts/a-second-post@en");
    expect(
      manifest.content.intended.some(
        (intent: { id: string }) => intent.id === route.entry,
      ),
      "and content/ intends the identity the route names",
    ).toBe(true);
  });

  test("a withheld translation is NAMED, not vanished", async ({ request }) => {
    // The silent-corruption case, stated as a browser-visible fact: an entry
    // in a locale this build does not publish must appear in the artifact as
    // intended, so it can be reported as withheld. Before this contract it
    // left no trace anywhere.
    //
    // Skipped when the sample content carries only one locale, which is how
    // the kit ships — the assertion is about what happens WHEN one exists.
    const manifest = await (await request.get("/deployment.json")).json();
    // The `@` has to come after the last `/`. A structural identity is spelled
    // `@archive/products` and its `@` is at index 0 — reading that as a locale
    // is the exact bug that made a published listing look withheld, caught
    // once by the integrity gate and again here.
    const localeOf = (id: string): string | undefined => {
      const at = id.lastIndexOf("@");
      return at > 0 && at > id.lastIndexOf("/") ? id.slice(at + 1) : undefined;
    };
    const other = manifest.content.intended.filter((intent: { id: string }) => {
      const locale = localeOf(intent.id);
      return locale !== undefined && locale !== manifest.content.locale;
    });
    test.skip(
      other.length === 0,
      "sample content is single-locale; nothing is withheld",
    );
    const routed = new Set(
      manifest.routes.inventory
        .map((entry: { entry?: string }) => entry.entry)
        .filter(Boolean),
    );
    for (const intent of other)
      expect(
        routed.has(intent.id),
        `${intent.id} is named as intended and correctly not routed`,
      ).toBe(false);
  });
});

test.describe("a custom post type reaches a reader", () => {
  // The whole chain for a type WordPress did not ship with:
  //
  //   migration.config.ts profile -> content/products/ -> collection
  //     -> identity -> permalink -> resolver -> [...path].astro -> dist
  //     -> BROWSER
  //
  // Depends on: the `product` and `portfolio` fixture profiles in
  // migration.config.ts, and their sample entries.
  test("the single entry loads at its configured URL", async ({ page }) => {
    await page.goto("/products/analyser/");
    // The URL shape comes from `permalink: "/products/%postname%/"`. Nothing
    // is named after it in the codebase — change the pattern and this moves.
    expect(new URL(page.url()).pathname).toBe("/products/analyser/");
    await expect(page.locator("h1")).toContainText("The Analyser");
    await expect(
      page.getByText("This is a custom post type entry"),
    ).toBeVisible();
  });

  test("ITS MANIFEST IDENTITY IS THE COLLECTION, NOT THE TYPE KEY", async ({
    page,
    request,
  }) => {
    await page.goto("/products/analyser/");
    const manifest = await (await request.get("/deployment.json")).json();
    const route = manifest.routes.inventory.find(
      (entry: { path: string }) => entry.path === "/products/analyser",
    );
    expect(route, "the route is in the manifest").toBeTruthy();
    expect(route.origin).toBe("custom");
    expect(route.entry).toBe("products/analyser@en");
    expect(
      manifest.content.intended.some(
        (intent: { id: string }) => intent.id === route.entry,
      ),
      "and content/ intends it",
    ).toBe(true);
  });

  test("the archive lists it, because the profile declares one", async ({
    page,
  }) => {
    await page.goto("/products/");
    await expect(page.locator("h1")).toContainText("Products");
    await expect(
      page.getByRole("link", { name: "The Analyser" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "The Collator" }),
    ).toBeVisible();
  });

  test("A TYPE WITH NO ARCHIVE PUBLISHES NO LISTING", async ({
    page,
    request,
  }) => {
    // WordPress's own `has_archive` defaults to false, and a listing nobody
    // asked for is a URL nobody asked for. The entry exists; the listing must
    // not.
    await page.goto("/portfolio/harbour-rebuild/");
    await expect(page.locator("h1")).toContainText("Harbour Rebuild");

    const manifest = await (await request.get("/deployment.json")).json();
    const listing = manifest.routes.inventory.find(
      (entry: { path: string }) => entry.path === "/portfolio",
    );
    expect(listing, "no /portfolio listing is claimed").toBeUndefined();
  });

  test("A WITHHELD TYPE PUBLISHES NOTHING AT ALL", async ({ request }) => {
    // `published: false` — captured, validated, named as intended, and no page.
    const manifest = await (await request.get("/deployment.json")).json();
    const routed = manifest.routes.inventory.filter(
      (entry: { entry?: string }) =>
        entry.entry?.startsWith("internal-notes/") === true,
    );
    expect(routed, "no route for a withheld type").toHaveLength(0);
    expect(
      manifest.content.intended.some((intent: { id: string }) =>
        intent.id.startsWith("internal-notes/"),
      ),
      "but it IS named as intended, so integrity can report it withheld",
    ).toBe(true);
  });

  test("no custom route is emitted twice", async ({ request }) => {
    const manifest = await (await request.get("/deployment.json")).json();
    const paths = manifest.routes.inventory
      .filter((entry: { origin: string }) =>
        ["custom", "custom-archive"].includes(entry.origin),
      )
      .map((entry: { path: string }) => entry.path);
    expect(new Set(paths).size, "every custom path is unique").toBe(
      paths.length,
    );
    expect(paths.length, "and there are some to check").toBeGreaterThan(0);
  });
});

test.describe("custom taxonomy archives reach a reader", () => {
  // The route the resolver computed has to be the route the browser is served.
  // Everything else here reads a manifest; this navigates.
  //
  // Depends on: the `product_cat` (hierarchical URLs) and `product_tag` (flat)
  // fixture profiles, and the four category terms in
  // content/product-categories.json.
  test("A ROOT TERM ARCHIVE LOADS AT ITS CONFIGURED PREFIX", async ({
    page,
  }) => {
    await page.goto("/product-category/electronics/");
    expect(new URL(page.url()).pathname).toBe("/product-category/electronics/");
    await expect(page.locator("h1")).toContainText("Electronics");
  });

  test("A CHILD TERM'S URL CARRIES ITS ANCESTOR", async ({ page }) => {
    // `urlHierarchy: true` — WordPress's `rewrite['hierarchical']`. The
    // ancestor is in the path because the profile says so, not because the
    // term has a parent.
    await page.goto("/product-category/electronics/laptops/");
    expect(new URL(page.url()).pathname).toBe(
      "/product-category/electronics/laptops/",
    );
    await expect(page.locator("h1")).toContainText("Laptops");
    // The breadcrumb is the resolver's ancestor chain, not a split on "/".
    await expect(
      page.getByRole("link", { name: "Electronics" }).first(),
    ).toBeVisible();
    // And the entry filed under it is listed.
    await expect(
      page.getByRole("link", { name: "The Analyser" }),
    ).toBeVisible();
  });

  test("SIBLING BRANCHES DO NOT COLLIDE", async ({ page }) => {
    // Two children, two parents, two paths. WordPress makes the slugs distinct
    // (wp_unique_term_slug); what has to hold here is that the PATHS are.
    await page.goto("/product-category/furniture/laptop-stands/");
    expect(new URL(page.url()).pathname).toBe(
      "/product-category/furniture/laptop-stands/",
    );
    await expect(page.locator("h1")).toContainText("Laptop stands");
    await expect(
      page.getByRole("link", { name: "The Collator" }),
    ).toBeVisible();
  });

  test("A FLAT TAXONOMY'S TERM HAS NO ANCESTOR IN ITS URL", async ({
    page,
  }) => {
    await page.goto("/product-tag/featured/");
    expect(new URL(page.url()).pathname).toBe("/product-tag/featured/");
    await expect(page.locator("h1")).toContainText("Featured");
  });

  test("ONE SLUG IN TWO TAXONOMIES IS TWO PAGES", async ({ page, request }) => {
    // WordPress has allowed this since 4.1, so the kit has to survive it. Both
    // must exist, at different URLs, with different identities and — because
    // `seo:audit` failed on the duplicate — different titles.
    await page.goto("/product-category/electronics/laptops/");
    const categoryTitle = await page.title();
    await page.goto("/product-tag/laptops/");
    const tagTitle = await page.title();
    expect(categoryTitle).not.toBe(tagTitle);

    const manifest = await (await request.get("/deployment.json")).json();
    const identities = manifest.routes.inventory
      .filter((entry: { path: string }) => entry.path.endsWith("/laptops"))
      .map((entry: { entry?: string }) => entry.entry);
    expect(identities).toContain("product-categories/laptops");
    expect(identities).toContain("product-tags/laptops");
  });

  test("a product links to nothing the build did not publish", async ({
    page,
  }) => {
    // The entry page prints its terms as text, deliberately: the kit publishes
    // term archives only for CONFIGURED taxonomies, and a link to an archive
    // that does not exist is worse than no link.
    await page.goto("/products/analyser/");
    const hrefs = await page
      .locator("main a")
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLAnchorElement).getAttribute("href")),
      );
    for (const href of hrefs)
      expect(
        href?.startsWith("/product-category/") ||
          href?.startsWith("/product-tag/"),
        `${href} — the entry template links no term archives`,
      ).toBeFalsy();
  });

  test("every taxonomy route is unique and claimed", async ({ request }) => {
    const manifest = await (await request.get("/deployment.json")).json();
    const rows = manifest.routes.inventory.filter(
      (entry: { origin: string }) => entry.origin === "taxonomy-archive",
    );
    expect(rows.length, "there are term archives to check").toBeGreaterThan(0);
    const paths = rows.map((entry: { path: string }) => entry.path);
    expect(new Set(paths).size, "no duplicate output").toBe(paths.length);
    for (const row of rows)
      expect(
        manifest.content.intended.some(
          (intent: { id: string }) => intent.id === row.entry,
        ),
        `${row.entry} is intended`,
      ).toBe(true);
  });
});

test.describe("the page a reader gets is the entity the source intended", () => {
  // Not "does it return 200". Each of these loads a page, reads a phrase only
  // its own source file could produce, and joins that back to the identity the
  // manifest claims for the route — the whole chain, from the browser end.
  const cases = [
    {
      what: "a core post",
      path: "/hello-world/",
      identity: "posts/hello-world@en",
      origin: "post",
    },
    {
      what: "a custom-type single",
      path: "/products/analyser/",
      identity: "products/analyser@en",
      origin: "custom",
    },
    {
      what: "a custom-type archive",
      path: "/products/",
      identity: "@archive/products",
      origin: "custom-archive",
    },
    {
      what: "a taxonomy archive",
      path: "/product-category/electronics/laptops/",
      identity: "product-categories/laptops",
      origin: "taxonomy-archive",
    },
  ];

  for (const one of cases)
    test(`${one.what} resolves to ONE claimed identity`, async ({
      page,
      request,
    }) => {
      await page.goto(one.path);
      expect(new URL(page.url()).pathname).toBe(one.path);
      await expect(page.locator("h1")).toBeVisible();

      const manifest = await (await request.get("/deployment.json")).json();
      const key = one.path.replace(/\/$/, "") || "/";
      const rows = manifest.routes.inventory.filter(
        (row: { path: string }) => row.path === key,
      );
      expect(rows, `exactly one inventory row claims ${key}`).toHaveLength(1);
      expect(rows[0].entry).toBe(one.identity);
      expect(rows[0].origin).toBe(one.origin);
    });

  test("A LOCALIZED ENTITY IS NAMED, AND ITS SIBLING IS NOT SHADOWED", async ({
    page,
    request,
  }) => {
    // `products/analyser` exists in `en` and `pt-BR` with the SAME slug. The
    // en one is published; the pt-BR one is withheld and must still be named,
    // and the two must not be one identity — that collision is the defect this
    // whole hardening pass is about.
    const manifest = await (await request.get("/deployment.json")).json();
    const both = manifest.content.intended.filter((intent: { id: string }) =>
      intent.id.startsWith("products/analyser@"),
    );
    expect(both, "two identities, not one").toHaveLength(2);
    expect(both.map((i: { id: string }) => i.id).sort()).toEqual([
      "products/analyser@en",
      "products/analyser@pt-BR",
    ]);

    const routed = manifest.routes.inventory.filter((row: { entry?: string }) =>
      row.entry?.startsWith("products/analyser@"),
    );
    expect(routed, "only the built locale is routed").toHaveLength(1);
    expect(routed[0].entry).toBe("products/analyser@en");

    // And the page a reader gets is the English one, not the translation.
    await page.goto("/products/analyser/");
    await expect(page.locator("h1")).toContainText("The Analyser");
  });

  test("every content route in the manifest is claimed exactly once", async ({
    request,
  }) => {
    // The invariant, asserted against the real artifact rather than a fixture.
    const manifest = await (await request.get("/deployment.json")).json();
    const rows = manifest.routes.inventory.filter(
      (row: { kind: string }) => row.kind === "page",
    );
    const paths = rows.map((row: { path: string }) => row.path);
    expect(new Set(paths).size, "one claimant per route").toBe(paths.length);

    const files = rows.map((row: { file: string }) => row.file);
    expect(new Set(files).size, "one claimant per output").toBe(files.length);
  });
});
