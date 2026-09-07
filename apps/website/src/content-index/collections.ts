// The content index, built from the real collections through the route
// table — so an indexed entry's href is the URL the resolver publishes it at.
import { loadSiteData } from "../routing/site-routes.ts";
import { buildContentIndex } from "./adapters.ts";
import type { IndexedEntry } from "./entry-model.ts";

export async function loadContentIndex(): Promise<IndexedEntry[]> {
  const site = await loadSiteData();
  return buildContentIndex({
    posts: site.allPosts,
    pages: site.allPages,
    hrefOf: site.hrefOf,
  });
}
