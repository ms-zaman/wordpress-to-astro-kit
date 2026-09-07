# wordpress-to-astro-kit

A boilerplate **and a procedure** for migrating a WordPress site to Astro.

Most of the work in a migration is not the framework. It is knowing what the
old site actually publishes, carrying it across without losing or inventing
anything, and being able to prove that on the day you cut over. This kit is
the tooling and the sequence for that, extracted from a real migration —
482 routes, 278 posts, 121 docs, twenty days, one live cutover.

**It is not a theme.** It ships a working site with a deliberately plain
design, so that the first thing you do is measure the real one.

## What you get

|                          |                                                                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The procedure**        | [PLAYBOOK.md](PLAYBOOK.md) — Day 0 through cutover, with the traps that cost the original migration time. [CHECKLIST.md](CHECKLIST.md) is the copy-pasteable version.                                                                          |
| **A working Astro site** | Pages, posts, category/tag/author archives, pagination, search, a form, breadcrumbs, and the whole head — at **your** WordPress URLs, from one permalink config.                                                                               |
| **The launch seams**     | One variable flips preview↔production. One names the media host. One per form names its endpoint. Nothing else changes at cutover.                                                                                                             |
| **Content contracts**    | Zod schemas per content set, cross-entry rules, and a fixture suite that proves the schemas still reject what they must.                                                                                                                       |
| **Discovery tooling**    | A polite crawler and URL diff, a REST content census, a capture that reports which bodies did not come back whole, and a reconciler that asks whether your page says what the source page says.                                                |
| **Fourteen gates**       | Content, docs, rendering, the built artifact, accessibility, SEO, overflow, rendered contrast, appearance, the controls operated in a browser, the URL diff, the reconciler, and one release verdict over all of it. See [scripts/](scripts/). |
| **Governance**           | [AGENTS.md](AGENTS.md), an ADR template, a decision registry, a review map and a sign-off record — for the questions only a person can answer.                                                                                                 |

## What is here, and what is not yet

Release 0.2. Read this table before the quick start, so nothing below promises
more than the repository holds.

|                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Here**       | The Astro app and its seams · the content contracts · the twelve gates in [scripts/](scripts/), each with its own suite · `kit:init` · the playbook, checklist and governance templates                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Not yet**    | Nothing in the procedure is unsupported. The one step the kit deliberately leaves to you is the **transform** from a capture to your content entries — see below.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Limitation** | **One locale is routed, and the others are NAMED.** Entries in other locales are validated, listed in the manifest as intended, and reported by `content:integrity` as `EXCLUDED` with a typed reason — withheld rather than vanished. No URL strategy for translations is assumed; the seam is the `locale` argument of `resolveSiteRoutes`, and multilingual routing is decision 5 in `decisions/ADR/`. Locale codes are HTML language tags: `en`, `pt-BR`, `zh-Hans`, `en-GB`. WordPress's underscore form (`pt_BR`) is refused with a diagnostic, not silently accepted into `<html lang>`. |
| **Limitation** | **No render-digest baselines ship.** A digest is only comparable across machines when the site self-hosts its fonts, and the kit ships a system font stack until you measure a real design. Record yours after your first walk — [research/render-digest/](research/render-digest/README.md) says when and how.                                                                                                                                                                                                                                                                                 |

Discovery is covered. `pnpm sitemap:crawl` reads the source site's URLs and
[diffs them against your build](scripts/site-map-audit/README.md);
`pnpm content:census` asks its REST API what it publishes and how much, and
`pnpm content:capture` downloads a type into
[research/](research/README.md) with a report of which bodies did not come back
whole.

## Quick start

