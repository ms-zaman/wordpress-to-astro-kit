# Presentation layer

**Status:** Draft
**Owner:** <name>
**Last updated:** <YYYY-MM-DD>
**Phase:** 01-discovery

The design, measured. This document is where `packages/tokens/src/tokens.css`
gets its values, and every value there should be traceable to a row here.

## Method

_Browser, viewport widths, date, and whether values are computed styles or
declared ones. Computed, wherever possible._

## Type

| Role | Family | Size @375 | Size @1440 | Weight | Line height | Element measured |
| --- | --- | --- | --- | --- | --- | --- |

## Colour

| Role | Value | Where it is painted | Contrast pair? |
| --- | --- | --- | --- |

## Layout

| Property | Value | Measured at |
| --- | --- | --- |
| Container cap | | |
| Gutter | | |
| Section gap (median) | | 375 and 1440 |

## Theme and builder

_Theme, page builder, and which plugins produce content rather than
presentation. Record the builder(s) per ERA, not just the current one — a
corpus usually carries more than one, and `migration.config.ts`'s
`sourceMarkup.builders` is set from this answer._

## Bands the live site hides

_A band hidden at every breakpoint is not rebuilt. List them, with the
evidence that they are hidden — and with the CLASS SET that hides each one.
Those sets go into `sourceMarkup.hiddenEverywhere` if the builder has no
profile in the kit. Read them off the element; a guessed class either deletes
real content from the comparison or matches nothing, and both look the same in
the report._
