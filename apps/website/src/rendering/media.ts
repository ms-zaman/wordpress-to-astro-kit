// The media origin — the one seam between this build and the WordPress media
// library.
//
// Every migrated body references its images in the `/wp-content/uploads/`
// namespace, byte-for-byte as WordPress rendered them, because those are the
// URLs readers and search engines already hold. What stays open is WHICH HOST
// answers the namespace after cutover, and that is a hosting fact, not a
// content fact:
//
//   - by default the live origin named in `migration.config.ts` keeps serving
//     them (a WordPress box behind a proxy rule, say);
//   - `WPK_MEDIA_ORIGIN` names a bucket or CDN host once the library is
//     mirrored — and `/media-manifest.json` lists every upload to mirror.
//
// `mediaUrl` rewrites the ORIGIN of a preserved reference and nothing else.
// Nothing here fetches anything.
import { migration } from "../../../../migration.config.ts";
import { processEnvironment } from "../deployment/site-environment.ts";

export const MEDIA_ORIGIN_KEY = "WPK_MEDIA_ORIGIN";

/** The live site's own origin — the default, which changes no reference. */
export const LIVE_MEDIA_ORIGIN: string | undefined =
  migration.liveOrigin?.replace(/\/+$/, "");

export const UPLOADS_PREFIX = "/wp-content/uploads/";

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * ASCII whitespace, and deliberately NOT `\s`: a URL inside an HTML attribute
 * is delimited by the quote, and a `srcset` candidate by an ASCII space —
 * never by U+00A0 or U+202F, which are ordinary characters in a file name.
 */
const ASCII_SPACE = /[ \t\r\n\f\v]+/;

const liveHost = LIVE_MEDIA_ORIGIN
  ? new URL(LIVE_MEDIA_ORIGIN).host.replace(/^www\./, "")
  : undefined;

/** An absolute reference on the live host, capturing the preserved path. */
const PRESERVED_ABSOLUTE =
  liveHost === undefined
    ? undefined
    : new RegExp(
        `^https?:\\/\\/(?:www\\.)?${escapeRegExp(liveHost)}(\\/wp-content\\/uploads\\/[^ \\t\\r\\n\\f\\v"'<>]*)$`,
        "i",
      );

/** A relative reference into the preserved namespace. */
const PRESERVED_RELATIVE = /^\/wp-content\/uploads\/[^ \t\r\n\f\v"'<>]*$/;

/** The origin uploads are served from, or undefined when none is configured. */
export function mediaOrigin(
  source: Readonly<Record<string, string | undefined>> = processEnvironment(),
): string | undefined {
  const raw = source[MEDIA_ORIGIN_KEY]?.trim();
  if (raw === undefined || raw === "") return LIVE_MEDIA_ORIGIN;
  const origin = raw.replace(/\/+$/, "");
  if (!/^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin))
    throw new Error(
      `${MEDIA_ORIGIN_KEY} is "${raw}"; it must be a scheme and host, like https://media.example.com`,
    );
  return origin;
}

/** True for a reference inside the preserved uploads namespace. */
export function isPreservedMedia(url: string): boolean {
  const trimmed = url.trim();
  return (
    PRESERVED_RELATIVE.test(trimmed) ||
    (PRESERVED_ABSOLUTE?.test(trimmed) ?? false)
  );
}

/**
 * The same reference served from a given media origin, or unchanged when
 * there is none.
 *
 * `origin` is REQUIRED and is not defaulted to `mediaOrigin()`. A default
 * parameter cannot express "explicitly no origin" — passing `undefined`
 * selects the default — so the no-origin branch would become unreachable
 * from every caller, tests included, the moment a live origin was
 * configured, while still reading as covered. Callers that want the
 * configured origin pass `mediaOrigin()`, which says so.
 */
export function mediaUrl(url: string, origin: string | undefined): string {
  const trimmed = url.trim();
  const absolute = PRESERVED_ABSOLUTE?.exec(trimmed);
  if (absolute)
    return origin === undefined
      ? (absolute[1] ?? trimmed)
      : `${origin}${absolute[1]}`;
  if (PRESERVED_RELATIVE.test(trimmed))
    return origin === undefined ? trimmed : `${origin}${trimmed}`;
  return url;
}

