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

|                          |                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The procedure**        | [PLAYBOOK.md](PLAYBOOK.md) — Day 0 through cutover, with the traps that cost the original migration time. [CHECKLIST.md](CHECKLIST.md) is the copy-pasteable version. |
| **A working Astro site** | Pages, posts, category/tag/author archives, pagination, search, a form, breadcrumbs, and the whole head — at **your** WordPress URLs, from one permalink config.      |
| **The launch seams**     | One variable flips preview↔production. One names the media host. One per form names its endpoint. Nothing else changes at cutover.                                    |
| **Content contracts**    | Zod schemas per content set, cross-entry rules, and a fixture suite that proves the schemas still reject what they must.                                              |
| **Quality gates**        | A rendering contract (90 assertions, no browser) and a build audit that reads `dist/` and checks the contract of the environment it was built for.                    |
| **Governance**           | [AGENTS.md](AGENTS.md), an ADR template, a decision registry, a review map and a sign-off record — for the questions only a person can answer.                        |

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
pnpm validate         # lint, types, content contracts, render contract, build audit

# 4. Read PLAYBOOK.md and start at Day 0.
```

Requires Node 24 and pnpm 10.

## The shape of it

```
migration.config.ts     the source site: origin, permalinks, crawl pacing
content/                pages, posts, registries, menus, redirects, SEO overrides
apps/website/src/
  routing/              permalinks → the route table. One resolver, one catch-all page.
  deployment/           the launch switch, the redirect model, the manifest
  rendering/            the media origin, the head, the sitemap, the body pipeline
  forms/                what a form asks, and separately where it delivers
  review/               the review map and the decision registry
  content-contract/     schemas validated against real files
  render-contract/      the two gates: pure-Node, and dist-reading
packages/tokens/        design tokens — every value marked `provisional`
packages/ui/            the Foundation primitives
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
people believe covers more than it does is worse than no gate.

**Sample content cannot ship.** Every entry carries `source.system`, and a
production build fails while any of it says `sample`. That is the gate that
stops the kit's own pages from becoming somebody's website.

## Where it came from

Extracted from the easy.jobs WordPress→Astro migration (2026). The numbers in
PLAYBOOK.md's "what happened" notes are that project's measurements, kept
because a trap with a measurement attached is a trap people believe.

MIT licensed. Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
