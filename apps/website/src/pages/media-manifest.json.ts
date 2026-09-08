// /media-manifest.json — every asset this site depends on, and where each one
// stands. The list to mirror during a media cutover, and to verify one against.
//
// ## Why this is built on the media engine
//
// It used to make the engine's decisions again, with weaker rules: its own
// external-vs-local test, its own host parse, and its own extension allowlist
// — `png|jpe?g|gif|webp|avif|svg|mp4|webm|pdf` — which quietly assumed every
// asset is an image or a PDF, so a font, a `.zip` or a `.docx` the source site
// linked was absent from the mirror list.
//
// It also read `allPosts` and `allPages` only, so a custom post type's images
// were invisible to it, and it skipped entries whose locale this build does
// not publish — which is exactly backwards for a MIRROR list: media has to be
// copied before a locale can ever be built.
//
// One classifier now answers "what is this reference", here and everywhere.
import type { APIRoute } from "astro";

import { migration } from "../../../../migration.config.ts";
import {
  identifyAsset,
  type AssetClass,
  type AssetIdentity,
} from "../media/asset-identity.ts";
import { assetReferencesIn } from "../media/references.ts";
import { inlineEmojiImages, mediaOrigin } from "../rendering/media.ts";
import { loadSiteData } from "../routing/site-routes.ts";

export const GET: APIRoute = async () => {
  const site = await loadSiteData();
  const origin = mediaOrigin();
  const profile = migration.media;

  const seen: AssetIdentity[] = [];
  const note = (url: string): void => {
    if (url.trim() === "") return;
    seen.push(identifyAsset(url, profile));
  };

  // Every entry of every collection, in EVERY locale. A mirror list that
  // skipped a language would be a list that breaks the day that language is
  // built.
  const entries = [
    ...site.allPosts,
    ...site.allPages,
    ...Object.values(site.allCustom).flat(),
  ];
  for (const entry of entries) {
    // `assetReferencesIn` applies the shared `href` rule: a link to a page is
    // not media, and reporting every one of them as unsupported would bury the
    // references a person actually has to act on before a cutover.
    for (const { identity } of assetReferencesIn(
      inlineEmojiImages(entry.body ?? ""),
      profile,
    ))
      seen.push(identity);
  }

  // Media a schema names rather than a body: the featured image and its
  // renditions, an author's avatar, an SEO override's social image.
  for (const post of site.allPosts) {
    const featured = post.data.featuredImage;
    if (featured === undefined) continue;
    note(featured.url);
    for (const variant of featured.variants ?? []) note(variant.url);
  }
  for (const author of site.authors) if (author.avatar) note(author.avatar.url);
  for (const override of site.overrides)
    if (override.data.ogImage) note(override.data.ogImage.url);

  /** One row per distinct asset, however many references named it. */
  const owned = new Map<string, { local: string; references: number }>();
  const externalHosts = new Map<string, number>();
  const unsupported = new Map<string, string>();

  for (const identity of seen) {
    if (identity.key !== undefined && identity.local !== undefined) {
      const row = owned.get(identity.key);
      if (row === undefined)
        owned.set(identity.key, { local: identity.local, references: 1 });
      else row.references += 1;
      continue;
    }
    if (identity.classification === "EXTERNAL") {
      const host = identity.host ?? "";
      if (host !== "")
        externalHosts.set(host, (externalHosts.get(host) ?? 0) + 1);
      continue;
    }
    if (identity.reason !== undefined)
      unsupported.set(identity.source, identity.reason);
  }

  const counts: Partial<Record<AssetClass, number>> = {};
  for (const identity of seen)
    counts[identity.classification] =
      (counts[identity.classification] ?? 0) + 1;

  const manifest = {
    /** The host serving whatever was NOT copied. */
    mediaOrigin: origin ?? null,
    /** Where copied assets are served from, so a mirror knows the shape. */
    localBase: profile.localBase,
    /** How many references fell into each class — the discovery summary. */
    references: counts,
    /** One entry per distinct asset, sorted so two builds are identical. */
    assets: [...owned]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, row]) => ({
        key,
        local: row.local,
        references: row.references,
      })),
    assetCount: owned.size,
    /** Hosts the corpus points at and this build does not migrate from. */
    externalHosts: Object.fromEntries(
      [...externalHosts].sort(([left], [right]) => left.localeCompare(right)),
    ),
    /**
     * References the engine will not act on, each with the reason.
     *
     * Published rather than dropped: a reference nobody can classify is
     * exactly the thing a person needs to see before a cutover, and a manifest
     * that silently omitted it would read as a clean bill of health.
     */
    unsupported: Object.fromEntries(
      [...unsupported].sort(([left], [right]) => left.localeCompare(right)),
    ),
  };

  return new Response(`${JSON.stringify(manifest, null, 2)}\n`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
