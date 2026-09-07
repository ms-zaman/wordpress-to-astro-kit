// /deployment.json — the build's deployment manifest: schema version, build
// metadata, the complete route inventory, a per-collection summary, and the
// open hosting decision. A DESCRIPTION, never a configuration.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

import redirectsJson from "../../../../content/redirects.json" with { type: "json" };
import { readEnvironment } from "../deployment/build-metadata.ts";
import {
  buildManifest,
  serializeManifest,
  type CollectionSummary,
} from "../deployment/manifest.ts";
import { parseRedirectMap } from "../deployment/redirects.ts";
import { processEnvironment } from "../deployment/site-environment.ts";
import {
  customArchiveIdentity,
  identityOf,
} from "../routing/route-identity.ts";
import { entryId, rowId } from "../deployment/content-identity.ts";
import type { IntendedContent } from "../deployment/content-integrity.ts";
import { loadSiteData } from "../routing/site-routes.ts";
import {
  pagePath,
  postPath,
  categoryPath,
  tagPath,
  authorPath,
  customTypePath,
  customTypeArchivePath,
  termPath,
} from "../routing/permalink.ts";

const redirectMap = parseRedirectMap(redirectsJson);

/**
 * A term's ancestor slugs, outermost first.
 *
 * Recomputed here rather than taken from the route table on purpose: this list
 * describes what the content tree INTENDS, and a term the resolver withheld
 * has no route to read a chain off. A broken chain yields an empty one, and
 * the resolver is the thing that fails on it.
 */
function ancestorSlugs(
  taxonomy: { readonly collection: string },
  term: { readonly slug: string; readonly parent?: string },
  rows: readonly { readonly slug: string; readonly parent?: string }[] = [],
): string[] {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const chain: string[] = [];
  const seen = new Set<string>([term.slug]);
  let current = term;
  while (current.parent !== undefined) {
    const parent = bySlug.get(current.parent);
    if (parent === undefined || seen.has(parent.slug)) break;
    seen.add(parent.slug);
    chain.unshift(parent.slug);
    current = parent;
  }
  return chain;
}

/**
 * A permalink, or nothing when the pattern cannot be expanded for this entry.
 *
 * `expandPattern` throws on a token it has no value for — a post with no
 * category under a `%category%` pattern, say. That is the right behaviour for
 * a route, and the wrong behaviour here: this field only tells a reader where
 * to LOOK for a missing page, and failing to compute a hint must never fail a
 * build that would otherwise succeed.
 */
function safePath(compute: () => string): string | undefined {
  try {
    return compute();
  } catch {
    return undefined;
  }
}

