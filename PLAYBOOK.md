# The playbook

How to migrate a WordPress site to Astro, in the order the steps have to
happen. Each phase says what to do, what to check before moving on, and — in
**what happened** notes — what went wrong the first time, with the
measurement that makes the trap believable.

The order matters more than any individual step. Almost every expensive
mistake in a migration is work done before the thing it depends on was known.

---

## Day 0 — six questions, asked before any code

These six were answered late in the original project, and every one of them
changed work that had already been done. Ask them on day one. If an answer
does not come, write down the assumption you are proceeding on, put it in the
decision registry with the person who owns it, and carry on — but ask.

1. **What access is there to the source site?** Is the REST API public? Is
   there an admin login, an application password, a database export? This
   decides the whole capture strategy.
2. **Where does the design come from** — a design file, or parity with the
   live site? This decides where every measurement comes from.
3. **What is the production origin, and what kind of cutover?** Replacing the
   domain, or a new one? This decides canonicals, the sitemap and redirects.
4. **Do the URLs stay?** Almost always yes, and that is the default here. Any
   change is a redirect and a ranking risk.
5. **Where do form submissions go, and who owns each lead stream?**
6. **Which surfaces belong to a product or an app rather than the site?** A
   static build cannot reproduce them, and where they live after cutover is
   somebody else's decision.

> **What happened.** All six were open for most of the project. The URL shapes
> were built one way and rebuilt to match live's later: 136 post files edited,
> nine redirect families, 386 rules. The design source was settled on day 14.
> Four of six forms had no owner at release.

**Before moving on:** every question is either answered or a row in
`apps/website/src/review/decision-registry.ts` with an owner.

---

## 1. Discovery — measure, never assume (2–3 days)

### 1.1 The URL census

Fetch `robots.txt` and every sitemap. Crawl the site politely — one request at
a time, a fixed delay, GET only, same origin, an honest user agent — and
record what answers. The sitemap is **not** the site: date archives, author
archives, tag archives, paginated pages, feeds and language prefixes are all
live and usually absent from it.

Write the inventory to `research/` with the date, the method and the
conditions. It is the left-hand side of every later comparison.

> `pnpm sitemap:crawl` does this: `robots.txt` to sitemaps to links, paced by
> `migration.config.ts`'s `crawl` block, written dated into `research/`. Then
> `pnpm sitemap:audit` classifies every URL against your build and fails while
> any is unaccounted for. **The sitemap is not the site** — measured on a real
> one, eight sitemap documents listed 431 URLs and links found 955 more.

> **Trap.** A firewall that notices a burst will block the REST API for an
> hour or more while pages keep answering 200. An inventory captured in that
> window is FALSE and looks fine. Pace every loop (`migration.config.ts`
> holds the delays); if you trip it, wait it out — retrying deepens it.

### 1.2 The content census

`pnpm content:census` does exactly this: `wp/v2/types`, `wp/v2/taxonomies`, then
per type `?per_page=1` and read `x-wp-total`. One request per route, and it
sizes the whole migration — on a real site, 4,786 attachments, 278 posts, 121
docs and 30 pages in 29 requests. It also names the routes that genuinely
refuse an anonymous reader.

Read a few bodies. Note which are block-editor, which are classic, which are
a page builder — a builder-rendered post often returns only an intro over
REST, because the body lives in postmeta. Those you capture from the rendered
page instead.

> **What happened.** 278 posts: 251 returned complete bodies to an anonymous
> reader, 27 returned a median of 457 characters. The whole blog had been
> recorded as blocked behind a credential; only 27 posts needed a different
> route, and none needed a login.

### 1.3 The presentation census

Theme, page builder, plugins. Which plugins produce *content* (a forms
plugin, a docs plugin) versus *presentation*. Anything shipping a shortcode
or a widget the successor must reproduce or retire.

