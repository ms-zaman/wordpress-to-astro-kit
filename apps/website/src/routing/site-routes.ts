// The ONE module that reads `astro:content` for routing. Everything else in
// `src/routing/` is a pure function of plain objects, which is what lets the
// rendering contract execute the URL model without a build.
import { getCollection, type CollectionEntry } from "astro:content";

import { defaultLocale } from "../content-model/shared.ts";
import { resolveSiteRoutes, type SiteRouteTable } from "./resolver.ts";

export type PostEntry = CollectionEntry<"posts">;
export type PageEntry = CollectionEntry<"pages">;
export type SiteRoutes = SiteRouteTable<PostEntry, PageEntry>;

export interface SiteData extends SiteRoutes {
  readonly locale: string;
  readonly authors: readonly CollectionEntry<"authors">["data"][];
  readonly categories: readonly CollectionEntry<"categories">["data"][];
  readonly tags: readonly CollectionEntry<"tags">["data"][];
  readonly overrides: readonly CollectionEntry<"seoOverride">[];
  readonly allPosts: readonly PostEntry[];
  readonly allPages: readonly PageEntry[];
}

/**
 * Everything a page needs to know about the site's routes, read once per
 * page. Astro caches `getCollection` within a build, so every route calling
 * this is a cache hit, not a re-read.
 */
export async function loadSiteData(
  locale: string = defaultLocale,
): Promise<SiteData> {
  const [posts, pages, authors, categories, tags, overrides] =
    await Promise.all([
      getCollection("posts"),
      getCollection("pages"),
      getCollection("authors"),
      getCollection("categories"),
      getCollection("tags"),
      getCollection("seoOverride"),
    ]);
  const authorRows = authors.map((entry) => entry.data);
  const categoryRows = categories.map((entry) => entry.data);
  const tagRows = tags.map((entry) => entry.data);
  const table = resolveSiteRoutes<PostEntry, PageEntry>({
    posts,
    pages,
    authors: authorRows,
    categories: categoryRows,
    tags: tagRows,
    locale,
  });
  return {
    ...table,
    locale,
    authors: authorRows,
    categories: categoryRows,
    tags: tagRows,
    overrides,
    allPosts: posts,
    allPages: pages,
  };
}
