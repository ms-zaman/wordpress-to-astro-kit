// What language does the source site publish in?
//
// Nothing in WordPress's REST API answers this. Measured on ja.wordpress.org,
// the `/wp-json/` index carries name, description, url, home, gmt_offset,
// timezone_string, page_for_posts, page_on_front, show_on_front, site_logo,
// site_icon — and no language field at all. `wp/v2/posts` rows carry none
// either. The site's language exists in exactly one public place:
//
//     <html lang="ja">
//
// So a migration that never renders a page never learns it, and the kit's
// locale registry default — `en`, because a kit has to ship something — became
// the recorded language of 709 Japanese entries. Nothing failed. Every page
// would have declared `lang="en"`, which is wrong for a screen reader deciding
// a voice, for a search engine deciding an index, and for a browser deciding a
// font. No gate in this repository reads `<html lang>` against the source.
//
// This module is the reader. It parses; the capture fetches.

/**
 * The `lang` of the root element, or null if the document declares none.
 *
 * Deliberately narrow: it reads the FIRST `<html …>` tag and nothing else. A
 * `lang` on a `<div>` inside the body is a fragment's language, not the site's,
 * and treating one as the other is how a site gets labelled by whichever
 * quotation happens to appear first.
 */
export function htmlLang(html: string): string | null {
  const tag = /<html\b[^>]*>/i.exec(html);
  if (tag === null) return null;
  const attribute = /\blang\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(
    tag[0],
  );
  const value = attribute?.[2] ?? attribute?.[3] ?? attribute?.[4];
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * Do a source language tag and a content-model locale describe one language?
 *
 * Compared on the PRIMARY SUBTAG only, case-insensitively. WordPress serves
 * `ja` where the registry may hold `ja`, and `pt-BR` where it may hold `pt`;
 * calling those a mismatch would make the check noise, and noise gets muted.
 * `ja` against `en` is what this is for.
 *
 * An absent source language is not a mismatch — it is an absence, and the
 * caller says so in those words rather than reporting agreement it never saw.
 */
export function sameLanguage(
  sourceTag: string | null,
  locale: string,
): boolean | null {
  if (sourceTag === null) return null;
  const primary = (tag: string): string =>
    (tag.split(/[-_]/)[0] ?? "").toLowerCase();
  return primary(sourceTag) === primary(locale);
}