**Name the builder, and write it into `migration.config.ts`.** WordPress is not
one editor: Gutenberg, Elementor, Divi, WPBakery, Beaver Builder and the classic
editor all render the same CMS differently, and a site older than a few years
usually carries two of them. Two later steps depend on this answer and get it
wrong silently if you skip it:

- `sourceMarkup.builders` tells the reconciler which classes mean "this section
  paints at no width". Wrong builder, and it drops nothing while reporting that
  it did.
- §5's capture uses it to predict which bodies will arrive as stubs — a builder
  that keeps its document in postmeta hands `content.rendered` an intro and
  nothing else.

If the builder has no profile in the kit, that is not a blocker: open a section
the site never paints, read the classes off it, and put the set in
`sourceMarkup.hiddenEverywhere`. Guessing them is worse than leaving it empty.

**One builder is not the whole answer either.** Check a post from each era, not
just the newest — the census that matters is which builders appear across the
corpus, and in what proportion.

**And name every post type.** `pnpm content:census` lists what the install
registers and says what this kit is configured to do with each: core,
configured, withheld, unconfigured, or internal to WordPress. A type reported
as **unconfigured** is a decision waiting — nothing routes a type the kit was
not told about, because nothing about a type says whether it should be a public
URL. Decide, write a profile into `postTypes`, or record that it is not
migrating. [scripts/custom-types/](scripts/custom-types/README.md) states what a
profile can and cannot express.

**And every taxonomy.** The census answers the same five ways for taxonomies.
The URL shape is the part nobody can discover: measured, `wp/v2/taxonomies`
carries no rewrite and a taxonomy's name is not its URL base — one live install
serves `doc_category` terms at `/docs-category/`. Open a term archive on the
source site and read the prefix off the address bar; a captured term's `link`
field is the evidence to check it against.
[scripts/taxonomies/](scripts/taxonomies/README.md) states that boundary.

### 1.4 Measure the design — before building anything on it

Open the live site in a real browser and read computed styles: font families
and sizes per role, the container width, the gutters at each breakpoint, the
primary action colour, heading and body colours, the gap between sections at
375 and at 1440. Write them into `packages/tokens/src/tokens.css` and delete
the `provisional` markers as you go.

`pnpm a11y:audit` reads the palette back out of the CSS your build SHIPPED and
holds every pair the components composite to its WCAG threshold, so a value that
is unreadable as text fails the moment you paste it. Add a row to
`CONTRAST_PAIRS` for every new pair a component of yours composites — a pair
that is not in that table is a ratio nobody has measured.

**Self-host the fonts while you are here** (`packages/tokens/src/fonts.css`).
It is what makes `pnpm render:digest` comparable between your machine and CI;
on a system font stack the two render different typefaces and no baseline can
survive the trip.

> **What happened.** The token file claimed its values were measured from the
> live site. They were a page builder's unused global palette: six of twelve
> colours were painted nowhere on the site being copied, the display heading
> was 48px against the real 80px, the container 1140 against 1320. Everything
> built on them was rebuilt.

> **Do this even when a design file exists.** Layout, colour and type come
> from the design; the words come from the live site; and a band the live site
> hides is a band you do not build.

### 1.5 The integration census

Forms and where each one delivers. Analytics. Chat. Anything embedded. For
each: what it is, and whether the successor reproduces it, replaces it or
drops it.

**Before moving on:** a synthesis in `docs/01-discovery/` where every number
has a date, a method and a link to the raw evidence. Unknowns say
"Unknown — not yet investigated", never a plausible guess.

---

## 2. Configure the kit (half a day)

`pnpm kit:init --name <you> --site-name "…" --origin … --live-origin …`, then:

- **`migration.config.ts`** — the permalink patterns, copied from the source
  site's Settings → Permalinks. `postsIndex`, `postsPerPage`, `frontPage`. Any
  language prefixes. Crawl pacing and an honest user agent.
