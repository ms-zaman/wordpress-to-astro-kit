// /search-index.json — the static search index: plain JSON, no provider
// format, derived from the content index at build time. Sorted by identity
// and undated, so the file changes only when the content does.
import type { APIRoute } from "astro";

import { buildContentIndex } from "../content-index/adapters.ts";
import { loadSiteData } from "../routing/site-routes.ts";
import { buildSearchIndex } from "../search/search-document.ts";

export const GET: APIRoute = async () => {
  const site = await loadSiteData();
  const index = buildSearchIndex(
    buildContentIndex({
      posts: site.allPosts,
      pages: site.allPages,
      hrefOf: site.hrefOf,
    }),
    { locale: site.locale },
  );

  return new Response(`${JSON.stringify(index, null, 2)}\n`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
