// Shared schema primitives — the vocabulary every collection is built from.
//
// A schema change is a contract change: the capture pipeline imports these
// modules rather than restating field lists, so extraction validates against
// the same shapes the build renders.
import { z } from "astro/zod";

import localeRegistryData from "../../../../content/config/locales.json" with { type: "json" };
import { migration } from "../../../../migration.config.ts";

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

/** URL-segment identity: immutable, extracted from the source, never derived. */
export const slug = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case");

/** Language-neutral cluster identity: `<set>/<source-slug>`. */
export const clusterKey = z
  .string()
  .regex(
    /^[a-z0-9-]+\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "cluster must be `<set>/<source-slug>` in kebab-case",
  );

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

/** How a body is rendered: WordPress's HTML verbatim (the default), or Markdown. */
export const bodyFormat = z.enum(["html", "markdown"]).default("html");

export const UPLOADS_NAMESPACE = "/wp-content/uploads/";

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const liveOrigin = migration.liveOrigin?.replace(/\/+$/, "");

/**
 * Preserved media namespace. A reference that carries the WordPress uploads
 * path must be byte-identical to extraction output: relative, or absolute on
 * the live origin. A CDN host, a rewritten path or an added query string is a
 * validation failure — not an improvement. Which host SERVES the namespace
 * after cutover is `rendering/media.ts`'s one variable.
 */
const preservedUploadsPattern = new RegExp(
  `^(?:${liveOrigin ? escapeRegExp(liveOrigin) : ""})?/wp-content/uploads/[^?#]+$`,
);

const isPreservedNamespace = (url: string) =>
  url.includes("wp-content/uploads");

export const mediaRef = z.strictObject({
  url: z
    .string()
    .min(1)
    .refine(
      (url) => !isPreservedNamespace(url) || preservedUploadsPattern.test(url),
      {
        message:
          "preserved-namespace media URLs must stay verbatim: `/wp-content/uploads/...` " +
          "relative or absolute on the live origin named in migration.config.ts, with no " +
          "host, path or query rewriting",
      },
    )
    .refine(
      (url) =>
        isPreservedNamespace(url) ||
        url.startsWith("/assets/") ||
        /^https:\/\//.test(url),
      {
        message:
          "media url must be a preserved uploads path, a /assets/ repository path, or an https:// external URL",
      },
    ),
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
        url: z.string().min(1),
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
  source: provenance,
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
