# `render-digest`

What every page **looked like**, recorded as text, compared on every promotion.

```
pnpm render:digest                                    # build, then compare
node scripts/render-digest/cli.ts --update            # record; the diff IS the review
node scripts/render-digest/cli.ts --route /about/     # one route, while working
node scripts/render-digest/cli.ts --shots             # also write the screenshots
pnpm render:digest-test                               # the judgement half, no browser
```

## Read this first: the kit ships no baselines

`research/render-digest/` is empty on purpose, and
[its README](../../research/render-digest/README.md) says why. The short
version: a digest compares two machines' rendering of one page, and that is only
meaningful when both lay text out identically — which needs **self-hosted
fonts**. This kit ships a system font stack, so baselines recorded on one
operating system would differ on another in every text box.

Record yours once your fonts are your own, and **after you have walked the
routes**.

## Why it exists

The rest of the ladder is strong on structure and blind on paint. In the project
this came from, every defect that reached the owner was a paint defect — a hero
painting the wrong artwork, a panel painted twice from two rule sets, a plan tab
missing — and every one of them passed fifteen green gates.

**This does not find a page that was never right.** It makes a page that was
right and stopped being right impossible to merge quietly.

## Why a digest and not a screenshot diff

It produces a **text diff a reviewer reads in the pull request**:

```
-  section.hero | 0,107 1440x460 | … bg-image:url(/assets/hero.png) …
+  section.hero | 0,107 1440x460 | … bg-image:none …
```

rather than "4.2% of pixels changed". It is deterministic where an image diff
fights antialiasing, and it needs no image decoder (Node ships none).

## What is recorded

Every element under `<body>`, in document order, at **1440 and 375**:

```
<indent = depth>tag.first-class | x,y WxH | display: position: overflow: bg: bg-image: color: size: lh: weight: radius: opacity: visibility: | "own text"
```

Pseudo-elements too, and they are not an extra: a hero's artwork, a decorative
rule and a gradient ring are commonly painted on `::before`. Reading the element
alone once reported "every route renders exactly as it was recorded" with a hero
background deleted.

The property list is short and **closed**. Two widths, not `layout-audit`'s six:
that audit asks one cheap question per viewport, this records every element.

## Which routes

Every route, with each **template family** reduced to a sample of six — the
first, the last, and evenly spaced picks between them. A migrated blog of 250
posts is 250 near-identical recordings of one template, and the thing a digest
catches is that template moving.

The family is the route's origin, read from the build's own inventory. Not a
path prefix: your URLs come from `migration.config.ts`, so posts may live at
`/%postname%/` with no prefix at all. Static routes, archives and pagination
pages are never sampled — each is its own template, and the ends of a paginated
set differ structurally.

## Determinism is the whole job

A digest that is not byte-identical across two runs of one build is not a gate.
Four things are pinned: **fonts** awaited, **images** awaited (measured — with
fonts alone, one route in forty-four differed between two runs of the same
build), **animation** disabled outright, and the server's **ephemeral port**
stripped out of every URL.

**Emoji are normalized, not tolerated.** The operating system supplies emoji
glyphs and their advances differ by whole pixels, so a post with emoji in its
headings wraps differently and everything below shifts. Every emoji cluster is
replaced with `#` before measuring.

## The screenshot comes before the measurement

`--shots` writes a full-page PNG per route per width, from the SAME page load —
one pass rather than two, because the settling is the expensive part.

It is captured **before** the emoji normalization, and that ordering was found
by looking rather than by reasoning: the kit's own footer came back reading
`# 2026 Example Site`, because `©` is `Extended_Pictographic` and matched. A
screenshot exists for a person to look at, so it has to be the page.

Screenshots never fail anything, and they are gitignored: full-page PNGs are
megabytes and a committed binary nobody can diff is not a baseline.

## The one tolerance, and its precondition

Geometry is compared within **±1px** and everything else exactly — every colour,
fill, gradient, radius, size, weight and string, and the presence of every
element. The number was measured: baselines recorded on macOS and compared on
Linux differed on 9 of 44 digests, every difference geometry, maximum 1px.

**That measurement assumed self-hosted fonts.** See the top of this file.

## Traps

1. **`data-astro-cid-*` is never read.** It changes when a component's source
   changes, so a digest keyed on it would churn on edits that alter no pixel.
2. **Lines are compared as a multiset, not a set.** Cards sharing a signature
   would make a set difference report nothing when one of them disappeared.
3. **The comparison runs in BOTH directions.** A baseline for a route the build
   no longer produces is reported as `vanished`.
4. **`--update` rewrites the directory wholesale**, so a removed route's
   baseline goes with it.
5. **An intended change rewrites baselines, and that is the point.** Commit them
   in the same commit as the change that caused them. The diff is the review.
