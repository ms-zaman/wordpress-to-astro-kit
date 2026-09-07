/**
 * @wpk/ui — Foundation layer.
 *
 * Importing from this entry point also loads the design-token custom
 * properties and the two global rules the system owns — the box model and the
 * focus indicator — so consumers never need to wire @wpk/tokens manually.
 */
// Webfont faces before the custom properties that name them. Both ship from
// the token package so a family token can never be declared without the file
// that delivers it.
import "@wpk/tokens/fonts.css";
import "@wpk/tokens/tokens.css";
// The design system's box model, before anything that sizes a box.
import "./foundation/box-sizing.css";
// The design system's focus ring, drawn once for every control in it. It reads
// the `--focus-*` tokens above, so it loads after them.
import "./foundation/focus.css";

// The heading-level rule and the section-naming convention. Not components:
// they are the two conventions every section component has to share.
export {
  childHeadingLevel,
  sectionHeadingId,
  type ChildHeadingLevel,
  type SectionHeadingLevel,
} from "./heading-level.ts";

export { default as Container } from "./foundation/Container.astro";
export { default as Section } from "./foundation/Section.astro";
export { default as Card } from "./foundation/Card.astro";
export { default as Heading } from "./foundation/Heading.astro";
export { default as Text } from "./foundation/Text.astro";
export { default as Button } from "./foundation/Button.astro";
export { default as Link } from "./foundation/Link.astro";
export { default as Stack } from "./foundation/Stack.astro";
export { default as Divider } from "./foundation/Divider.astro";
