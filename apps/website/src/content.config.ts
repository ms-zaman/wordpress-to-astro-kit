// Astro Content Layer collection definitions.
//
// Every collection maps to exactly one content set with exactly one schema.
// Schemas live in `src/content-model/`; storage is the root `content/` tree.
import { defineCollection } from "astro:content";
import { file, glob } from "astro/loaders";

import { navigationSchema } from "./content-model/navigation.ts";
import { pageSchema } from "./content-model/page.ts";
import { postSchema } from "./content-model/post.ts";
import {
  authorSchema,
  categorySchema,
  tagSchema,
} from "./content-model/registries.ts";
import { seoOverrideSchema } from "./content-model/seo-override.ts";

// Loader paths resolve against the Astro root (`apps/website/`).
const CONTENT = "../../content";

// Each content directory carries a README recording its owner. READMEs are
// boundary documentation, not entries, so every entry glob excludes them.
const MARKDOWN_ENTRIES = ["**/*.md", "!**/README.md"];
const DATA_ENTRIES = ["**/*.json", "!**/README.md"];

/** Pages — WordPress `page`. Front matter plus an HTML (or Markdown) body. */
const pages = defineCollection({
  loader: glob({ pattern: MARKDOWN_ENTRIES, base: `${CONTENT}/pages` }),
  schema: pageSchema,
});

/** Posts — WordPress `post`. */
const posts = defineCollection({
  loader: glob({ pattern: MARKDOWN_ENTRIES, base: `${CONTENT}/posts` }),
  schema: postSchema,
});

/** Author registry. */
const authors = defineCollection({
  loader: file(`${CONTENT}/authors.json`),
  schema: authorSchema,
});

/** Category registry. */
const categories = defineCollection({
  loader: file(`${CONTENT}/categories.json`),
  schema: categorySchema,
});

/** Tag registry. */
const tags = defineCollection({
  loader: file(`${CONTENT}/tags.json`),
  schema: tagSchema,
});

/** Navigation menus — one file per menu. */
const navigation = defineCollection({
  loader: glob({ pattern: DATA_ENTRIES, base: `${CONTENT}/navigation` }),
  schema: navigationSchema,
});

/**
 * Per-URL SEO override rows. A `file` loader over ONE array, keyed by
 * `path` + `locale`: Astro's file loader keys rows by `id` or `slug`, and an
 * override row has neither — rows exist for archive and utility URLs that are
 * not entries. The parser hands the loader the composite key the table
 * already defines.
 */
const seoOverride = defineCollection({
  loader: file(`${CONTENT}/seo/overrides.json`, {
    parser: (text) =>
      Object.fromEntries(
        (JSON.parse(text) as Array<{ path: string; locale: string }>).map(
          (row) => [`${row.path}@${row.locale}`, row],
        ),
      ),
  }),
  schema: seoOverrideSchema,
});

export const collections = {
  pages,
  posts,
  authors,
  categories,
  tags,
  navigation,
  seoOverride,
};