```sh
# 1. Use this template on GitHub, or clone it.
git clone <your-copy> my-site && cd my-site

# 2. Make it yours. This renames the placeholder prefix everywhere
#    (classes, build variables, workspace packages) and writes your identity.
pnpm install
pnpm kit:init --name acme --site-name "Acme" \
  --origin https://acme.com --live-origin https://old.acme.com
pnpm install          # refresh the workspace links after the rename

# 3. Prove it builds before you change anything.
pnpm validate         # lint, types, contracts, build, and seven gates
pnpm stage            # the four that need a browser (see below)

# 4. Read PLAYBOOK.md and start at Day 0.
```

Requires Node 24 and pnpm 10. `pnpm stage` additionally needs a Chrome-family
browser on the machine: three gates drive one through the DevTools protocol and
deliberately download none, and `pnpm test:browser` brings its own Chromium
(`pnpm exec playwright install chromium`).

## The shape of it

```
migration.config.ts     the source site: origin, permalinks, crawl pacing, route pairs,
                        which page builder built it. Every field has a reader.
content/                pages, posts, registries, menus, redirects, SEO overrides
research/               evidence: crawls, captures, the render-digest baselines you record
apps/website/src/
  routing/              permalinks → the route table. One resolver, one catch-all page.
  deployment/           the launch switch, the redirect model, the manifest
  rendering/            the media origin, the head, the sitemap, the body pipeline
  forms/                what a form asks, and separately where it delivers
  review/               the review map and the decision registry
  release/              the sign-off record and the release-candidate rules
  content-contract/     schemas validated against real files
  render-contract/      the two gates: pure-Node, and dist-reading
packages/tokens/        design tokens — every value marked `provisional`
packages/ui/            the Foundation primitives
scripts/                the gate ladder — see scripts/README.md
  lib/                  the shared seams: a Chrome driver, a static server, route discovery
  preview-audit/        is the ARTIFACT whole?
  accessibility-audit/  outlines, landmarks, focus, and every token contrast pair
  seo-audit/            the head a crawler needs
  layout-audit/         overflow, at six widths, in a browser
  contrast-audit/       text against the ground actually painted behind it
  render-digest/        what every page looked like, as a text diff
  browser-tests/        the controls, operated
  release-audit/        is this a release candidate, and has a person walked it?
  docs-validator/       does every cross-reference still resolve?
  site-map-audit/       what the source site publishes, against what this build does
  content-capture/      the content census, and one post type captured to evidence
  content-reconcile/    does our page SAY what the source page says?
  content-integrity/    did every entry in content/ reach dist/, by identity?
  kit-init/             making the placeholder prefix yours
```

## Three ideas worth knowing before you start

**Your URLs are configuration, not file names.** `migration.config.ts` holds
WordPress's own permalink patterns (`/%year%/%monthnum%/%postname%/`,
`/category/%slug%/`). One resolver expands them; no route file is named after
a URL. Keeping the live site's URLs is a config edit, not a refactor.

**A gate proves a contract, not correctness.** Every gate here states what it
checks in its own header, and the ones that matter most are honest about what
they cannot see. The build audit reports phrases that might describe the build
rather than the site, and leaves the judgement to you — because a green gate
people believe covers more than it does is worse than no gate. Twelve green
gates still do not tell you a page is any good: PLAYBOOK.md §7 step 5 is the
walk, and building this kit's own sample site, the walk found four defects the
gates had passed.

**Sample content cannot ship.** Every entry carries `source.system`, and a
production build fails while any of it says `sample`. That is the gate that
stops the kit's own pages from becoming somebody's website.

**Every tool that touches the source site reads and never writes.** GET only,
same origin, one request at a time, the delay from your config between every
one, and an honest user agent the tools warn about while it is still the
placeholder. A failure is recorded rather than retried, because retrying into a
rate limit deepens it — and a crawl taken through one returns a smaller site
that looks entirely plausible.

## Where it came from

Extracted from the easy.jobs WordPress→Astro migration (2026). The numbers in
PLAYBOOK.md's "what happened" notes are that project's measurements, kept
because a trap with a measurement attached is a trap people believe.

MIT licensed. Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
