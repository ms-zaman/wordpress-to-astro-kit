// Which entries did NOT hand over their body, and how to tell.
//
// ## The finding this generalises
//
// A page builder keeps its document in postmeta, and `content.rendered` only
// carries whatever the classic editor happened to hold. So an entry built with
// one returns its intro paragraph and nothing else — a 200, a body, no error,
// and most of the article missing. A capture that did not look would write
// stub articles and report success.
//
// **This is a page-BUILDER problem, not a WordPress problem.** Gutenberg keeps
// its document in `post_content` — block markup with HTML comment delimiters —
// so a Gutenberg or classic-editor corpus hands `content.rendered` the whole
// article and this check finds nothing. Zero incomplete bodies on such a site
// is the correct answer, not a broken instrument. Which builders your corpus
// carries is §1.3 of the PLAYBOOK, and it tells you which answer to expect.
//
// Measured on a real site, over 278 posts:
//
//   ordinary posts    n=264   8,698 – 153,234 chars   median 20,790
//   stub bodies       n=14    1,913 –   2,794 chars
//
// A clean cliff, and every one of the 14 carries page-builder markup. **Their
// bodies are reachable** — each renders completely at its own URL — so the
// answer is one extra page fetch per affected entry, not a credential and not
// a silence.
//
// ## Two signals, because either alone is wrong
//
// **Markers** catch a builder that left its wrapper in the rendered body.
// Cheap and certain when present. On the same site it found 27 Elementor posts
// and one WPBakery post — but only 14 of those 27 were stubs, so a marker on
// its own over-reports by half.
//
// **Length against the corpus** decides which bodies are actually missing. It
// is what puts an entry on the `incomplete` list and earns it a page fetch.
//
// Neither is a verdict. Both produce a LIST for a person, and the capture
// fetches the pages so the evidence exists either way.

/** Wrapper classes and attributes the common page builders leave behind. */
const BUILDER_MARKERS: readonly (readonly [string, RegExp])[] = [
  ["elementor", /elementor-(section|widget|element|container)\b/],
  ["divi", /\bet_pb_(section|row|module)\b/],
  ["wpbakery", /\b(vc_row|wpb_wrapper|vc_column)\b/],
  ["beaver-builder", /\bfl-(builder-content|row|module)\b/],
  ["gutenberg-reusable", /<!--\s*wp:block\s/],
];

/** The page builder whose markers a body carries, if any. */
export function builderInBody(html: string): string | undefined {
  for (const [name, marker] of BUILDER_MARKERS)
    if (marker.test(html)) return name;
  return undefined;
}

export interface BodyStat {
  readonly id: number;
  readonly slug: string;
  readonly length: number;
  /** The builder whose markers the body carries. */
  readonly builder?: string;
  /** Why this entry is on the short list. */
  readonly reason?: string;
}

export interface BodyReport {
  readonly count: number;
  readonly min: number;
  readonly median: number;
  readonly max: number;
  /** Entries whose body this capture does not believe is the whole article. */
  readonly incomplete: readonly BodyStat[];
  readonly stats: readonly BodyStat[];
}

/**
 * How short is short enough to doubt: a fifth of the corpus median.
 *
 * RELATIVE, with no absolute floor, and both halves of that were measured
 * rather than reasoned.
 *
 * **Relative**, because "short" has no fixed meaning: a documentation site's
 * articles are legitimately shorter than a magazine's, and any absolute
 * threshold flags every entry on one kind of site and nothing on the other.
 *
 * **No absolute cap**, because the first version had one — the floor was
 * `min(median / 5, 1500)` — and on a real corpus that broke it completely.
 * Measured over 278 posts:
 *
 *   corpus median      20,790
 *   the 14 stubs        1,913 – 2,794
 *   everything else     8,698 – 153,234
 *
 * A clean cliff, and the 1,500 cap put the floor BELOW the stubs, so none of
 * them was flagged. The cap had been added to stop over-reporting on a
 * high-variance corpus, and it made the rule strictly less able to find the
 * thing it exists for.
 *
 * The asymmetry settles it. Over-reporting costs one extra page fetch and a
 * line in a list somebody reads. Under-reporting silently writes stub articles
 * and reports success. So the rule leans to over-reporting, and there is no
 * cap.
 *
 * A fifth sits in the middle of the band that works: on that corpus, every
 * fraction from 0.15 to 0.3 finds exactly the same 14 entries, and every one
 * of them carries page-builder markup.
 */
export const SHORT_FRACTION = 0.2;

/**
 * Below this many entries, nothing is flagged.
 *
 * A median over three entries is not a description of a corpus, and a rule
 * built on one would report whichever entry happened to be shortest. A capture
 * that small is one a person reads in full anyway.
 */
export const MINIMUM_CORPUS = 8;

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
};

/**
 * Measure the corpus and name the entries whose body is probably not all of it.
 *
 * Pure: rows in, report out. The capture uses the `incomplete` list to decide
 * which pages to fetch, and the CLI prints the distribution either way —
 * because a corpus where every body is 400 characters is telling you something
 * about the site, not about this heuristic.
 */
export function bodyReport(
  entries: readonly { id: number; slug: string; html: string }[],
): BodyReport {
  const lengths = entries.map((entry) => entry.html.length);
  const corpusMedian = median(lengths);
  const floor =
    entries.length < MINIMUM_CORPUS ? 0 : corpusMedian * SHORT_FRACTION;

  const stats: BodyStat[] = entries.map((entry) => {
    const builder = builderInBody(entry.html);
    const short = entry.html.length < floor;
    const reason = short
      ? `${entry.html.length} characters against a corpus median of ${corpusMedian} — the body is probably not in content.rendered`
      : builder !== undefined
        ? `carries ${builder} markup, so parts of it may be rendered by the builder rather than carried in the body`
        : undefined;
    return {
      id: entry.id,
      slug: entry.slug,
      length: entry.html.length,
      ...(builder === undefined ? {} : { builder }),
      ...(reason === undefined ? {} : { reason }),
    };
  });

  return {
    count: entries.length,
    min: lengths.length === 0 ? 0 : Math.min(...lengths),
    median: corpusMedian,
    max: lengths.length === 0 ? 0 : Math.max(...lengths),
    // Only the SHORT ones need their page fetched. An entry that merely
    // carries builder markers already handed over a body; the marker is worth
    // reporting so a reviewer looks, and it is not worth a second request.
    incomplete: stats.filter(
      (stat) =>
        stat.reason?.includes("probably not in content.rendered") === true,
    ),
    stats,
  };
}
