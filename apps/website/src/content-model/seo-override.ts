// SEO override rows — one auditable table keyed by URL identity.
//
// Content entries carry no meta fields: rows exist for archive and utility
// URLs that have no content entry at all, which is precisely why this is a
// table and not a field. The global title template and the indexing model are
// not here either — the first is a rendering default, the second is the launch
// switch.
import { z } from "astro/zod";

import { localeCode, mediaRef, provenance } from "./shared.ts";

/**
 * The fix-or-preserve marker. Every row that reproduces — or deviates from —
 * a captured value states which, and why. `preserve` is the default: a row
 * seeded from the live site's export asserts nothing until somebody decides.
 */
export const seoDisposition = z
  .strictObject({
    state: z.enum(["preserve", "fix"]),
    note: z.string().min(1).optional(),
  })
  .default({ state: "preserve" });

/** Robots directives on a row. Read and reported, never applied. */
export const seoRobots = z.strictObject({
  noindex: z.boolean().default(false),
  nofollow: z.boolean().default(false),
});

export const seoOverrideSchema = z.strictObject({
  /** The URL path — the join key. A path, never an absolute URL. */
  path: z
    .string()
    .min(1)
    .regex(
      /^\/[^?#\s]*$/,
      "path must be a root-relative URL path, e.g. `/blog/`",
    ),
  locale: localeCode,
  /** Absent → the route's own title. */
  metaTitle: z.string().min(1).optional(),
  metaDescription: z.string().min(1).optional(),
  /** Override only; the default is self-referencing. */
  canonical: z.string().min(1).optional(),
  robots: seoRobots.optional(),
  ogImage: mediaRef.optional(),
  disposition: seoDisposition,
  source: provenance,
});
