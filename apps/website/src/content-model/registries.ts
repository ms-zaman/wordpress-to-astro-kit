// Registry schemas: authors, categories, tags. Registries are data rows, not
// entries — language-neutral, with per-locale display names where a name is
// shown.
import { z } from "astro/zod";

import { localizedName, mediaRef, provenance, slug } from "./shared.ts";

/**
 * Author registry — WordPress users who published something.
 *
 * `nicename` is WordPress's `user_nicename`, the segment its author archive is
 * keyed by (`/author/<nicename>/`). It is identity, and it is what the
 * `%nicename%` permalink token expands to; `slug` is this repository's key and
 * the two may differ. Optional because an author the live site publishes no
 * archive for has none — `slug` stands in.
 */
export const authorSchema = z.strictObject({
  slug,
  name: z.string().min(1),
  nicename: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9._-]+$/,
      "nicename must be a WordPress user_nicename URL segment",
    )
    .optional(),
  bio: z.string().min(1).optional(),
  avatar: mediaRef.optional(),
  /** External profile links, as displayed. */
  social: z
    .array(z.strictObject({ label: z.string().min(1), url: z.url() }))
    .min(1)
    .optional(),
  source: provenance.optional(),
});

export const categorySchema = z.strictObject({
  slug,
  name: localizedName,
  source: provenance.optional(),
});

export const tagSchema = z.strictObject({
  slug,
  name: localizedName,
  source: provenance.optional(),
});
