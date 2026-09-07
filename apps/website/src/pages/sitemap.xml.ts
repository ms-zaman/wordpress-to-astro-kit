// /sitemap.xml — every indexable page in production; an empty urlset in a
// preview, because a sitemap is a request to crawl and a preview asks for
// the opposite on every page.
//
// Built from the SAME route table the pages use, so it cannot list a page the
// build did not produce.
import type { APIRoute } from "astro";

import { SEARCH_ROUTE } from "../deployment/route-inventory.ts";
import { siteEnvironment } from "../deployment/site-environment.ts";
import {
  publishableCandidates,
  serializeSitemap,
  sitemapCandidates,
  type SitemapSource,
} from "../rendering/sitemap-model.ts";
import { siteOrigin } from "../rendering/site-identity.ts";
import { loadSiteData } from "../routing/site-routes.ts";

export const GET: APIRoute = async () => {
  const site = await loadSiteData();
  const front = site.frontPage;
  const sources: SitemapSource[] = [
    {
      path: "/",
      kind: front?.kind ?? "static",
      lastModified:
        front?.kind === "page" ? front.entry.data.updatedAt : undefined,
    },
    { path: SEARCH_ROUTE, kind: "static" },
    ...site.routes.map((route) => ({
      path: route.path,
      kind: route.kind,
      // A listing has no `updatedAt` of its own — it changes when its items do,
      // and claiming one entry's date for the listing is a lie a crawler acts
      // on. Both listing kinds behave the same way.
      lastModified:
        route.kind === "archive" || route.kind === "custom-archive"
          ? undefined
          : route.entry.data.updatedAt,
    })),
  ];

  const candidates = sitemapCandidates(sources, {
    locale: site.locale,
    overrides: site.overrides,
    environment: siteEnvironment(),
  });

  return new Response(
    serializeSitemap(publishableCandidates(candidates), siteOrigin()),
    { headers: { "content-type": "application/xml; charset=utf-8" } },
  );
};
