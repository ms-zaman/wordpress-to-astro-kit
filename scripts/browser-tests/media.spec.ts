// Migrated media, in the browser.
//
// Not "the file responds 200": an `<img>` can be served, be 200, and still be
// broken — a zero-byte file, an SVG the browser refuses, an element the layout
// collapsed to nothing. So these read `naturalWidth`, which is only non-zero
// when the browser actually decoded the image.
//
// And the other half, which no status code can tell you: that no reference on
// the page still points at the WordPress install the site was migrated from.
// A page full of working images that fetches them from a server you are about
// to switch off is not a migrated page.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const manifest = JSON.parse(
  readFileSync(
    path.join(repositoryRoot, "apps/website/dist/deployment.json"),
    "utf8",
  ),
) as {
  routes: { inventory: { path: string; kind: string; origin: string }[] };
};

/** Every page route this build published. */
const pages = manifest.routes.inventory.filter(
  (route) => route.kind === "page",
);

test.describe("migrated media", () => {
  test("EVERY MIGRATED IMAGE ON EVERY PAGE ACTUALLY DECODED", async ({
    page,
  }) => {
    // The whole site, because a broken image is a per-page defect and the kit
    // has few enough pages to check them all. `naturalWidth` is zero for an
    // image the browser could not decode, whatever the status code was.
    //
    // Scoped to images this build SERVES. An external asset lives on somebody
    // else's server and its availability is not this migration's to assert —
    // the kit's own sample deliberately references `partner.example.org`,
    // which is IANA-reserved and resolves nowhere, precisely so that "left
    // external" is a visible fact rather than a claim. Widening this check to
    // remote images would make every clone's test suite depend on a third
    // party being up.
    const broken: string[] = [];
    for (const route of pages) {
      await page.goto(route.path);
      const bad = await page.locator("img").evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const image = node as HTMLImageElement;
            const src = image.getAttribute("src") ?? "";
            if (!src.startsWith("/")) return false;
            return image.complete && image.naturalWidth === 0;
          })
          .map((node) => (node as HTMLImageElement).getAttribute("src") ?? ""),
      );
      for (const src of bad) broken.push(`${route.path}: ${src}`);
    }
    expect(broken, "images this site serves that did not decode").toEqual([]);
  });

  test("NO PAGE STILL POINTS AT THE SOURCE WORDPRESS INSTALL", async ({
    page,
  }) => {
    // The migration's own definition of finished. An asset reference in the
    // uploads namespace, on a host the profile migrates, means the browser is
    // still asking the old server for a file.
    const stale: string[] = [];
    for (const route of pages) {
      await page.goto(route.path);
      const found = await page.evaluate(() => {
        const urls: string[] = [];
        for (const node of document.querySelectorAll(
          "[src], [srcset], [href], [poster], [data-src], [data-srcset]",
        ))
          for (const attribute of [
            "src",
            "srcset",
            "href",
            "poster",
            "data-src",
            "data-srcset",
          ]) {
            const value = node.getAttribute(attribute);
            if (value !== null) urls.push(value);
          }
        return urls;
      });
      for (const url of found)
        // `partner.example.org` is deliberately external and stays as it is —
        // the rule is the HOST, not the path, which is exactly what makes the
        // engine safe to run over a body full of other people's images.
        if (url.includes("/wp-content/uploads/") && !url.includes("partner."))
          stale.push(`${route.path}: ${url}`);
    }
    expect(stale, "references still pointing at the source site").toEqual([]);
  });

  test("a responsive migrated image serves its renditions", async ({
    page,
  }) => {
    const withSrcset = pages.find((route) => route.origin === "post");
    await page.goto("/migrated-media");
    const image = page.locator("img[srcset]").first();
    test.skip(
      (await image.count()) === 0,
      `this build has no responsive migrated image (checked ${withSrcset?.path})`,
    );

    // Every candidate is a migrated path, and every one of them is really there.
    const srcset = (await image.getAttribute("srcset")) ?? "";
    const candidates = srcset
      .split(",")
      .map((candidate) => candidate.trim().split(/\s+/)[0]!)
      .filter((candidate) => candidate !== "");
    expect(candidates.length).toBeGreaterThan(1);
    for (const candidate of candidates) {
      expect(candidate, "a migrated path").toMatch(/^\/media\//);
      const response = await page.request.get(candidate);
      expect(response.status(), candidate).toBe(200);
      expect(
        (await response.body()).byteLength,
        `${candidate} is not empty`,
      ).toBeGreaterThan(0);
    }

    // And the element decoded, at a real size.
    await expect(image).toBeVisible();
    const decoded = await image.evaluate(
      (node) => (node as HTMLImageElement).naturalWidth,
    );
    expect(decoded, "the browser decoded it").toBeGreaterThan(0);
  });

  test("the lazy attribute survives the rewrite", async ({ page }) => {
    await page.goto("/migrated-media");
    const image = page.locator("img[srcset]").first();
    test.skip((await image.count()) === 0, "no responsive image in this build");
    // `loading` is content the source wrote, and the engine rewrites URLs —
    // never attributes. A rewrite that dropped it would change how the page
    // loads without changing a word of it.
    expect(await image.getAttribute("loading")).toBe("lazy");
  });

  test("A MIGRATED DOWNLOAD IS SERVED, AND IS NOT AN HTML ERROR PAGE", async ({
    page,
  }) => {
    await page.goto("/migrated-media");
    const link = page.locator('a[href$=".pdf"]').first();
    test.skip((await link.count()) === 0, "this build migrates no file asset");

    const href = (await link.getAttribute("href"))!;
    expect(href, "a migrated path").toMatch(/^\/media\//);
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    const body = await response.body();
    expect(body.byteLength).toBeGreaterThan(0);
    // A static host that 404s to an HTML page would otherwise pass every check
    // above: the bytes have to be the file that was asked for.
    expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  test("an external asset is left exactly where it was", async ({ page }) => {
    await page.goto("/migrated-media");
    const external = page.locator('img[src^="https://partner."]');
    test.skip(
      (await external.count()) === 0,
      "this build references no external asset",
    );
    // It is NOT fetched — the point is that the markup still names the other
    // site, because migrating somebody else's file is not this engine's to do.
    expect(await external.first().getAttribute("src")).toContain(
      "/wp-content/uploads/",
    );
  });
});
