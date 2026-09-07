// Route discovery from a build output.
//
// Derived from the built tree, never from a hand-maintained list. A list is
// how a new route escapes the audit that exists to cover every route, and the
// build output is the only source that cannot disagree with what shipped.
//
// Shared by `layout-audit`, `contrast-audit` and `render-digest`, so all three
// measure the same set of pages and a route cannot be in one gate's scope and
// out of another's.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * True for a redirect stub rather than a page of the site.
 *
 * A materialised redirect (`content/redirects.json`) is a meta refresh and a
 * link. It has no layout to measure, no contrast to read and nothing to
 * digest. Matched on the refresh directive rather than on the generator's
 * exact wording, so an Astro release that rephrases the stub does not silently
 * pull every redirect into three browser gates.
 */
export const isRedirectStub = (html: string): boolean =>
  /<meta[^>]+http-equiv=["']?refresh/i.test(html.slice(0, 1000));

/** Every HTML route in a build output, as a servable path, sorted. */
export function routesIn(distDirectory: string): string[] {
  const routes: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".html")) continue;
      if (isRedirectStub(readFileSync(full, "utf8"))) continue;
      const relative = path.relative(distDirectory, full);
      routes.push(
        `/${relative
          .split(path.sep)
          .join("/")
          .replace(/index\.html$/, "")}`,
      );
    }
  };
  walk(distDirectory);
  return routes.sort();
}
