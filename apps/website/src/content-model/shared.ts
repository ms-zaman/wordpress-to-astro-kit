// Shared schema primitives — the vocabulary every collection is built from.
//
// A schema change is a contract change: the capture pipeline imports these
// modules rather than restating field lists, so extraction validates against
// the same shapes the build renders.
import { z } from "astro/zod";

import localeRegistryData from "../../../../content/config/locales.json" with { type: "json" };
import { migration } from "../../../../migration.config.ts";
import { identifyAsset, resolveMediaProfile } from "../media/asset-identity.ts";
import {
  CLUSTER_KEY,
  CLUSTER_KEY_MESSAGE,
  SLUG,
  SLUG_MESSAGE,
} from "./slug.ts";

/**
 * A locale code, in the form an `<html lang>` attribute takes.
 *
 * `language[-Script][-REGION]`: `en`, `bn`, `pt-BR`, `zh-Hans`, `en-GB`,
 * `zh-Hant-TW`. This was `/^[a-z]{2}$/`, which is not a description of
 * anything — it rejects `pt-BR`, `zh-Hans` and `en-GB`, three of the forms a
 * WordPress site is most likely to publish, and a kit that cannot name a
 * locale cannot route it, exclude it, or report on it honestly.
 *
 * This is deliberately NOT full BCP-47. Variants, extensions and private-use
 * subtags are refused, because nothing in the kit does anything with them and
 * accepting a tag it cannot act on is the same lie as a config field nothing
 * reads. The kit still builds ONE locale at a time — see the route resolver —
 * and widening this regex does not change that; it makes the one locale
 * nameable.
 *
 * The underscore form is refused on purpose. WordPress stores `pt_BR` in
 * `WPLANG` and serves `pt-BR` in `<html lang>`, and somebody will paste the
 * first. Silently accepting it would put an invalid language tag in every
 * page's markup, which no validator here would catch and every consumer would.
 */
const LOCALE_CODE =
  /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/;

const LOCALE_CODE_MESSAGE =
  'locale code must be an HTML language tag: "en", "pt-BR", "zh-Hans", ' +
  '"en-GB". WordPress\'s underscore form ("pt_BR") is not one — use the hyphen.';

/** Locale registry — the single place the language set exists. */
const localeRegistrySchema = z.strictObject({
  defaultLocale: z.string(),
  locales: z
    .array(
      z.strictObject({
        code: z.string().regex(LOCALE_CODE, LOCALE_CODE_MESSAGE),
        hreflang: z.array(z.string().min(2)).min(1),
        label: z.string().min(1),
      }),
    )
    .min(1),
});

export const localeRegistry = localeRegistrySchema.parse(localeRegistryData);

export const localeCodes = localeRegistry.locales.map((entry) => entry.code);

if (!localeCodes.includes(localeRegistry.defaultLocale)) {
  throw new Error(
    `Locale registry: defaultLocale "${localeRegistry.defaultLocale}" is not present in locales[].`,
  );
}

/**
 * Locale identity. Derived from the registry, never hard-coded — adding a
 * language is a registry row, not a code change.
 */
export const localeCode = z.enum(localeCodes as [string, ...string[]]);

export const defaultLocale = localeRegistry.defaultLocale;

/**
 * ISO-8601 date. YAML front matter parses an unquoted `2026-01-15` into a
 * Date object while JSON data carries a string; both are accepted and
 * normalised to the `YYYY-MM-DD` string, so consumers see one type.
 */
export const isoDate = z
  .union([z.iso.date(), z.date()])
  .transform((value) =>
    value instanceof Date ? value.toISOString().slice(0, 10) : value,
  );

/**
 * URL-segment identity: immutable, extracted from the source, never derived.
 *
 * The alphabet lives in `./slug.ts` because the content transform needs the
 * same answer and used to carry its own copy of it. Both copies described the
 * Latin alphabet, and a site publishing in any other script lost rows to them.
 */
export const slug = z.string().min(1).regex(SLUG, SLUG_MESSAGE);

/** Language-neutral cluster identity: `<set>/<source-slug>`. */
export const clusterKey = z.string().regex(CLUSTER_KEY, CLUSTER_KEY_MESSAGE);

/**
 * Provenance — where an entry came from. `wordpress` entries record the
 * source id and capture date so a drift re-capture has a key; `authored`
 * entries were written in this repository; `sample` entries are the kit's
 * own, and a production build fails while any remain.
 */
export const provenance = z
  .strictObject({
    system: z.enum(["wordpress", "authored", "sample"]),
    sourceId: z.string().min(1).optional(),
    capturedAt: isoDate.optional(),
    authoringModel: z
      .enum(["gutenberg", "classic", "elementor", "html", "markdown"])
      .optional(),
  })
  .refine(
    (value) =>
      value.system !== "wordpress" ||
      (Boolean(value.sourceId) && Boolean(value.capturedAt)),
    {
      message:
        "a WordPress-sourced entry records sourceId and capturedAt, so it can be reconciled and re-captured",
      path: ["sourceId"],
    },
  );

/**
 * Provenance for a SOURCE ENTITY — a post, a page, a term, a user.
 *
 * The same block, with one more rule: a WordPress-sourced entity records its
 * WordPress primary key, and those are positive integers. `wp_posts.ID`,
 * `wp_terms.term_id` and `wp_users.ID` are all `bigint(20) unsigned`, so a
 * slug, a URL or a path in this field names nothing on the source site — and
 * the whole value of a source identity is that it survives a slug being
 * edited, which a slug obviously cannot.
 *
 * Bare `provenance` stays loose because two content sets that are NOT source
 * entities use it: an SEO override row is keyed by URL, and a navigation menu
 * is a `wp_term_taxonomy` row for `nav_menu` whose items are not entities of
 * this content tree. Those keep a free-form capture key on purpose.
 */
