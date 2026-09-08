# `seo:capture` — the metadata the source publishes about itself

```sh
pnpm content:capture --type post && pnpm content:capture --type page
pnpm seo:capture            # → content/seo/overrides.json
pnpm seo:capture --titles   # also carry the source's <title> strings
pnpm seo:capture --dry      # report, write nothing
```

## Why this exists

Found by comparing a migrated site against its source, not by reading code:
**all 33 published entries had a hand-written `<meta name="description">` and
the migration had lost every one.** Eleven pages also carried `noindex`, which
was lost with them. On a marketing site those descriptions are a migration
asset in the same way the copy is — somebody wrote them.

They are not in REST. Measured on a site running Rank Math:

```
GET /wp-json/wp/v2/posts/1918?_fields=meta  →  {"meta":{"footnotes":""}}
```

SEO plugins keep title and description in postmeta and do not register them in
the public schema. The rendered `<head>` is the one place every one of them
agrees to put the result, so that is what this reads — **plugin-agnostically**.
It knows nothing about Rank Math, Yoast or AIOSEO; it reads the standard tags.

## What it writes

Into `content/seo/overrides.json`, the table `rendering/head-model.ts` already
reads. A row is written only where the source says something the kit would not
derive anyway:

| field             | when                                                                      |
| ----------------- | ------------------------------------------------------------------------- |
| `metaDescription` | whenever the source has one — the kit's own fallback is derived body text |
| `ogImage`         | when the source names one and **nothing else will supply it**             |
| `robots`          | only for `noindex` / `nofollow`                                           |

**`metaTitle` is not written by default.** The source's `<title>` carries its
own separator and site-name convention (`Guide - Storeware`), and the kit
composes titles itself (`Guide – Storeware`). Copying them would freeze the
source's formatting into the new site. `--titles` opts in.

**`canonical` is not written at all.** The kit's canonical is self-referencing,
and the audit measured it as byte-identical to the source's on every page
sampled. A stored copy would be a second answer that can go stale.

## The og:image rule, and the bug in its first draft

Only a **post** carries `featuredImage` in the content model, so only a post can
supply its own og:image. The first version skipped any entry with
`featured_media > 0` — and the home PAGE had one, whose image the content model
has nowhere to put. It dropped the home page's social image entirely. The rule
is now about what the content model will supply, not what the source has.

An og:image is an ordinary media reference: it goes through `mediaRef`, the
media engine copies it, and `pnpm media capture` brings it local like any other.

## Boundaries

- **Entries only.** Category, tag and author archives are not read: measured,
  the source published no description for them, and the kit derives one.
- **One request per published entry**, paced by `crawl.delayMs`. A page that
  does not answer 200 is reported and the command exits non-zero — its route
  keeps the derived metadata, and that is a gap rather than a silent success.
- **Nothing is invented.** A page whose head says nothing produces no row.
