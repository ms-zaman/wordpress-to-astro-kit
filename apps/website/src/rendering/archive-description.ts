// The meta description an archive falls back to when its index page supplies
// none.
//
// A separate module, and pure, for one reason: the sentence has to clear
// `META_DESCRIPTION_MIN` **for every possible term and site name**, and that is
// a property somebody can only check by calling it. Inline in the template it
// was unverifiable, and it was wrong — see below.
//
// A description under the floor is worse than a plain one: a search engine
// ignores it and writes its own snippet from the page, throwing away the one
// sentence the site controlled.
//
// ## What went wrong when this was a template literal
//
// The first version read `Posts filed under ${term} on ${SITE_NAME}.` — 39
// characters against a floor of 50, and `seo:audit` reported all four archives
// on its first run over this kit.
//
// The second version was longer and was checked by hand against the kit's own
// sample name, "Example Site". Then `kit:init --name acme --site-name "Acme"`
// produced `Every post tagged Sample on Acme, newest first.` — 47 characters,
// because a four-letter site name is eight shorter than the one it was
// measured with. Found by cloning the kit and initialising it, which is the
// whole reason that smoke test exists.
//
// So the sentence now carries a constant tail long enough that even
// single-character inputs clear the floor, and `render-contract/run.ts`
// asserts exactly that rather than trusting the arithmetic in this comment.
import { META_DESCRIPTION_MIN } from "./head-model.ts";

/**
 * Which fallback is being written.
 *
 * `search` is not an archive route, and it is here because its description has
 * the same shape and therefore the same failure mode.
 */
export type ArchiveKind =
  | "posts"
  | "category"
  | "tag"
  | "author"
  | "search"
  /** One term of a CUSTOM taxonomy. */
  | "term";

export interface ArchiveDescriptionInput {
  readonly archive: ArchiveKind;
  /** The term, the author's name, or "" for the posts index. */
  readonly title: string;
  readonly siteName: string;
  /**
   * The taxonomy's human label, for a custom term.
   *
   * Required for `term` and meaningless elsewhere. WordPress allows one term
   * name in two taxonomies, so without the label two archives write the same
   * sentence — measured, and `seo:audit` failed on the duplicate.
   */
  readonly taxonomyLabel?: string;
}

/**
 * The fallback description for one archive.
 *
 * Every form ends in the same constant clause, which is what makes the floor
 * structural rather than a property of how long anybody's site name happens to
 * be.
 */
export function archiveDescription(input: ArchiveDescriptionInput): string {
  const { archive, title, siteName } = input;
  const tail = ", newest first — the full archive.";
  if (archive === "posts") return `Every post published on ${siteName}${tail}`;
  if (archive === "author")
    return `Every post written by ${title} on ${siteName}${tail}`;
  if (archive === "tag")
    return `Every post tagged ${title} on ${siteName}${tail}`;
  if (archive === "search") return searchDescription(siteName);
  if (archive === "term")
    return (
      `Everything filed under the ${input.taxonomyLabel ?? "taxonomy"} ` +
      `${title} on ${siteName}${tail}`
    );
  return `Every post filed under ${title} on ${siteName}${tail}`;
}

/**
 * A term's own description, when it is long enough to be one — else the
 * fallback.
 *
 * A migrated term description is whatever somebody typed into WordPress, and
 * measured on the kit's own fixtures one of them was 44 characters against a
 * floor of 50. Truncating or padding it would be writing copy; falling back to
 * the generated sentence keeps the page's own words when they are usable and
 * an honest sentence when they are not.
 */
export function termDescription(
  own: string | undefined,
  input: Omit<ArchiveDescriptionInput, "archive">,
): string {
  const trimmed = own?.trim() ?? "";
  return trimmed.length >= META_DESCRIPTION_MIN
    ? trimmed
    : archiveDescription({ ...input, archive: "term" });
}

/**
 * The search page's fallback description.
 *
 * Here rather than inline in the route for the same reason as the archives':
 * it interpolates the site name, so its length is not a constant, and the
 * contract asserts the floor against the shortest name there is.
 */
export function searchDescription(siteName: string): string {
  return (
    `Search every post, page and archive on ${siteName}. ` +
    "Type a keyword to filter the whole site."
  );
}

/**
 * The shortest description each form can produce.
 *
 * One character for every variable part — no real term or site name is
 * shorter, and if the shortest clears the floor then all of them do. This is
 * what `render-contract/run.ts` asserts.
 */
export function shortestArchiveDescriptions(): {
  kind: ArchiveKind;
  text: string;
}[] {
  const kinds: ArchiveKind[] = [
    "posts",
    "category",
    "tag",
    "author",
    "search",
    "term",
  ];
  return kinds.map((archive) => ({
    kind: archive,
    text: archiveDescription({
      archive,
      title: "A",
      siteName: "A",
      taxonomyLabel: "A",
    }),
  }));
}

/** Every form clears the floor, for the shortest inputs there are. */
export function archiveDescriptionProblems(): string[] {
  return shortestArchiveDescriptions().flatMap(({ kind, text }) =>
    text.length < META_DESCRIPTION_MIN
      ? [
          `the ${kind} archive's fallback description is ${text.length} characters ` +
            `at its shortest and the floor is ${META_DESCRIPTION_MIN}: "${text}"`,
        ]
      : [],
  );
}
