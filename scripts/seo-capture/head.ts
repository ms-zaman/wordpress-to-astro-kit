// The metadata a source page publishes about itself.
//
// ## Why this is read from the rendered page and not from REST
//
// Measured on a live install: `wp/v2/posts/<id>?_fields=meta` returned
// `{"footnotes":""}`. Rank Math — like Yoast and All in One SEO — keeps its
// title and description in postmeta and does NOT register them in the public
// REST schema. The one place every SEO plugin agrees to put them is the
// rendered `<head>`, because that is the whole point of the plugin.
//
// So this parses the head. It is deliberately plugin-AGNOSTIC: it reads the
// standard tags any of them emit, and knows nothing about which one wrote them.
//
// ## What it does not do
//
// It does not read the whole document, guess at a description from body text,
// or invent a title. A page whose head says nothing yields nothing, and the
// route then keeps the title and description the kit derives — which is the
// correct outcome, not a gap to paper over.

/** What a source page's head says about itself. */
export interface SourceHead {
  readonly title?: string;
  readonly description?: string;
  readonly canonical?: string;
  readonly ogImage?: string;
  readonly robots?: { readonly noindex: boolean; readonly nofollow: boolean };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#039": "'",
  "#8217": "’",
  "#8211": "–",
  "#8212": "—",
  "#8230": "…",
  nbsp: " ",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#?[a-z0-9]+);/gi, (whole, name: string) => {
    const direct = ENTITIES[name] ?? ENTITIES[name.toLowerCase()];
    if (direct !== undefined) return direct;
    const numeric = /^#(\d+)$/.exec(name);
    if (numeric !== null) return String.fromCodePoint(Number(numeric[1]));
    const hex = /^#x([0-9a-f]+)$/i.exec(name);
    if (hex !== null) return String.fromCodePoint(Number.parseInt(hex[1]!, 16));
    return whole;
  });
}

/** Only the head. A `<meta>` in the body is not this page's own metadata. */
const headOf = (html: string): string => {
  const end = html.search(/<\/head>/i);
  return end === -1 ? html.slice(0, 40000) : html.slice(0, end);
};

const meta = (
  head: string,
  attribute: string,
  key: string,
): string | undefined => {
  // Attribute order varies between plugins and between WordPress versions, so
  // both orders are tried rather than assuming the one this site happens to use.
  const patterns = [
    new RegExp(
      `<meta[^>]+${attribute}=["']${key}["'][^>]*\\scontent=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*\\s${attribute}=["']${key}["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const found = pattern.exec(head);
    if (found?.[1] !== undefined && found[1].trim() !== "")
      return decodeEntities(found[1].trim());
  }
  return undefined;
};

/**
 * Read a source page's own head metadata.
 *
 * `robots` is parsed into the two booleans the content model holds, and only
 * when the page actually says one of them: WordPress's default is `index,
 * follow`, and recording that as an override would put a row in the table for
 * every page saying nothing.
 */
export function readSourceHead(html: string): SourceHead {
  const head = headOf(html);

  const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title =
    rawTitle === undefined ? undefined : decodeEntities(rawTitle).trim();

  const canonical =
    /<link[^>]+rel=["']canonical["'][^>]*\shref=["']([^"']*)["']/i.exec(
      head,
    )?.[1] ??
    /<link[^>]+href=["']([^"']*)["'][^>]*\srel=["']canonical["']/i.exec(
      head,
    )?.[1];

  const robotsRaw = meta(head, "name", "robots");
  const robots =
    robotsRaw === undefined
      ? undefined
      : {
          noindex: /\bnoindex\b/i.test(robotsRaw),
          nofollow: /\bnofollow\b/i.test(robotsRaw),
        };

  return {
    ...(title === undefined || title === "" ? {} : { title }),
    ...(() => {
      const description =
        meta(head, "name", "description") ??
        meta(head, "property", "og:description");
      return description === undefined ? {} : { description };
    })(),
    ...(canonical === undefined ? {} : { canonical: canonical.trim() }),
    ...(() => {
      const ogImage =
        meta(head, "property", "og:image") ??
        meta(head, "name", "twitter:image");
      return ogImage === undefined ? {} : { ogImage };
    })(),
    // Only when the page says something other than the default.
    ...(robots === undefined || (!robots.noindex && !robots.nofollow)
      ? {}
      : { robots }),
  };
}
