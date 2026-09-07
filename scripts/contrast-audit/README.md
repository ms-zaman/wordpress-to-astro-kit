# `contrast-audit`

Proves that **every piece of text on every route meets WCAG AA against the
ground actually painted behind it**, at 1440 and 375.

```
pnpm contrast:audit          # every route, both widths
pnpm contrast:audit -- --all # also list what is baselined
pnpm contrast:audit-test     # the suite
```

Needs a browser, so it runs in the stage job rather than in `validate`.

## Why it exists when `a11y:audit` already checks contrast

It checks a different thing, and the difference is the whole point.

The accessibility audit compares **token pairs** — is this foreground legible on
that ground. It is static, pure Node, and it runs on every push, which is
exactly right for what it asks.

It cannot ask **which ground an element is on**. That needs an ancestor chain, a
composited background and an inherited colour, which means a layout engine.

In the project this came from, a homepage shipped for months with two 56px
headings painting `#091439` on a `#0c0934` band:

```
  1.06:1  needs 3  / @1440
      h2.heading  56px/600  rgb(9, 20, 57) on rgb(12, 9, 52)
      "Connect the site smoothly with the platform"
```

Not low contrast — **a heading nobody can see**, on the most important page.
Both token pairs were registered and both were fine. Nothing had ever asked
which ground those headings were on. It was found by a person looking at a
screenshot, which is not a gate.

## How a ground is derived

Walk ancestors until an opaque background is found, compositing each translucent
layer back down; then composite the text colour over the result. Nothing is
assumed to be white and nothing is read off a single element.

**Alpha is composited, never ignored.** The first version of this probe parsed
`color(srgb 1 1 1 / 0.898)` with a bare digit regex, read it as `rgb(1, 1, 1)`,
and reported 64 phantom failures in a footer — a near-black ground under white
text. Both colour forms Chrome serialises are parsed, with their alpha, and the
suite anchors that case.

## What is measured

Every element under `<body>` with **its own** text of two characters or more,
that is rendered. A `<div>` wrapping a paragraph inherits its colour and would
report the same words twice, naming a box rather than what a reader sees.

Thresholds are WCAG 1.4.3: **3:1** for large text (24px, or 18.66px at weight
700+), **4.5:1** otherwise.

## The baseline

`baseline.ts` ships empty, keyed on `route|element|text` and **not** on the
ratio — so a finding that gets worse stays baselined rather than reappearing as
a new one. That is deliberate: the check that a ratio has not moved is a person
re-reading the decision, not a number comparison.

In a migration, one thing belongs there: a colour pair the SOURCE site already
fails, carried across verbatim inside a migrated body. Measure it on the live
site, record the measurement in the decision, and let the fix happen in
WordPress. A pair YOU authored is a token to change, not a row to file.

A baseline entry nothing measures any more **fails the run**.

## Traps

1. **A pair check and a rendered check are not substitutes.** Keep both.
2. **A gate that has never failed proves nothing.** Verify it by reverting a
   real fix and confirming it reports every instance.
3. **`fonts.ready`, not images.** A font changes which glyphs are measured for
   the large-text threshold; nothing here depends on an image having decoded,
   which is why it does not carry `render-digest`'s image settling.
4. **The classifier takes its baseline ids as an argument** and consults nothing
   else. Reading the module's own set for membership while taking the argument
   for staleness gave it two sources of truth, and its own suite caught that on
   the first run.
