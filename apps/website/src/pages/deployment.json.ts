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
import { loadSiteData } from "../routing/site-routes.ts";

const redirectMap = parseRedirectMap(redirectsJson);

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
    { name: "navigation", entries: navigation.length, routed: 0 },
    { name: "seoOverride", entries: site.overrides.length, routed: 0 },
  ];

  const manifest = buildManifest({
    resolved: site.routes.map((route) => ({
      path: route.path,
      kind: route.kind,
      page: route.kind === "archive" ? route.page.page : undefined,
    })),
    redirects: redirectMap.rules,
    collections,
    environment: readEnvironment(processEnvironment()),
  });

  return new Response(serializeManifest(manifest), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
