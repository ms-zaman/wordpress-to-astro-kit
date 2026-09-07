// /media-manifest.json — every preserved upload the site depends on, and the
// external hosts the migrated corpus points at. The media library stays where
// it is; this is the list to mirror, and to verify a media cutover against.
import type { APIRoute } from "astro";

import {
  collectMediaRefs,
  inlineEmojiImages,
  isPreservedMedia,
  mediaOrigin,
  mediaUrl,
} from "../rendering/media.ts";
import { loadSiteData } from "../routing/site-routes.ts";

const EXTERNAL = /\b(?:src|href)=["'](https?:\/\/[^"']+)["']/gi;

export const GET: APIRoute = async () => {
  const site = await loadSiteData();

  const uploads = new Set<string>();
  const externalHosts = new Map<string, number>();
  const origin = mediaOrigin();
  const note = (url: string) => {
    if (isPreservedMedia(url)) uploads.add(mediaUrl(url, origin));
    else if (
      /\.(?:png|jpe?g|gif|webp|avif|svg|mp4|webm|pdf)(?:\?|$)/i.test(url)
    ) {
      const host = new URL(url).host;
      externalHosts.set(host, (externalHosts.get(host) ?? 0) + 1);
    }
  };

  for (const entry of [...site.allPosts, ...site.allPages]) {
    if (entry.data.locale !== site.locale) continue;
    const body = inlineEmojiImages(entry.body ?? "");
    for (const ref of collectMediaRefs(body)) note(ref);
    for (const match of body.matchAll(EXTERNAL)) note(match[1] ?? "");
  }
  for (const post of site.posts) {
    const featured = post.data.featuredImage;
    if (featured) {
      note(featured.url);
      for (const variant of featured.variants ?? []) note(variant.url);
    }
  }
  for (const author of site.authors) if (author.avatar) note(author.avatar.url);

  const manifest = {
    mediaOrigin: origin ?? null,
    uploads: [...uploads].sort(),
    uploadCount: uploads.size,
    externalHosts: Object.fromEntries(
      [...externalHosts.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
  };

  return new Response(`${JSON.stringify(manifest, null, 2)}\n`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
