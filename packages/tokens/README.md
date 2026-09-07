# @wpk/tokens

The design-token layer. `src/tokens.css` declares every value as a CSS custom
property on `:root`; `src/index.ts` exports the two things custom properties
cannot serve — breakpoints (invalid inside media queries) and raw layout
numbers.

**Every value ships marked `provisional`.** They are neutral defaults so the
kit builds and passes its own contrast floor on day one. They are not a design.
Replace them with values you have MEASURED from the site you are migrating (or
its design source), record the measurement in
`docs/01-discovery/presentation-layer.md`, and remove the marker.

Rules:

- Components and pages reference tokens (`var(--color-primary)`), never raw
  values.
- Semantic names only (`--color-primary`, not `--color-blue`).
- A new token needs rendered-style evidence or an explicit `provisional`
  marker.
- Webfonts are delivered from `src/fonts.css`, beside the family tokens that
  name them, so a family can never be declared without the file that serves
  it. The kit ships no font files: the system stack renders until you add
  yours.
