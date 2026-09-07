# `layout-audit`

Horizontal overflow, measured in a real rendering engine, for **every built
route at every viewport, with fonts loaded**.

```
pnpm layout:audit        # builds, then measures
pnpm layout:audit-test   # the judgement half, no browser needed
```

## Why it needs a browser

Overflow is not in the HTML. It is a property of computed styles, text metrics
and the viewport, and only a rendering engine knows all three. The build audit
parses markup, so it structurally cannot check this and does not try.

**Fonts are awaited** before measuring. A font whose metrics differ from its
fallback is exactly the change that introduces overflow, so measuring before it
loads would measure the wrong page.

## The two overflows, and why they are separate findings

`overflow` is the document scrolling sideways. `control-overflow` is a form
control wider than the element that owns it — and it does **not** reach
`scrollWidth`, because a control overflowing its grid cell by 34px sits inside a
panel wide enough to hold it. One finding kind for both would let a clean
`scrollWidth` stand in for a clean form.

## Widths

320, 375, 768, 1024, 1440, 1920. The two narrow ones are where overflow
actually happens; 1440 and 1920 both matter because a container cap that is
wrong only shows above it.

## The baseline

`baseline.ts` ships **empty**, and the emptiness is the assertion. An entry
belongs there only when the fix genuinely waits on a person — a design ruling,
somebody else's embed. A defect you can fix is fixed, not recorded.

It is asserted in **both directions**: an id recorded there that the build no
longer produces is an error, because a defect that quietly vanished means
behaviour changed without the record changing.

## It found one on its first run

`/contact/` overflowed at 320px — `scrollWidth` 355, an inline `<code>` span
331px wide, because nothing breaks at a slash by default. Fixed in
`Prose.astro` with a wrapping rule, not recorded in the baseline.
