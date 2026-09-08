# What a stranger site hits first

**Status:** Draft
**Owner:** Engineering
**Last updated:** 2026-09-08 (non-Latin trial)
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

## The trial happened. What it closed, and what it did not

The last section of this file used to say a non-Latin trial was "the right way
to attack B1–B3". It was run against **ja.wordpress.org** — 642 posts, 78
pages, 29 tags, 21 categories, `/%year%/%monthnum%/%day%/%postname%/`
permalinks, library on `/files/`, 585 of 642 titles non-ASCII.

| | before the trial | after |
| --- | --- | --- |
| **B1** slugs must be ASCII | 3 posts and 7 tags refused; 9 posts kept a tag reference to a term the registry had silently dropped | **closed** — `content-model/slug.ts` is the one alphabet, percent-decoding is reported per row, and every refusal names which of three reasons it was |
| **B2** engine strings are English | unchanged | **open**, and now measured: on a Japanese site the archive descriptions, the breadcrumb, the 404 and the skip link all render in English |
| **B3** text measurement assumes spaces | a 4,000-character Japanese article read as "1 min"; the search normaliser turned `だいじ` into `たいし` | **closed** — `Intl.Segmenter` for both word count and search terms, and diacritic folding is now Latin-only |
| **B4** one example form in generic code | unchanged | **open** |
| **B5** every site is an `Organization` | unchanged | **open** |

Four defects the trial found that this file did not predict, all of them about
the kit assuming *its own* configuration rather than about language:

1. **A page slug is unique per PARENT, not per site.** `/security/` and
   `/about/security/` are two pages both named `security`. The transform wrote
   both to `content/pages/security.md`; the second overwrote the first, and the
   report said "71 entries" while 67 files existed. Four pairs on this site.
   Now `duplicate-slug`, named, with both source ids and both live URLs.
2. **Nothing ever asked the source what language it publishes in.** REST
   carries no language field — measured — so the kit's `en` default was written
   into 709 Japanese entries and every gate passed. The capture now reads
   `<html lang>` and the transform refuses a locale that contradicts it.
3. **The link internaliser assumed the source host serves only this site.**
   ja.wordpress.org also runs the forums, the plugin directory and the team
   handbook, and it serves release archives from its root. 4,253 links that
   WORKED as absolute URLs became 404s. Now: a file the build does not emit
   stays absolute, and `notMigratedPaths` declares the rest.
4. **Four gates asserted against the kit's shipped configuration**, not the
   project's: the content-contract fixtures (locale `en`, uploads at
   `/wp-content/uploads/`), the render contract (the same path, thirteen
   times), the browser chrome spec (`/blog/` rather than `permalinks.postsIndex`)
   and `.prettierignore` (`content/blog/posts/`, a directory this kit has never
   written to — so `pnpm format` rewrote 642 migrated bodies).

The worst of those is not the breakage. It is that **the media browser check
was a false negative**: its rule was `url.includes("/wp-content/uploads/")`,
so on a site whose library is at `/files/` every image could still have been
served by the old WordPress install and the check that defines "migrated"
would have passed. It asks `identifyAsset` now.

## B1 — Slugs must be ASCII kebab-case · ~~fails hard~~ **CLOSED**

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

**Closed.** The alphabet is `\p{Ll}\p{Lo}\p{Lm}\p{N}\p{M}_` joined by single
hyphens, and it lives in one module both the schema and the transform import.
`\p{Lm}` is the one a remembered alphabet leaves out: `ー` (U+30FC) is in most
katakana slugs there are, `ベータ` among them.

Percent-decoding is a REPORT, not a silence: `content:transform` prints every
slug whose stored spelling differed from the served one. Refusals keep their
three names — `malformed-escape` (real: this site publishes `href="%s"`, and
`decodeURIComponent` throws on it), `not-nfc`, `outside-alphabet`.

NFC is required rather than applied, and the reason is the filesystem.
Measured on macOS (APFS): a file written under an NFD name is found under its
NFC spelling. On Linux they are two files. So a content tree holding both
spellings of one slug is one entry on a laptop and two in CI, and neither
machine reports anything. Normalising silently would hide that; refusing names
it while it is still one row in a capture.

**Still a boundary:** `paginationSegment` and `nicename` keep their ASCII
rules. Neither was exercised by this trial — the source's pagination segment is
`page` and its author nicenames are ASCII — and a rule widened without a case
in front of it is a guess.

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

## B3 — Text measurement assumes whitespace-delimited words · **CLOSED for two of three**

`rendering/post-view.ts` counts `split(/\s+/)` at 200 wpm, so a 4,000-character
Japanese article reads as "1 min". `search/search-core.js` splits the query on
spaces — its normaliser is properly Unicode-aware, but without segmentation a
CJK query is one term and matches nothing. `head-model.ts`'s title and
description budgets are counted in JS code units, and 50 CJK characters is not
50 English characters.

**Closed for reading time and search.** `Intl.Segmenter` carries the language
data; the kit does not have to. Measured: the same 4,000-character Japanese
article now reads 4 minutes rather than 1, and `WordPress 7.1リリース候補版4`
indexes as `wordpress · 7.1 · リリース · 候補 · 版 · 4` instead of as three
tokens one of which nothing could match.

The search normaliser had a second defect the old text called "properly
Unicode-aware", and it was not: `NFD` then strip every `\p{Diacritic}` turns
`だいじ` into `たいし` and `バグ` into `ハク`, because dakuten and handakuten are
Diacritic. Those are not accents on a Japanese letter — they make a different
letter, and folding them merges words that mean different things. Folding is
Latin-only now. Greek and Cyrillic are left alone too: `й` is not `и`, and
deciding that it is would be a claim about Russian this kit has no business
making. Marks are no longer treated as punctuation either — that split `দাম`
into `দ` and `ম`, neither of which is a word.

**Still a boundary:** `head-model.ts` counts title and description budgets in
JS code units, and 50 CJK characters is not 50 English characters.

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

## What the kit can now claim, and what it cannot

**Can:** carry a non-Latin slug from `wp/v2` to a served URL without altering
it. Measured end to end — 10 of 10 non-ASCII URLs in ja.wordpress.org's
sitemap are served by the build at the same URL, and a real browser asks for
the same percent-encoding WordPress publishes. 761 of 770 live sitemap URLs
are served in all, and the 9 that are not are the 9 rows the transform
excluded by name.

**Cannot:** publish a page in the reader's language. B2 is untouched, and on a
Japanese build it is visible on every page: the skip link, the breadcrumb, the
404 and every archive `<meta name="description">` are English. That is the
next thing a non-English migration hits, and it is a feature — a UI-string
seam — rather than a cleanup.

**Has not been tested:** a right-to-left script. Nothing here exercises `dir`,
logical properties, or a bidirectional title beside a Latin one. Arabic and
Hebrew slugs pass the alphabet by construction (`\p{Lo}`), which is not the
same as saying the site would read correctly.
