# `research/render-digest/`

Where `pnpm render:digest` keeps its baselines: one text file per route per
width, recording what every element looked like.

**It ships empty, and that is deliberate.**

## Why there are no baselines here

A digest is a comparison between two machines' rendering of the same page, and
it is only meaningful when both machines lay text out identically. That holds
when the site **self-hosts its fonts** — the glyph metrics then come from the
same files everywhere, and the only drift is sub-pixel rounding, measured at a
maximum of 1px (`GEOMETRY_TOLERANCE` in `scripts/render-digest/compare.ts`).

This kit ships **a system font stack and no `@font-face`**, because it ships no
design — measuring the real one is Discovery step 1.4. So a baseline recorded
on macOS and compared on Linux would differ in every text box by far more than
a pixel: they are different typefaces, not different rounding.

Shipping baselines from one machine into a template other people build on other
machines would therefore guarantee a red first run, for a reason that says
nothing about anybody's site.

## When to record yours

After two things are true:

1. **You have self-hosted your fonts** (`packages/tokens/src/fonts.css`), or
   you record on the same operating system your CI uses.
2. **You have walked the routes.** A baseline is a record of what the pages
   look like, not a judgement that they look right — a page that was wrong on
   its first render has nothing to differ from, and a baseline taken before a
   person looked records the defect as the reference. This is PLAYBOOK.md §6's
   "walk it before you baseline it", and it is the whole reason the tool says
   `LOOK at the route first` on every unrecorded route.

Then:

```sh
pnpm build
node scripts/render-digest/cli.ts --shots   # look at render-digest-shots/
node scripts/render-digest/cli.ts --update  # record
git diff research/render-digest             # read it: this diff IS the review
```

Commit the baselines. From then on, `pnpm render:digest` fails on any page that
renders differently from the record, and `scripts/release-audit` fingerprints
this directory so a recorded sign-off carries forward only for as long as the
pages are unchanged.

## What goes in CI

Add `node scripts/render-digest/cli.ts` to the stage job **once condition 1
holds**. Until then it is a local gate: run it before you promote a change, and
read the diff.
