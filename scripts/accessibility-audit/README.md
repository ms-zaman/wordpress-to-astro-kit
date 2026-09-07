# `accessibility-audit`

The semantic accessibility contract, over the built output.

```
pnpm a11y:audit        # builds, then audits apps/website/dist
pnpm a11y:audit-test   # the suite: unit checks, then one mutation per rule
```

## What it checks

| Check        | Contract                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `contrast`   | Every token pair the components composite clears its WCAG threshold, measured against the palette the build SHIPPED                 |
| `headings`   | One `h1` per page, first, and no skipped level going down                                                                           |
| `landmarks`  | One `main`, every `nav` named, no two navs on a page sharing a name, and nav names consistent across a template family              |
| `lists`      | A list styled so a screen reader stops announcing it as a list carries `role="list"`                                                |
| `focus`      | The design system's universal `:focus-visible` rule reaches every page, and every control is reached by a rule that DRAWS something |
| `skip-link`  | The element the skip link targets can actually receive focus                                                                        |
| `navigation` | The menu is a native, keyboard-operable, closed-by-default control; `aria-current` points at this page; every nav link resolves     |

## What it cannot see, and who can

Focus **order**, live regions, target size, reflow at 400% zoom, and **which
ground an element is actually painted on** all need a rendering engine.
`scripts/contrast-audit` and `scripts/browser-tests` are the two halves that
have one. This audit is static, pure Node, and runs on every push — which is
exactly right for what it asks.

## The palette is read, never restated

`checkTokenContrast` parses `--color-*` out of the CSS the build **shipped**,
not out of the source. A baseline built from values copied into TypeScript keeps
passing after somebody edits `tokens.css`, which is precisely the regression it
exists to catch.

It reads minified named colours too. A minifier rewrites a colour to whichever
form is shorter, so `#fffafa` ships as `snow` — and under a hex-only parser that
token dropped out of the palette ENTIRELY, so the audit measured nothing against
it. A declaration this cannot read now **stops the run** rather than vanishing.

WordPress core's preset palette (`--wp-preset-*`) is deliberately outside the
namespace: those are core's values for preset classes inside migrated bodies,
not a design decision anybody here made.

**`CONTRAST_PAIRS` is yours to extend.** Every component that composites a new
pair belongs in that table, or its ratio is unmeasured.

## Three severities, and the third one is the point

- `error` — a regression. Fails the run.
- `warning` — visible, and not callable as a defect without a ruling.
- `baseline` — a KNOWN open defect, owned by a named decision, deliberately
  unfixed. Does not fail the run.

The baseline is asserted in **both directions**: an entry the build no longer
produces is reported as a stale `error`. So a known failure cannot be silently
fixed and cannot silently spread.

In a migration, one thing belongs there: the source site's own editorial,
carried across verbatim. Fifteen articles that skip a heading level, one that
carries three `h1` elements — that was the shape of it in the project this came
from, and every one was live's own. Repairing them means renumbering somebody
else's document. **A defect in a component you wrote never belongs there.**

It ships empty, and the suite exercises both directions against a synthetic
list — a mechanism that can only be tested against real entries is a mechanism
nothing tests on the day the last entry is fixed.

## The nav-majority rule, and the 112-error lesson

A nav name carried by more than half the pages is site chrome, and site chrome
is on every page. The majority is per **template family**, not site-wide, and
that was learned expensively: calibrated against eighteen pages, a breadcrumb on
seven was correctly a minority. Then a migrated blog arrived and one template
became 79% of the site, so `Breadcrumb` crossed the site-wide majority and the
audit demanded it on the pricing page, on `/404` and on every author archive.
112 errors, none of them a defect.

The family comes from the build's own route inventory. The path-shape fallback
in `templateFamily` is for an arbitrary directory only, and it is not good
enough on its own — see `scripts/lib/manifest.ts`.
