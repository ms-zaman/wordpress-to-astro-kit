// Which piece of content produced a route.
//
// The route table already holds the entry or registry row behind every route
// it builds — this only reads it back out as a name, so the deployment
// manifest can carry it and the content-integrity gate can join on it.
//
// Kept beside the resolver rather than in `deployment/` because it is the
// resolver's knowledge: only this layer knows that a category archive comes
// from a `categories` row and that page two of one comes from the same row.
import {
  entryId,
  rowId,
  type ContentId,
} from "../deployment/content-identity.ts";
import type {
  ArchiveRoute,
  EntryLike,
  PageEntryData,
  PostEntryData,
  SiteRoute,
} from "./resolver.ts";

/**
 * The posts listing, which no single entry produces.
 *
 * A category archive comes from a category row and must name it, or a
 * vanished category is invisible. The posts listing is different in kind: it
 * is derived from the whole collection and exists whenever any post does, the
 * way `/search` does. Giving it a name that is obviously not a content
 * identity — the `@` prefix is not legal in one — lets the integrity gate
 * accept it as structural without also accepting a category archive that
 * forgot its row.
 */
export const POSTS_INDEX_IDENTITY = "@posts-index";

/** Structural routes carry a reserved name rather than a content identity. */
export function isStructuralIdentity(id: ContentId): boolean {
  return id.startsWith("@");
}

function archiveIdentity<
  Post extends EntryLike<PostEntryData>,
  Page extends EntryLike<PageEntryData>,
>(route: ArchiveRoute<Post, Page>): ContentId {
  switch (route.archive) {
    case "category":
      return rowId("categories", route.term?.slug ?? "");
    case "tag":
      return rowId("tags", route.term?.slug ?? "");
    case "author":
      return rowId("authors", route.author?.slug ?? "");
    case "posts":
      // The page that supplies the listing's title, when one exists, is still
      // an entry that has to arrive — WordPress renders it at the listing's
      // URL rather than at its own, and without this it would look withheld.
      return route.indexPage === undefined
        ? POSTS_INDEX_IDENTITY
        : entryId(
            "pages",
            route.indexPage.data.slug,
            route.indexPage.data.locale,
          );
  }
}

/** The content identity behind one resolved route. */
export function identityOf<
  Post extends EntryLike<PostEntryData>,
  Page extends EntryLike<PageEntryData>,
>(route: SiteRoute<Post, Page>): ContentId {
  switch (route.kind) {
    case "page":
      return entryId("pages", route.entry.data.slug, route.entry.data.locale);
    case "post":
      return entryId("posts", route.entry.data.slug, route.entry.data.locale);
    case "archive":
      return archiveIdentity(route);
  }
}
