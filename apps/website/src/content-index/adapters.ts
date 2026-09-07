// Collection adapters: one per discoverable collection, each turning entries
// of ONE shape into `IndexedEntry`. Everything collection-specific about
// discovery lives here and nowhere downstream.
import { firstProseParagraph, postSummary } from "../rendering/post-view.ts";
import { truncateAtWord } from "../rendering/portable-body.ts";
import type {
  EntryLike,
  PageEntryData,
  PostEntryData,
} from "../routing/resolver.ts";
import type { IndexedEntry } from "./entry-model.ts";

/** How long a derived summary may be before it is cut at a word boundary. */
export const SUMMARY_MAX_LENGTH = 180;

export type HrefOf = (
  kind: "post" | "page",
  slug: string,
) => string | undefined;

export function indexPosts(
  entries: readonly EntryLike<PostEntryData>[],
  hrefOf: HrefOf,
): IndexedEntry[] {
  const indexed: IndexedEntry[] = [];
  for (const { data, body } of entries) {
    const href = hrefOf("post", data.slug);
    if (href === undefined) continue;
    indexed.push({
      kind: "post",
      slug: data.slug,
      locale: data.locale,
      title: data.title,
      href,
      summary: postSummary(data, body, SUMMARY_MAX_LENGTH),
      date: data.publishedAt,
      dateField: "publishedAt",
      categories: [...data.categories],
      tags: [...(data.tags ?? [])],
    });
  }
  return indexed;
}

export function indexPages(
  entries: readonly EntryLike<PageEntryData>[],
  hrefOf: HrefOf,
): IndexedEntry[] {
  const indexed: IndexedEntry[] = [];
  for (const { data, body } of entries) {
    const href = hrefOf("page", data.slug);
    if (href === undefined) continue;
    indexed.push({
      kind: "page",
      slug: data.slug,
      locale: data.locale,
      title: data.title,
      href,
      summary: truncateAtWord(
        data.excerpt ?? firstProseParagraph(body),
        SUMMARY_MAX_LENGTH,
      ),
      date: data.updatedAt,
      dateField: "updatedAt",
      categories: [],
      tags: [],
    });
  }
  return indexed;
}

export interface ContentSources {
  readonly posts?: readonly EntryLike<PostEntryData>[];
  readonly pages?: readonly EntryLike<PageEntryData>[];
  readonly hrefOf: HrefOf;
}

/** The whole discoverable index, unfiltered and unsorted. */
export function buildContentIndex(sources: ContentSources): IndexedEntry[] {
  return [
    ...indexPosts(sources.posts ?? [], sources.hrefOf),
    ...indexPages(sources.pages ?? [], sources.hrefOf),
  ];
}
