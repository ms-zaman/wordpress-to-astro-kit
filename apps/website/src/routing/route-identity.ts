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
import {
  provenanceOfDerived,
  provenanceOfEntity,
  type Provenance,
  type TypeVocabulary,
} from "../content-model/provenance.ts";
import type {
  ArchiveRoute,
  CustomEntryData,
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

/**
 * A custom type's listing, which lists a whole collection.
 *
 * Structural for the same reason the posts index is: it is derived from every
 * entry of the type, not from one of them. Named per collection so two
 * listings are two identities.
 */
export function customArchiveIdentity(collection: string): ContentId {
  return `@archive/${collection}`;
}

/** The content identity behind one resolved route. */
export function identityOf<
  Post extends EntryLike<PostEntryData>,
  Page extends EntryLike<PageEntryData>,
  Custom extends EntryLike<CustomEntryData>,
>(route: SiteRoute<Post, Page, Custom>): ContentId {
  switch (route.kind) {
    case "page":
      return entryId("pages", route.entry.data.slug, route.entry.data.locale);
    case "post":
      return entryId("posts", route.entry.data.slug, route.entry.data.locale);
    case "custom":
      // The COLLECTION, so the identity matches the one the content tree
      // produces — `products/analyser@en`, never `product/analyser@en`.
      return entryId(
        route.profile.collection,
        route.entry.data.slug,
        route.entry.data.locale,
      );
    case "custom-archive":
      return customArchiveIdentity(route.profile.collection);
    case "taxonomy-archive":
      // A registry row, like a category: `product-categories/laptops`. The
      // taxonomy's own collection is the namespace, which is what keeps the
      // same slug in two taxonomies apart — WordPress allows that duplicate
      // and this identity has to survive it.
      return rowId(route.taxonomy.collection, route.term.slug);
    case "archive":
      return archiveIdentity(route);
  }
}

// ---------------------------------------------------------------------------
// Provenance — the same question one layer further back.
// ---------------------------------------------------------------------------

/**
 * Where the thing behind one resolved route came from.
 *
 * `identityOf` answers "which local entity does this route publish?".  This
 * answers "and what was that entity, on the source site?" — and it answers it
 * HERE, at the resolver, because this is the last layer that still holds the
 * entry, the profile and the configuration together. Every layer after it has
 * a path and a name, and inferring provenance from a URL is precisely the
 * guess this module exists to make unnecessary.
 *
 * A term archive's provenance is the TERM's: the archive is generated, but it
 * is generated for one source entity with an id of its own, so
 * `/product-category/laptops/` can name `wp:term/product_cat#7`. Only the two
 * listings that belong to no single entity — the posts index and a custom
 * type's archive — are derived entities in their own right.
 */
export function provenanceOf<
  Post extends EntryLike<PostEntryData>,
  Page extends EntryLike<PageEntryData>,
  Custom extends EntryLike<CustomEntryData>,
>(
  route: SiteRoute<Post, Page, Custom>,
  vocabulary: TypeVocabulary,
  postsIndexDeclaredBy = "permalinks.postsIndex",
): Provenance | undefined {
  const local = identityOf(route);
  const entity = (
    collection: string,
    source:
      { system: string; sourceId?: string; capturedAt?: string } | undefined,
    locale?: string,
  ): Provenance | undefined =>
    provenanceOfEntity({ local, collection, locale, source, vocabulary });

  switch (route.kind) {
    case "page":
      return entity("pages", route.entry.data.source, route.entry.data.locale);
    case "post":
      return entity("posts", route.entry.data.source, route.entry.data.locale);
    case "custom":
      return entity(
        route.profile.collection,
        route.entry.data.source,
        route.entry.data.locale,
      );
    case "taxonomy-archive":
      // A registry row, so no locale: one term carries a name per language.
      return entity(route.taxonomy.collection, route.term.source);
    case "custom-archive":
      return provenanceOfDerived(local, {
        kind: "type-archive",
        collection: route.profile.collection,
        declaredBy: `postTypes["${route.profile.name}"].archive`,
      });
    case "archive":
      switch (route.archive) {
        case "category":
          return entity("categories", route.term?.source);
        case "tag":
          return entity("tags", route.term?.source);
        case "author":
          return entity("authors", route.author?.source);
        case "posts":
          // The posts listing is derived UNLESS a page supplies its title, in
          // which case that page is a real source entity published at the
          // listing's URL — which is what WordPress itself does.
          return route.indexPage === undefined
            ? provenanceOfDerived(local, {
                kind: "posts-index",
                collection: "posts",
                declaredBy: postsIndexDeclaredBy,
              })
            : entity(
                "pages",
                route.indexPage.data.source,
                route.indexPage.data.locale,
              );
      }
  }
}
