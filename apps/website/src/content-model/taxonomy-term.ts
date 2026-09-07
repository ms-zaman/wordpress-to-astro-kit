// A custom taxonomy's terms — one registry file per taxonomy.
//
// ## The fields, and why exactly these
//
// Measured against WordPress's own REST schema
// (`class-wp-rest-terms-controller.php`, 2026-09-08), which returns:
//
//     id  count  description  link  name  slug  taxonomy   (+ parent, and
//     `parent` ONLY when the taxonomy is hierarchical)
//
// Of those, four are content and three are not:
//
//   * `name`, `slug`, `description`, `parent` — what a term IS. Kept.
//   * `id` — the SOURCE's primary key. Kept as `sourceId`, optional, because
//     it is the only thing that survives a slug being edited on the source
//     site and it is what a re-capture matches on. It is never a URL.
//   * `count` — a fact about the source's database at capture time, not about
//     this build. The archive counts its own entries.
//   * `link` — the source's URL. It belongs in the CAPTURE, where it is
//     evidence a profile can be checked against, not in the content tree
//     where it would be a second, stale answer to a question `permalink`
//     already answers.
//   * `taxonomy` — implied by the file the term is in.
//
// `name` and `description` are per-locale maps, matching the categories and
// tags registries this kit already has: a term is one thing with a name in
// each language, not one thing per language.
import { z } from "astro/zod";

import { localeCode, slug } from "./shared.ts";

/**
 * A per-locale string that must at least cover the default locale.
 *
 * Reuses the rule the core registries use, so a custom taxonomy behaves like
 * `categories.json` rather than like a second, subtly different thing.
 */
const localised = z.partialRecord(localeCode, z.string().min(1));

export const taxonomyTermSchema = z.strictObject({
  slug,
  /**
   * The parent term's SLUG, for a hierarchical taxonomy.
   *
   * A slug and not an id, because the rest of the content tree refers to
   * things by slug and an id would be the only foreign key in it. WordPress
   * gives `parent` as an id; the capture resolves it.
   */
  parent: slug.optional(),
  name: localised,
  description: localised.optional(),
  /**
   * The source site's term id.
   *
   * Optional, and never used to build a URL. It exists so a re-capture can
   * recognise a term whose slug or name was edited on the source — the one
   * thing a slug cannot do.
   */
  sourceId: z.number().int().positive().optional(),
});

export type TaxonomyTerm = z.infer<typeof taxonomyTermSchema>;
export const taxonomyTermsSchema = z.array(taxonomyTermSchema);
