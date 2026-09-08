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

import { entityProvenance, mediaRef, slug } from "./shared.ts";
import { taxonomyTermSchema } from "./taxonomy-term.ts";

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

/**
 * Category and tag registries — WordPress's `category` and `post_tag` terms.
 *
 * Aliases for `taxonomyTermSchema`, and that is the unification: these two used
 * to be a schema of their own with no `parent` field, so a nested category —
 * which WordPress has by default — could not be represented and was silently
 * flattened. The names are kept because they say which registry a caller
 * means, and `routing/taxonomies.ts` carries the semantics that differ.
 */
export const categorySchema = taxonomyTermSchema;
export const tagSchema = taxonomyTermSchema;
