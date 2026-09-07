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
    const other = manifest.content.intended.filter(
      (intent: { id: string }) =>
        intent.id.includes("@") &&
        !intent.id.endsWith(`@${manifest.content.locale}`),
    );
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
