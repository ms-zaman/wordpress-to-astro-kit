# `scripts/browser-tests/`

The interactions nothing else tests.

```
pnpm test:browser        # desktop (1440) and phone (375)
pnpm test:browser-ui     # the same, in Playwright's UI
```

## Why this layer exists

Every other gate in this kit reads a page that is already finished: the build
audit reads `dist/`, the accessibility, layout and contrast audits load a page
and measure it at rest, `render-digest` records what it looks like. **None of
them ever clicks anything.**

So a menu that will not open, a menu that will not close again, and a skip link
that moves the scroll position without moving focus have no automated coverage
at all. In the project this kit came from, every defect any of those ever had
was found by a person clicking.

## What is tested

|                         |                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| the small-viewport menu | starts closed, opens, closes again, and is operable with the keyboard                                      |
| the header              | closed, it leaves the page heading above the fold                                                          |
| the skip link           | reveals on focus, and moves FOCUS into the main landmark — not just the scroll position                    |
| the navigation          | every menu link reaches a page that renders; the current item is marked once per menu and points at itself |
| the blog                | a card reaches its post; a post reaches its archive                                                        |
| search                  | the form submits without any script                                                                        |
| every page              | no script is requested from anywhere, including through a stylesheet or an embed                           |

The last one is the browser's side of a claim the preview audit makes from the
HTML. A script arriving through a third-party embed is invisible to a source
read and obvious here.

## Two configuration choices worth knowing

**Chromium only.** Cross-browser is a real thing this could buy, and it costs
three browser downloads on every CI run for a site with no browser-specific
code and no framework runtime. It is one line in `playwright.config.ts`.

**The phone project runs Desktop Chrome at 375 with `isMobile: false`.** It
exists to test the 375px LAYOUT, and Playwright's mobile emulation also turns on
touch and a device scale factor — which would make these results incomparable
with `layout-audit` and `render-digest`, both of which measure 375 with a scale
factor of 1 and no touch.

## What it does not claim

It finds a behaviour that BROKE. It does not find a page that was badly designed
from its first render, and no assertion here would notice a sentence that
describes the build rather than the site.

These tests are written against the kit's **sample site**. When you replace the
sample content the routes change and some of these change with them — each test
says which fact about the site it depends on, so the edit is obvious.
