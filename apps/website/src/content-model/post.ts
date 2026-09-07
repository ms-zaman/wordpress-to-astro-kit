// Posts — WordPress's `post` type.
import { z } from "astro/zod";

import { bodyFormat, entryBase, isoDate, mediaRef, slug } from "./shared.ts";

export const postSchema = z.strictObject({
  ...entryBase,
  publishedAt: isoDate,
  /** Reference into the author registry (`content/authors.json`). */
  author: slug,
  /** WordPress assigns at least one category to every post (`Uncategorized` by default). */
  categories: z.array(slug).min(1),
  /** Tags are carried verbatim as data; the tag registry names them. */
  tags: z.array(z.string().min(1)).default([]),
  /** Only where the source holds an explicit excerpt; never derived at migration. */
  excerpt: z.string().min(1).optional(),
  featuredImage: mediaRef.optional(),
  bodyFormat,
});
