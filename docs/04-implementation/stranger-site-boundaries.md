# What a stranger site hits first

**Status:** Draft
**Owner:** Engineering
**Last updated:** 2026-09-08
**Phase:** 04-implementation

Before the black-box migration trial, the kit was audited as if by an author of
an unknown WordPress site. Nothing site-specific to any real domain had leaked
into the engine — the media and taxonomy layers read their profiles throughout,
and no fixture collection name (`products`, `product_cat`, …) appears in any
generic module.

What the audit found instead is narrower and more consistent, and it is stated
here rather than guessed at during the trial:

> **The generic code assumes its stranger writes English in Latin script.**

Four findings were fixed at once because they were inconsistencies rather than
missing features — see the commit that added this file. The rest are real
boundaries. They are listed with the evidence, because a boundary nobody wrote
down is indistinguishable from a bug.

## B1 — Slugs must be ASCII kebab-case · **fails hard**

`content-model/shared.ts` — `slug` is `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`.

WordPress's `post_name` is not restricted to that. `sanitize_title_with_dashes()`
preserves UTF-8 and percent-encodes it, so a Russian, Japanese, Greek, Hebrew,
Arabic or Thai site's slugs contain `%` or decoded UTF-8; underscores survive
(`about_us`), and legacy imports carry uppercase.

The break is end to end: `content-capture` writes `slug` straight from
`wp/v2/posts`, and the content contract then refuses to load the kit's own
capture. Every gate downstream never runs.

Same family: `permalinks.paginationSegment` is `/^[a-z0-9-]+$/`, so a localized
install's `страница` or `ページ` is refused; `nicename` is `/^[a-z0-9._-]+$/`,
and `user_nicename` is a `varchar(50)` that also carries percent-encoded UTF-8.

**Boundary:** the kit migrates sites whose slugs are ASCII. Widening this is a
schema change plus a routing and identity change, and it must be measured
against a real non-Latin install rather than guessed.

## B2 — Every string the ENGINE writes is English · **ships wrong output**

Content is properly localized — navigation labels, registry names and term
names are all per-locale. Everything the kit itself writes is not, and some of
it is published as metadata:

- `rendering/archive-description.ts` — the `<meta name="description">` on every
  category, tag, author and posts-index URL: *"Every post tagged X on Y, newest
  first — the full archive."*
- `content-index/wayfinding.ts` — `"Home"`, the first crumb of every trail.
- `routing/resolver.ts` — the posts archive falls back to the word `"Blog"`.
- `pages/404.astro`, `pages/search.astro` — two entire English pages.
- `layouts/BaseLayout.astro` — `"Skip to content"`, the first focusable element.
- `Breadcrumbs.astro`, `SiteHeader.astro`, `SiteFooter.astro` — `"Breadcrumb"`,
  `"Main"`, `"Footer"`: the accessible names a screen reader announces.

**Boundary:** there is no UI-string seam. A non-English migration must edit
these files. Adding the seam is a feature, not a cleanup, and it should be done
against a real second language rather than invented.

## B3 — Text measurement assumes whitespace-delimited words

`rendering/post-view.ts` counts `split(/\s+/)` at 200 wpm, so a 4,000-character
Japanese article reads as "1 min". `search/search-core.js` splits the query on
spaces — its normaliser is properly Unicode-aware, but without segmentation a
CJK query is one term and matches nothing. `head-model.ts`'s title and
description budgets are counted in JS code units, and 50 CJK characters is not
50 English characters.

**Boundary:** word segmentation needs language data per locale, which the kit
does not carry. The search module's header already says so for stemming and
stop words; this is the third member of that list.

## B4 — One example form lives in generic code

`forms/definitions.ts` hardcodes a `contact` form with English labels, and
`formByKey` throws for any other key. A stranger's second form means editing a
generic module — site identity entering `src/`, which the kit's own principle
forbids. Compare `templates/custom-type-templates.ts`, which ships an empty
registry with instructions and no fixture inside it; that is the shape this
should take.

## B5 — Every site is an `Organization`

`rendering/head-model.ts` emits `"@type": "Organization"` structured data for
every site. A personal blog, a portfolio or an author site is a `Person`, and
this is a claim the site makes about itself with no configuration behind it.

---

## What this means for the trial

The trial should be run with a site that is **ASCII-slugged and English**, or
these boundaries will dominate the findings and hide everything else. A second
trial against a non-Latin, non-English site is the right way to attack B1–B3 —
with the real install in front of us, which is the only way any of the other
measurements in this kit were made worth trusting.