- **`content/config/site.json`** — name, tagline, logo, profile links.
- **`content/config/locales.json`** — every locale you will publish.

Run `pnpm validate`. Then open the site and click through it: the sample
content is there to be walked, so you can see the shape before it is yours.

> **Changing a permalink moves the pages, not the menus.** A menu row carries
> the URL it points at, because menu structure is content. The build audit
> checks every internal link against the routes the build produced, so a
> chrome link left behind fails on every page at once rather than quietly.

---

## 3. Decisions (half a day)

Every migration answers the same nine questions. `decisions/ADR/` holds a
template and the list. Write each as a proposal with the evidence behind it;
a person accepts it. An ADR that cites no research is a guess with formatting.

**Before moving on:** every decision is Proposed or Accepted, and the Day-0
answers are recorded in the decision registry.

---

## 4. Foundation (1–2 days)

Tokens from §1.4. Content schemas per set — one subdirectory, one schema, one
owner. Site chrome from the menu data.

**Write no copy that describes the build.** "This preview", "sample content",
"coming soon" — chrome repeats on every page, and no audit reads prose for
truth. The build audit reports such phrases; it cannot judge them.

> **What happened.** Five form notices said "This preview does not send
> messages yet". Under a production build that rendered on 306 public pages.
> Every environment-aware surface was correct; the hard-coded sentences were
> not, and no gate could see them.

---

## 5. Content migration — low risk first (3–6 days)

Order: **legal/utility pages → documentation → posts → everything else.**
Small and classic first, volume second, builder-heavy last.

For each set, the same loop:

1. **Capture to `research/`** as evidence — `pnpm content:capture --type <name>`.
   Fetch and transform stay separate modules, so they can be reviewed apart;
   the capture is written for you and the transform is yours, deliberately.
   The capture reports which bodies did not come back whole and fetches those
   pages, because a page builder keeps its document in postmeta and
   `content.rendered` carries only what the classic editor held.
2. **Carry the body verbatim.** It is the source's rendered HTML. Do not
   convert it to Markdown; do not reword it. Put migrated bodies in
   `.prettierignore` — a formatter is not supposed to touch transcribed
   evidence.
3. **Record inherited defects, do not fix them.** A typo in the source is a
   typo here, with a disposition row saying so. Silent improvement and silent
   loss are the same failure.
4. **Media paths stay byte-for-byte.** Only the origin is a variable. Probe
   which renditions actually exist before writing a `srcset` — a guessed
   rendition is a broken image, not a smaller one.
5. **Before importing, grep the gates** for site-wide ratios, `length === N`
   and substring checks against HTML. The one that bites hardest is any rule
   that reasons about a MAJORITY of pages: importing 250 posts makes one
   template 79% of the site, and `accessibility-audit`'s nav rule had to become
   per-template-family because of exactly that.
6. **After importing, LOOK at the listing and the archive** at 1440 and 375,
   beside the live one.
6b. **Reconcile the pages you have built.** Add a row to `routePairs`, run
   `pnpm content:reconcile-fetch` once, and `pnpm content:reconcile` from then
   on: it fails on any string the source paints that yours does not say, and on
   any copy yours says that the source has no trace of.
7. `pnpm validate` green, then the set is done.

> **What happened, twice.** Importing 251 posts broke twelve checks and not
> one was a content defect: they were assumptions that only held while no
> single template dominated. And the listing design, built when the
> collection held two samples, was a wall of 740px-tall cards at 251 — every
> gate green, because a listing has no "wrong layout" assertion. The owner
> saw it in a screenshot.

> **A formatter nearly undid it.** `pnpm format` collapsed 32,100 blank lines
> across 251 migrated bodies on its first run. Nothing visible was lost, and
> the byte-for-byte comparison against live would have been over.

---

## 6. Pages (as many days as pages)

One page, one mission, one record in `docs/04-implementation/`.

Evidence first: capture the live page's structure and painted properties at
four viewports. Build. Then compare — the words against the live page, the
layout against the design.

