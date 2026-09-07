# @wpk/ui

The Foundation layer: `Container`, `Section`, `Stack`, `Heading`, `Text`,
`Button`, `Link`, `Card`, `Divider`, plus the two global rules the system owns
(`box-sizing.css`, `focus.css`) and the heading-level convention
(`heading-level.ts`).

Importing from the entry point loads the tokens and both global stylesheets, so
a consumer never wires `@wpk/tokens` by hand.

Every primitive is site-agnostic: it reads tokens and carries no brand, no copy
and no layout decision of its own. Section components — a hero, a feature grid,
a pricing table — belong to the site that needs them and live in
`apps/website/src/components/`, built on these.
