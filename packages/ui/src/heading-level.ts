/**
 * Heading levels as a system rule.
 *
 * A section component's `headingAs` is **the level its own section heading
 * renders at**. Every heading the component renders below that one is derived
 * from it: one level deeper when the section heading is rendered, and **at the
 * section's own level when it is not**.
 *
 * The second half is what closes the optional-heading trap: every section
 * heading is optional content, and a child level hard-coded one below an
 * absent parent produces a row of `h3`s under no `h2` — an outline defect a
 * screen reader's page summary shows and a sighted reviewer never sees.
 */

/** The level a section component's own heading renders at. */
export type SectionHeadingLevel = "h1" | "h2" | "h3";

/** The level a heading nested inside a section renders at. */
export type ChildHeadingLevel = "h1" | "h2" | "h3" | "h4";

const NEXT: Record<SectionHeadingLevel, ChildHeadingLevel> = {
  h1: "h2",
  h2: "h3",
  h3: "h4",
};

/**
 * The level a section's child headings render at.
 *
 * @param headingAs the level the section's own heading renders at
 * @param sectionHeadingRendered whether that heading is actually emitted
 */
export function childHeadingLevel(
  headingAs: SectionHeadingLevel,
  sectionHeadingRendered: boolean,
): ChildHeadingLevel {
  return sectionHeadingRendered ? NEXT[headingAs] : headingAs;
}

/**
 * The id a section's own heading carries so the section can be named by it.
 *
 * An anchored section is a place a reader can be sent, and a `<section>` with
 * an accessible name is a `region` landmark that announces itself on arrival.
 * The name is never invented — it is the heading the section already renders,
 * referenced by id, so the announced name and the visible one cannot drift.
 */
export function sectionHeadingId(anchorId: string): string {
  return `${anchorId}-title`;
}
