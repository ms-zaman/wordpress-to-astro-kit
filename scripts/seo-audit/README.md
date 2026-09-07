# `seo-audit`

On-page SEO, checked against the built output.

```
pnpm seo:audit        # build, then audit
pnpm seo:audit-test   # the suite: unit + one mutation per rule
```

## Why a gate and not a checklist

"Follow SEO best practice" is a sentence, and a sentence does not survive twenty
weeks. Every rule here can be stated as a property of the built HTML and then
broken on purpose to prove the check notices — which is what the suite does, one
mutation per rule, each on a fresh copy of a synthetic build.

## What it checks

| Check             | Contract                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `title`           | One per page, within budget, unique across the build                                                                   |
| `description`     | One per page, within bounds, not the title again, unique                                                               |
| `social`          | Every production page carries the Open Graph and Twitter head, and it AGREES with the page's own title and description |
| `canonical`       | Both directions against the origin seam — see below                                                                    |
| `robots`          | Every page emits what the launch switch decided for the environment this build was made for                            |
| `structured-data` | Every `ld+json` block parses, names schema.org, and carries a type                                                     |
| `head`            | `<html lang>`, a viewport, and no `<meta name="keywords">`                                                             |

## The title budget is graded by who wrote the title

An over-budget title is an **error** on a `static` route — the home page,
`/404`, `/search` — because those are titled by a template in this repository
and the budget is a rule you can simply follow.

It is a **warning** on a route whose title comes from a content entry. In a
migration that entry carries the source site's title verbatim: those titles are
the articles' names and their search identity, and shortening one is an
editorial act. In the project this came from, 175 of 278 were over budget. It
stays reported and counted on every run; rewriting them is a decision to record,
not a gate to satisfy.

Without a manifest every page is treated as yours. That is the strict direction.

## The origin is half the contract

`content/config/site.json` decides whether a production origin exists. That is
not a gap this audit ignores — it is a state it checks:

- **With no origin**, no page may emit a canonical, an `og:url`, or a relative
  `og:image`. A canonical pointing at a placeholder is an instruction to
  crawlers to index a domain you do not own.
- **With an origin**, every production page carries exactly one absolute
  canonical, **on your own origin**.

That last clause is the one that is easy to omit, and omitting it let the defect
through twice: `https://example.com/anything` is absolute, so a rule that only
checked absoluteness passed it the moment an origin was configured.

The CLI prints which half applied on every run, because a clean result means
something different under each. The suite runs both halves, because whichever
one is not your current state would otherwise rot until the day it mattered.

## What it deliberately does not check

| Property                            | Already checked by        |
| ----------------------------------- | ------------------------- |
| One `h1`, no skipped heading levels | `pnpm a11y:audit`         |
| Every image has an `alt`            | `pnpm render:build-audit` |
| No broken internal link             | `pnpm preview:audit`      |
| No horizontal overflow              | `pnpm layout:audit`       |

A second copy of any of those would be a second thing to keep in step.
