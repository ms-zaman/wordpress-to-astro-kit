// Pages — WordPress's `page` type.
import { z } from "astro/zod";

import { bodyFormat, entryBase, slug } from "./shared.ts";

export const pageSchema = z.strictObject({
  ...entryBase,
  /** The page this one is published UNDER, by slug — WordPress's page hierarchy. */
  parent: slug.optional(),
  /** A form key from `src/forms/definitions.ts`, rendered under the body. */
  form: slug.optional(),
  /** Only where the source holds an explicit excerpt. */
  excerpt: z.string().min(1).optional(),
  bodyFormat,
});