export const entityProvenance = provenance.refine(
  (value) =>
    value.system !== "wordpress" || /^[1-9][0-9]*$/.test(value.sourceId ?? ""),
  {
    message:
      "a WordPress source entity is identified by its primary key, a positive " +
      "integer (wp_posts.ID, wp_terms.term_id, wp_users.ID). A slug or a URL " +
      "here is not a stable identity: it changes when somebody renames the " +
      "thing, which is the exact case a source id exists to survive.",
    path: ["sourceId"],
  },
);

/** How a body is rendered: WordPress's HTML verbatim (the default), or Markdown. */
export const bodyFormat = z.enum(["html", "markdown"]).default("html");

/**
 * A media reference, judged by the SAME authority the media engine uses.
 *
 * ## What this replaces, and why it mattered
 *
 * This schema used to carry its own uploads regex —
 * `^(?:<liveOrigin>)?/wp-content/uploads/[^?#]+$` plus a
 * `url.includes("wp-content/uploads")` substring test — while
 * `media/asset-identity.ts` became the engine's authority on the same
 * question. Measured across eighteen reference forms, the two disagreed on
 * ELEVEN, and three of those were live defects:
 *
 *   `/media/2026/01/a.png`                  REJECTED, and it is the engine's
 *                                           own output form — so a migrated
 *                                           image could not be stored here
 *   `/wp-content/uploads/../../etc/passwd`  ACCEPTED — a path escape
 *   `/wp-content/uploads/2026/01/`          ACCEPTED — a directory
 *
 * plus a hard-coded `/wp-content/uploads/` that ignored `media.uploadsPath`,
 * so a multisite library was unrepresentable, and a refusal of `?` and `#`
 * that the engine allows.
 *
 * There is now one answer to "is this URL a migratable or local asset, and
 * which asset is it": `identifyAsset`.
 *
 * ## The one rule that is NOT about the namespace
 *
 * A media URL in the uploads namespace on a host this build does not migrate
 * from is refused, and that is content hygiene rather than classification. It
 * is either a rewrite of your own library onto a CDN — a decision the media
 * seam owns, not the content tree — or somebody else's library being stored as
 * if it were this entry's image. Both are things a curated field must not
 * carry, and neither is a question about which namespace the URL is in.
 *
 * A body may reference another site's uploads freely; this is `featuredImage`,
 * `avatar` and `ogImage`, which somebody chose.
 */
const mediaProfile = resolveMediaProfile(migration.media, migration.liveOrigin);

const assetProblem = (url: string): string | undefined => {
  const identity = identifyAsset(url, mediaProfile);
  if (
    identity.classification === "SUPPORTED" ||
    identity.classification === "CONFIGURED"
  )
    return undefined;

  if (identity.classification === "EXTERNAL") {
    if (!/^https:\/\//i.test(url))
      return "an external media URL must be https://";
    const uploads = `/${mediaProfile.uploadsPath.replace(/^\/+|\/+$/g, "")}/`;
    if (url.includes(uploads))
      return (
        `it is in the uploads namespace on a host \`media.migrateFrom\` does ` +
        `not list. That is either your own library rewritten onto another ` +
        `host — which \`WPK_MEDIA_ORIGIN\` decides at build time, not the ` +
        `content tree — or somebody else's library stored as this entry's ` +
        `image. Keep the source's own path, or name the host in ` +
        `migration.config.ts.`
      );
    return undefined;
  }

  return (
    identity.reason ??
    "it is not a migratable asset, a local asset, or an https:// external URL"
  );
};

export const mediaRef = z.strictObject({
  url: z
    .string()
    .min(1)
    .refine((url) => assetProblem(url) === undefined, {
      error: (issue) =>
        `media url "${String(issue.input)}" is not usable: ${assetProblem(String(issue.input))}`,
    }),
  alt: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /**
   * Smaller renditions of the SAME file that the source library actually
   * holds — what a `srcset` is built from. Not derived: WordPress names a
   * rendition `<stem>-<w>x<h>.<ext>` and which widths exist depends on the
   * sizes registered when the file was uploaded. List a URL here only when it
   * answered 200 when probed.
   */
  variants: z
    .array(
      z.strictObject({
        // The same authority, for the same reason: a rendition is an asset.
        url: z
          .string()
          .min(1)
          .refine((url) => assetProblem(url) === undefined, {
            error: (issue) =>
              `variant url "${String(issue.input)}" is not usable: ${assetProblem(String(issue.input))}`,
          }),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    )
    .optional(),
});

/** A link with locale-specific label copy. */
export const linkRef = z.strictObject({
  href: z.string().min(1),
  label: z.string().min(1),
});

/** EntryBase — shared by every content entry. */
export const entryBase = {
  slug,
  title: z.string().min(1),
  locale: localeCode,
  cluster: clusterKey,
  updatedAt: isoDate,
  source: entityProvenance,
};

/**
 * Locale-dimensioned display names for registry rows. Partial: a row carries
 * the locales it has been translated into; the default locale is required.
 */
export const localizedName = z
  .partialRecord(localeCode, z.string().min(1))
  .refine((names) => Boolean(names[defaultLocale]), {
    message: `name must include the default locale ("${defaultLocale}")`,
  });
