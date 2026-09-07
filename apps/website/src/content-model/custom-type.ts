// Custom post types — WordPress's `register_post_type`, whatever it was called.
//
// ## One schema, on purpose
//
// A custom type is a WordPress type with a different name, not a different KIND
// of thing: it has a title, a body, a slug, a date and some terms, the same as
// a post. What differs between two installs is the FIELDS a plugin attached to
// it, and that difference is exactly what this kit cannot guess.
//
// So the schema is the shared entry base plus the two things a custom type
// genuinely adds, and it is a `strictObject`. That is the mechanism for Part
// 7 of the contract: **a field this schema cannot represent fails validation by
// name** rather than being silently dropped on the way in. A capture carrying
// `price`, `sku` or an ACF group does not quietly become a page missing them —
// the content contract refuses it and says which key it did not recognise.
//
// When your type genuinely needs those fields, that is a schema of your own:
// copy this file, add them, and register it in `content.config.ts` against your
// collection. The generic path is the floor, not the ceiling.
import { z } from "astro/zod";

import { bodyFormat, entryBase, isoDate, slug } from "./shared.ts";

export const customTypeSchema = z.strictObject({
  ...entryBase,
  /**
   * When the source published it.
   *
   * Optional because WordPress gives every post type a date but not every
   * custom type MEANS anything by it — a glossary term has no publication
   * order. Required by any profile whose permalink uses a date token, and
   * `expandPattern` throws by name when one is missing rather than emitting a
   * URL with a hole in it.
   */
  publishedAt: isoDate.optional(),
  /**
   * Taxonomy terms as the source site attached them, keyed by taxonomy name.
   *
   * Stored because they are real content and a template may want to print
   * them. **No archive is published for them** — the kit routes taxonomies for
   * posts only, and `migration.config.ts` refuses a profile that claims
   * otherwise. Recorded rather than routed, and the difference is stated.
   */
  terms: z.record(z.string(), z.array(slug)).optional(),
  /** Only where the source holds an explicit excerpt. */
  excerpt: z.string().min(1).optional(),
  bodyFormat,
});

export type CustomTypeEntryData = z.infer<typeof customTypeSchema>;
