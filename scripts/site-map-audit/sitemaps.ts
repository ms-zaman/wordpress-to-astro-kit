// Reading sitemap XML.
//
// A regex is enough, and that is a judgement about the input rather than
// laziness: sitemap-protocol XML is one `<loc>` per URL element, no
// attributes, and entities limited to the five XML predefines. A parser
// dependency for that would be this audit's only dependency.
//
// Two document types share the format. A `<sitemapindex>` lists other
// sitemaps and contributes no page URLs; a `<urlset>` lists pages. Telling
// them apart is the whole reason this module exists rather than one regex at
// the call site.

const LOC = /<loc>([^<]+)<\/loc>/g;

const decode = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

export interface SitemapDocument {
  /** True when this lists other sitemaps rather than pages. */
  readonly isIndex: boolean;
  /** Every `<loc>`, decoded, in document order. */
  readonly locations: readonly string[];
}

/** Read one sitemap document. An unparseable body yields no locations. */
export function readSitemap(xml: string): SitemapDocument {
  return {
    isIndex: /<sitemapindex[\s>]/i.test(xml),
    locations: [...xml.matchAll(LOC)].map((match) => decode(match[1] ?? "")),
  };
}

/**
 * The sitemap URLs a `robots.txt` advertises.
 *
 * WordPress core, Yoast, Rank Math and All in One SEO all announce their
 * sitemap here, so this is the one discovery step that works whatever plugin
 * the source site runs. `/sitemap.xml` and `/sitemap_index.xml` are tried as
 * fallbacks by the crawl when robots.txt names none.
 */
export function sitemapsInRobots(robots: string): string[] {
  return [...robots.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)].map(
    (match) => match[1]!,
  );
}

/** The two paths to try when `robots.txt` advertises no sitemap. */
export const SITEMAP_FALLBACKS: readonly string[] = [
  "/sitemap.xml",
  "/sitemap_index.xml",
];
