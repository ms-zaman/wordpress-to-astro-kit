# Checklist

The playbook, as things to tick. Copy it into an issue.

## Day 0 — ask these before writing code

- [ ] **Access.** Is the REST API public? Is there an admin login, an
      application password, a database export? _Owner: site owner_
- [ ] **Design source.** A design file, or parity with the live site?
      _Owner: design_
- [ ] **Production origin and cutover.** Which domain, replacing or beside
      the old site, and roughly when? _Owner: site owner_
- [ ] **URLs.** Do they stay? (Default: yes.) _Owner: SEO / site owner_
- [ ] **Forms.** Where does each submission go, and who owns the stream?
      _Owner: the business_
- [ ] **Product surfaces.** Which paths are served by an app rather than the
      site? _Owner: product_

Each one: answered, or a row in `apps/website/src/review/decision-registry.ts`
with an owner and an impact.

## Discovery

- [ ] `robots.txt` and every sitemap saved to `research/`
- [ ] Live crawl recorded — politely, with the date and method
- [ ] Beyond the sitemap: date, author, tag archives; pagination; feeds;
      language prefixes
- [ ] Content census: every post type and taxonomy with its count
- [ ] Which bodies are block, classic, or builder-rendered
- [ ] Presentation census: theme, builder, plugins — content vs presentation
- [ ] **Design measured** into `packages/tokens/src/tokens.css`, `provisional`
      markers deleted as they are replaced
- [ ] Integration census: forms and their destinations, analytics, embeds
- [ ] Synthesis in `docs/01-discovery/`, every number dated and sourced

## Configure

- [ ] `pnpm kit:init --name … --site-name … --origin … --live-origin …`
- [ ] `migration.config.ts`: permalinks copied from the source site's settings
- [ ] `postsIndex`, `postsPerPage`, `frontPage`, language prefixes
- [ ] Crawl pacing and an honest user agent
- [ ] `content/config/site.json` and `locales.json`
- [ ] `pnpm validate` green
- [ ] The sample site walked in a browser

## Decisions

- [ ] Eight ADRs written as proposals with their evidence
- [ ] A person has accepted or rejected each
- [ ] Day-0 answers recorded in the decision registry

## Foundation

- [ ] Tokens are measured values, not placeholders
- [ ] A schema per content set, each with an owner and a README
- [ ] Chrome renders from the menu data
- [ ] No copy anywhere describes the build rather than the site

## Content, per set (legal → docs → posts → the rest)

- [ ] Captured to `research/` as evidence; transform is a separate pure module
- [ ] Bodies verbatim; migrated directories in `.prettierignore`
- [ ] Inherited defects recorded as dispositions, not fixed
- [ ] Media paths byte-for-byte; renditions probed, never guessed
- [ ] Gates grepped for site-wide ratios and `length === N` **before** import
- [ ] Listing and archive **looked at** at 1440 and 375 after import
- [ ] `pnpm validate` green

## Pages, per page

- [ ] Live page captured at four viewports before building
- [ ] Words from the live site; layout from the design
- [ ] Bands hidden at every breakpoint not built
- [ ] Values painted, not merely declared
- [ ] Walked before any screenshot baseline is recorded

## Launch

- [ ] Live URLs diffed against `dist/` — every one a page, a redirect, or a
      recorded retirement
- [ ] `content/redirects.json` complete; every target is a real page
- [ ] `WPK_SITE_ENV=production pnpm build` + build audit green
- [ ] No sample content remains (the audit enforces this)
- [ ] Rendered text read for phrases describing the build
- [ ] **The walk**: every new and changed route at 1440, read to the bottom
- [ ] Sign-off recorded with the name of whoever looked
- [ ] Media host confirmed or mirrored
- [ ] Forms wired, or honestly saying they are not
- [ ] Deployed to a temporary hostname and verified: a redirect, `robots.txt`,
      the sitemap, a migrated page's images
- [ ] DNS pointed; sitemap submitted
