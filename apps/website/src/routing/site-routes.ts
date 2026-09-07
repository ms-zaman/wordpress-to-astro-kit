// The ONE module that reads `astro:content` for routing. Everything else in
// `src/routing/` is a pure function of plain objects, which is what lets the
// rendering contract execute the URL model without a build.
import { getCollection, type CollectionEntry } from "astro:content";

import { migration } from "../../../../migration.config.ts";
import { defaultLocale } from "../content-model/shared.ts";
import type { CustomTypeEntryData } from "../content-model/custom-type.ts";
import { resolveSiteRoutes, type SiteRouteTable } from "./resolver.ts";

export type PostEntry = CollectionEntry<"posts">;
export type PageEntry = CollectionEntry<"pages">;

/**
 * One entry of a custom post type.
 *
 * Not a `CollectionEntry<"...">`: the collection names come from
 * `migration.config.ts` and are therefore not known to Astro's generated
 * types. The SHAPE is known — every custom collection is defined with
 * `customTypeSchema` in `content.config.ts` — so this states it once, and the
 * single cast that bridges the two lives in `loadSiteData` with the reason
 * beside it.
 */
export interface CustomEntry {
  readonly id: string;
  readonly body?: string;
  readonly data: CustomTypeEntryData;
  readonly rendered?: { html?: string };
  readonly filePath?: string;
}

export type SiteRoutes = SiteRouteTable<PostEntry, PageEntry, CustomEntry>;

export interface SiteData extends SiteRoutes {
  readonly locale: string;
  readonly authors: readonly CollectionEntry<"authors">["data"][];
  readonly categories: readonly CollectionEntry<"categories">["data"][];
  readonly tags: readonly CollectionEntry<"tags">["data"][];
  readonly overrides: readonly CollectionEntry<"seoOverride">[];
  readonly allPosts: readonly PostEntry[];
  readonly allPages: readonly PageEntry[];
  /** Every custom-type entry in EVERY locale, by collection. */
  readonly allCustom: Readonly<Record<string, readonly CustomEntry[]>>;
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

  // Custom-type collections, by collection name. `getCollection` is typed
  // against Astro's generated collection names, and these come from
  // `migration.config.ts` — known to the build, not to the type generator. The
  // cast is here, once, rather than at every call site, and it is safe because
  // `content.config.ts` defines every one of these collections from the same
  // list with the same schema.
  const custom: Record<string, readonly CustomEntry[]> = {};
  const allCustom: Record<string, readonly CustomEntry[]> = {};
  for (const profile of migration.postTypes) {
    const entries = (await getCollection(
      profile.collection as Parameters<typeof getCollection>[0],
    )) as unknown as readonly CustomEntry[];
    allCustom[profile.collection] = entries;
    custom[profile.collection] = entries;
  }

  const table = resolveSiteRoutes<PostEntry, PageEntry, CustomEntry>({
    posts,
    pages,
    authors: authorRows,
    categories: categoryRows,
    tags: tagRows,
    custom,
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
    allCustom,
  };
}