const ATTRIBUTE =
  /\b(src|srcset|href|poster|data-src|data-srcset)=("|')([^"']*)\2/gi;

/** A CSS `url(...)` reference — in a migrated body, a `style` attribute. */
const CSS_URL = /url\(\s*(["']?)([^)"']*)\1\s*\)/gi;

/**
 * Rewrite every preserved upload reference inside an HTML string. `srcset`
 * values are comma-separated candidates, each rewritten on its own.
 */
export function rewriteMediaHtml(
  html: string,
  origin: string | undefined,
): string {
  return html
    .replace(ATTRIBUTE, (whole, name: string, quote: string, value: string) => {
      const rewritten = /srcset$/i.test(name)
        ? value
            .split(",")
            .map((candidate) => {
              const trimmed = candidate.trim();
              const [url, ...descriptor] = trimmed.split(ASCII_SPACE);
              return [mediaUrl(url ?? "", origin), ...descriptor].join(" ");
            })
            .join(", ")
        : mediaUrl(value, origin);
      return rewritten === value
        ? whole
        : `${name}=${quote}${rewritten}${quote}`;
    })
    .replace(CSS_URL, (whole, quote: string, url: string) => {
      const rewritten = mediaUrl(url, origin);
      return rewritten === url ? whole : `url(${quote}${rewritten}${quote})`;
    });
}

/** Every preserved upload reference an HTML string carries, de-duplicated. */
export function collectMediaRefs(html: string): string[] {
  const refs = new Set<string>();
  for (const match of html.matchAll(ATTRIBUTE)) {
    const value = match[3] ?? "";
    const candidates = /srcset$/i.test(match[1] ?? "")
      ? value.split(",").map((c) => c.trim().split(ASCII_SPACE)[0] ?? "")
      : [value];
    for (const candidate of candidates)
      if (isPreservedMedia(candidate)) refs.add(candidate.trim());
  }
  for (const match of html.matchAll(CSS_URL)) {
    const url = (match[2] ?? "").trim();
    if (isPreservedMedia(url)) refs.add(url);
  }
  return [...refs].sort();
}

/** A media reference with the renditions the library actually holds. */
export interface ResponsiveMedia {
  readonly url: string;
  readonly width?: number;
  readonly variants?: readonly {
    readonly url: string;
    readonly width: number;
  }[];
}

/**
 * The `srcset` for a media reference, or `undefined` when there is nothing to
 * choose between. Candidates are the probed `variants` plus the original as
 * the largest, each through `mediaUrl` so a moved library moves the set.
 */
export function mediaSrcset(
  media: ResponsiveMedia,
  origin: string | undefined,
): string | undefined {
  const candidates = new Map<number, string>();
  for (const variant of media.variants ?? [])
    candidates.set(variant.width, mediaUrl(variant.url, origin));
  if (media.width !== undefined)
    candidates.set(media.width, mediaUrl(media.url, origin));
  if (candidates.size < 2) return undefined;
  return [...candidates.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([width, url]) => `${url} ${width}w`)
    .join(", ");
}

/**
 * Give every `<img>` in a migrated body a loading strategy where it has none.
 * WordPress's lazy-loading plugins do not survive migration, so body images
 * would otherwise download on parse regardless of how far below the fold they
 * sit. An image that already declares `loading` is left exactly as it is.
 */
export function deferBodyImages(html: string): string {
  return html.replace(/<img\b([^>]*)>/gi, (whole, attributes: string) => {
    let out = attributes;
    if (!/\bloading\s*=/i.test(out)) out += ' loading="lazy"';
    if (!/\bdecoding\s*=/i.test(out)) out += ' decoding="async"';
    return out === attributes ? whole : `<img${out}>`;
  });
}

/** WordPress's emoji-image replacement, which serves from wordpress.org. */
const EMOJI_IMAGE =
  /<img\b(?=[^>]*\bsrc="https?:\/\/s\.w\.org\/images\/core\/emoji\/)[^>]*\balt="([^"]*)"[^>]*>/gi;

/**
 * Put a migrated body's emoji back as characters. WordPress replaces every
 * emoji with an `<img class="emoji">` served from `s.w.org`; the `alt` it
 * writes IS the character it replaced, so the substitution is exact.
 */
export function inlineEmojiImages(html: string): string {
  return html.replace(EMOJI_IMAGE, (whole, alt: string) =>
    alt.trim() === "" ? whole : alt,
  );
}
