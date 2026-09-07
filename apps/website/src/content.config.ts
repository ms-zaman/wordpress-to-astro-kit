// Astro Content Layer collection definitions.
//
// Every collection maps to exactly one content set with exactly one schema.
// Schemas live in `src/content-model/`; storage is the root `content/` tree.
import { defineCollection } from "astro:content";
import { file, glob } from "astro/loaders";

import { migration } from "../../../migration.config.ts";
import { customTypeSchema } from "./content-model/custom-type.ts";
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

/**
 * The entry id comes from the FILE PATH, never from the front matter.
 *
 * Astro's `glob` loader defaults to using a `slug` field when the front matter
 * has one, and this kit's content model has one on every entry — so the
 * default made the id a value the content chooses rather than a value the tree
 * guarantees.
 *
 * That collides with a rule the content contract enforces in the opposite
 * direction: **a translation cluster shares one untranslated slug**, because
 * the slug identifies the page and the language identifies the version. Two
 * files with `slug: about` and different locales are exactly what a translated
 * corpus looks like, and under the default loader one of them silently won and
 * the other was never loaded at all.
 *
 * Measured: with `about.md` (en), `sobre.md` (pt-BR) and `guanyu.md` (zh-Hans)
 * all carrying `slug: about`, `getCollection("pages")` returned ONE of the
 * three. The build then failed on an unrelated symptom — a child page whose
 * parent "is not a en page" — because the survivor was a translation the
 * locale filter removed.
 *
 * This is upstream of every gate, including `content-integrity`: an entry that
 * never loads is never intended, so nothing downstream can miss it. The fix
 * belongs here, at the loader, where identity is assigned.
 */
const idFromPath = ({ entry }: { entry: string }): string =>
  entry.replace(/\.[^./]+$/, "");

/** Pages — WordPress `page`. Front matter plus an HTML (or Markdown) body. */
const pages = defineCollection({
  loader: glob({
    pattern: MARKDOWN_ENTRIES,
    base: `${CONTENT}/pages`,
    generateId: idFromPath,
  }),
  schema: pageSchema,
});

/** Posts — WordPress `post`. */
const posts = defineCollection({
  loader: glob({
    pattern: MARKDOWN_ENTRIES,
    base: `${CONTENT}/posts`,
    generateId: idFromPath,
  }),
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

/**
 * One collection per PUBLISHED custom post type, from `migration.config.ts`.
 *
 * Built from the profiles rather than written out, because the whole point of
 * a profile is that adding a type is a configuration change. Unpublished types
 * still get a collection: their entries are content, they are validated, they
 * are named in the deployment manifest as intended, and `content:integrity`
 * reports each one as withheld. A type that is not routed is not a type that
 * is forgotten.
 */
const customTypeCollections = Object.fromEntries(
  migration.postTypes.map((profile) => [
    profile.collection,
    defineCollection({
      loader: glob({
        pattern: MARKDOWN_ENTRIES,
        base: `${CONTENT}/${profile.collection}`,
        generateId: idFromPath,
      }),
      schema: customTypeSchema,
    }),
  ]),
);

export const collections = {
  ...customTypeCollections,
  pages,
  posts,
  authors,
  categories,
  tags,
  navigation,
  seoOverride,
};