export const GET: APIRoute = async () => {
  const site = await loadSiteData();
  const [navigation] = await Promise.all([getCollection("navigation")]);

  const routedPages =
    site.routes.filter((route) => route.kind === "page").length +
    (site.frontPage?.kind === "page" ? 1 : 0);

  const collections: CollectionSummary[] = [
    { name: "posts", entries: site.allPosts.length, routed: site.posts.length },
    { name: "pages", entries: site.allPages.length, routed: routedPages },
    {
      name: "authors",
      entries: site.authors.length,
      routed: site.authors.length,
    },
    {
      name: "categories",
      entries: site.categories.length,
      routed: site.categories.length,
    },
    { name: "tags", entries: site.tags.length, routed: site.tags.length },
    ...site.postTypes.map((profile) => ({
      name: profile.collection,
      entries: (site.allCustom[profile.collection] ?? []).length,
      routed: (site.custom[profile.collection] ?? []).length,
    })),
    ...site.taxonomies.map((taxonomy) => ({
      name: taxonomy.collection,
      entries: (site.allTerms[taxonomy.collection] ?? []).length,
      routed: (site.terms[taxonomy.collection] ?? []).length,
    })),
    { name: "navigation", entries: navigation.length, routed: 0 },
    { name: "seoOverride", entries: site.overrides.length, routed: 0 },
  ];

  // Everything `content/` intends to publish, named. This is the half the
  // manifest never carried, and without it "did every entry arrive?" is not a
  // question the artifact can answer — see deployment/content-integrity.ts.
  //
  // ALL locales, deliberately: an entry this build does not route is exactly
  // the thing that used to vanish without trace, and it can only be reported
  // as withheld if it is named as intended first.
  const intended: IntendedContent[] = [
    ...site.allPosts.map((post) => ({
      id: entryId("posts", post.data.slug, post.data.locale),
      expectedRoute: safePath(() =>
        postPath(post.data, {
          authorNicename: site.authorOf(post.data.author)?.nicename,
        }),
      ),
    })),
    ...site.allPages.map((page) => ({
      id: entryId("pages", page.data.slug, page.data.locale),
      // The parent chain is unknown for an entry the resolver never routed,
      // so this hint is the flat path. It is a hint, not a claim.
      expectedRoute: safePath(() => pagePath(page.data.slug, [])),
    })),
    ...site.categories.map((row) => ({
      id: rowId("categories", row.slug),
      expectedRoute: safePath(() => categoryPath(row.slug)),
    })),
    ...site.tags.map((row) => ({
      id: rowId("tags", row.slug),
      expectedRoute: safePath(() => tagPath(row.slug)),
    })),
    ...site.authors.map((row) => ({
      id: rowId("authors", row.slug),
      expectedRoute: safePath(() => authorPath(row.nicename ?? row.slug)),
    })),
    // Custom post types. Every profile's entries, in EVERY locale and whether
    // or not the profile publishes them — which is the whole point: a type the
    // build withholds has to be NAMED as intended, or `content:integrity`
    // stays green because the entries never entered the inventory it joins on.
    ...site.postTypes.flatMap((profile) => [
      ...(site.allCustom[profile.collection] ?? []).map((entry) => ({
        id: entryId(profile.collection, entry.data.slug, entry.data.locale),
        expectedRoute: profile.published
          ? safePath(() => customTypePath(profile, entry.data))
          : undefined,
      })),
      // The listing, when the profile declares one. Structural like the posts
      // index: derived from the whole collection, not from one entry.
      ...(profile.published && profile.archive.kind === "archive"
        ? [
            {
              id: customArchiveIdentity(profile.collection),
              expectedRoute: safePath(() => customTypeArchivePath(profile)),
            },
          ]
        : []),
    ]),
    // Taxonomy terms. Every term of every profile, published or not — the
    // lesson this kit has now paid for twice: content that never enters the
    // intended inventory cannot be reported missing by anything downstream.
    ...site.taxonomies.flatMap((taxonomy) =>
      (site.allTerms[taxonomy.collection] ?? []).map((term) => ({
        id: rowId(taxonomy.collection, term.slug),
        expectedRoute: taxonomy.published
          ? safePath(() =>
              termPath(
                taxonomy,
                term.slug,
                ancestorSlugs(
                  taxonomy,
                  term,
                  site.allTerms[taxonomy.collection] ?? [],
                ),
              ),
            )
          : undefined,
      })),
    ),
  ];

  const manifest = buildManifest({
    resolved: site.routes.map((route) => ({
      path: route.path,
      kind: route.kind,
      page:
        route.kind === "archive" ||
        route.kind === "custom-archive" ||
        route.kind === "taxonomy-archive"
          ? route.page.page
          : undefined,
      entry: identityOf(route),
    })),
    // `/` is static, so the front page is not a resolved route — its identity
    // rides on the static route instead. Without this the home page entry
    // would be reported as intended-but-never-emitted.
    frontPageEntry:
      site.frontPage === undefined ? undefined : identityOf(site.frontPage),
    redirects: redirectMap.rules,
    collections,
    intended,
    locale: site.locale,
    postTypes: site.postTypes.map((profile) => ({
      name: profile.name,
      collection: profile.collection,
      published: profile.published,
      archive: profile.archive.kind,
      taxonomies: profile.taxonomies.attached,
    })),
    taxonomies: site.taxonomies.map((taxonomy) => ({
      name: taxonomy.name,
      collection: taxonomy.collection,
      published: taxonomy.published,
      appliesTo: taxonomy.appliesTo,
      hierarchical: taxonomy.hierarchical,
      urlHierarchy: taxonomy.urlHierarchy,
    })),
    environment: readEnvironment(processEnvironment()),
  });

  return new Response(serializeManifest(manifest), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