- **A band hidden at every breakpoint is not built.** Hidden at three but
  painted at one is built.
- **Painted, not declared.** A page builder's data describes what the
  document contains, which is not the same as what a reader sees.
- **Walk it before you baseline it.** A screenshot baseline proves a page has
  not changed. The first render of a new page has nothing to differ from, so a
  baseline taken before a person looks records the defect as the reference.
  `pnpm render:digest -- --shots` writes a full-page PNG per route per width;
  look at those, then `--update`, then read the diff.
- **Run the browser gates on each new page.** `pnpm layout:audit` measures
  overflow at six widths and `pnpm contrast:audit` measures every string
  against the ground actually painted behind it — neither of which can be
  answered by reading markup.

---

## 7. Launch (2–3 days)

1. **Diff live against `dist/`.** Every live URL is a page, a redirect, or a
   recorded decision to retire it. No fourth category.
2. **Build the redirect table** from that diff into `content/redirects.json`.
   Every target must be a page the build produces; the audit enforces it.
3. **Build for production** and audit it: `WPK_SITE_ENV=production pnpm build`
   then the build audit. It checks the production contract, not the preview's,
   and refuses to pass while sample content remains.
4. **Read the rendered text** for phrases that describe the artifact rather
   than the site. The audit lists candidates; the judgement is yours.
5. **The walk.** Open every new and changed route at 1440, scroll to the
   bottom, and read it. On a prose page, read it for content that does not
   belong there.
6. **Record the sign-off** in `apps/website/src/release/signoff.ts`, with the
   name of whoever actually looked, the commit, the routes walked, and the
   render-digest fingerprint at the time. Permission to proceed is not a
   review. `pnpm release:review` reads that record back and reports
   `RC_READY` / `RC_REVIEW_REQUIRED` / `RC_BLOCKED`; a sign-off carries forward
   to later commits only while the digest is unchanged.
7. **Cutover:** media host confirmed or mirrored → forms wired → deploy
   production to a temporary hostname → verify a redirect, `robots.txt`, the
   sitemap and a migrated page's images → point DNS → submit the sitemap.

> **What happened, in the kit itself.** Building this repository's twelve gates
> and then walking its own six-page sample site found four defects every gate
> had passed: a footer reading `© 2026Example Site` because two adjacent Astro
> expressions emit nothing between them; an author bio rendering literal
> Markdown backticks; a date and a label painted in `--color-link`, the one
> token that means "this is a link"; and a screenshot showing `#` where `©`
> should be, because the digest photographed the page after its own emoji
> normalization. Six pages. Four defects. Twelve green gates.

> **What happened, in the original project.** Three releases, three walks, seven
> defects, every gate green each time. An article page that had never been inside the site's
> container. A policy page rendering the live site's entire footer as prose
> in its body. A heading at 1.06:1 on its own band. None was findable by a
> gate: a decorative element has no text to measure, a valid layout is not
> flagged as the wrong one, and text-presence reconciliation passes when the
> words genuinely appear on the live page — just not in that part of it.

---

## What this kit deliberately does not have

**A synthetic migration framework.** The original project built sixteen
modules and 557 assertions modelling a migration pipeline over invented
fixtures. It reduced no blocker and found no defect. The gates that found
defects all read the real artifact: `dist/`, the live page, the content tree.
Capture the real thing early instead.

**A design.** The tokens are neutral placeholders. §1.4 is the step that
replaces them, and it is first for a reason.

**The transform from a capture to your content entries.** `content-capture`
writes the source site's posts to `research/`, verbatim and dated, and
`content-reconcile` proves your built page says what the source page says. What
sits between them — mapping a captured post onto your collection's schema — is
left to you deliberately, because it is the one step that depends entirely on a
schema the kit cannot know. Write it as a script in your own repo; the capture
is stable JSON and the reconciler is the gate that tells you it landed.
