// Registry schemas: authors, categories, tags. Registries are data rows, not
// entries — language-neutral, with per-locale display names where a name is
// shown.
//
// `source` is REQUIRED on every row, and it was optional until provenance
// became a property the kit checks. A registry row is a source entity — a
// WordPress user, a `category` term, a `post_tag` term — and "every source
// entity has provenance" is an invariant a schema can hold at the earliest
// boundary there is, so it holds it here rather than leaving a downstream gate
// to report an origin nobody stated. Writing `{ "system": "authored" }` is the
// declaration that a row has no WordPress entity behind it, and saying so is
// the point: an unstated origin and a deliberate one used to look identical.
import { z } from "astro/zod";

import { entityProvenance, localizedName, mediaRef, slug } from "./shared.ts";

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
  source: entityProvenance,
});

export const categorySchema = z.strictObject({
  slug,
  name: localizedName,
  source: entityProvenance,
});

export const tagSchema = z.strictObject({
  slug,
  name: localizedName,
  source: entityProvenance,
});
