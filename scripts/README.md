# `scripts/`

The gates. Each one states what it checks, and — more importantly — what it
**cannot** see, because a green gate people believe covers more than it does is
worse than no gate.

Zero dependencies except Playwright, Node 24 baseline, no test runner, no build
step. Every tool is read-only: none of them builds, writes to `apps/website/src`,
or repairs anything.

## The ladder

Run in this order. Each rung reads something the one before it produced.

|     | Gate                      | Reads                                       | Needs a browser |
| --- | ------------------------- | ------------------------------------------- | --------------- |
| 1   | `pnpm content`            | the content tree                            | no              |
| 2   | `pnpm docs:validate`      | `docs/`, `decisions/`                       | no              |
| 2b  | `pnpm sitemap:audit`      | a crawl of the source site, against `dist/` | no              |
| 3   | `pnpm render`             | the route and rendering models              | no              |
| 4   | `pnpm render:build-audit` | `dist/`                                     | no              |
| 5   | `pnpm preview:audit`      | `dist/`, as an artifact                     | no              |
| 6   | `pnpm a11y:audit`         | `dist/` and the CSS it shipped              | no              |
| 7   | `pnpm seo:audit`          | `dist/`                                     | no              |
| 8   | `pnpm layout:audit`       | every route at six widths                   | **yes**         |
| 9   | `pnpm contrast:audit`     | every route at two widths                   | **yes**         |
| 10  | `pnpm render:digest`      | every route, against a recorded baseline    | **yes**         |
| 11  | `pnpm test:browser`       | the controls, operated                      | **yes**         |
| 12  | `pnpm release:review`     | all of the above, as one verdict            | no              |

`pnpm content:integrity` runs inside `validate`, straight after the build
audit — it is the only gate that reads BOTH sides of the build boundary. Every
other check reads one: the content contract never opens `dist/`, and the build
audit compares the manifest against the emitted files, which are both outputs
of the same build. An entry the resolver dropped in between was invisible to
all of them.

`pnpm validate` runs 1–7 and every suite. `pnpm stage` runs 8–12. CI splits
them into two jobs for the same reason: a machine without Chrome should still
be able to run everything in the first list.

**`test:browser` binds port 4321 and refuses to share it.** Playwright's
default is to adopt whatever already answers there, which means another
project's dev server silently becomes the thing under test — measured, and it
produced sixteen red assertions about somebody else's site. The reverse is
worse: a page that happened to satisfy the selectors would have reported green
for a build the run never loaded. So a busy port is a fatal, named error, and
`WPK_TEST_PORT=4322 pnpm test:browser` is the way past it.

## What each one is for

| Directory                                      | The question it answers                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`lib/`](lib/)                                 | The shared seams: a Chrome driver, a static server, route discovery, the build's own manifest                                                 |
| [`docs-validator/`](docs-validator/)           | Does every cross-reference in the documentation still resolve?                                                                                |
| [`site-map-audit/`](site-map-audit/)           | What does the source site publish, and does this build account for all of it?                                                                 |
| [`content-capture/`](content-capture/)         | What content exists on the source site, will it hand it over, and which bodies did not come back whole?                                       |
| [`content-reconcile/`](content-reconcile/)     | Does your page SAY what the source page says, and is anything on it invented?                                                                 |
| [`content-integrity/`](content-integrity/)     | Did every entry in `content/` cross the build boundary, and can every emitted page name the content behind it?                                |
| [`custom-types/`](custom-types/)               | What the kit can and cannot do with a WordPress custom post type — the capability boundary, stated                                            |
| [`preview-audit/`](preview-audit/)             | Is this ARTIFACT whole — every promised route emitted, every link resolving, every asset present, no undeclared script?                       |
| [`accessibility-audit/`](accessibility-audit/) | Heading outlines, landmark sets, list semantics, focus coverage, the skip link's target, the navigation, and the contrast of every token pair |
| [`seo-audit/`](seo-audit/)                     | Does every page carry the head a crawler needs, and does that head agree with the page?                                                       |
| [`layout-audit/`](layout-audit/)               | Does anything overflow, at any width?                                                                                                         |
| [`contrast-audit/`](contrast-audit/)           | Is every piece of text legible against the ground **actually painted behind it**?                                                             |
| [`render-digest/`](render-digest/)             | Does any page look different from the last time somebody looked at it?                                                                        |
| [`browser-tests/`](browser-tests/)             | Do the controls work when you operate them?                                                                                                   |
| [`release-audit/`](release-audit/)             | Is this build a release candidate — and has a person walked it?                                                                               |
| [`kit-init/`](kit-init/)                       | Making the placeholder prefix yours                                                                                                           |

## Three ideas the whole ladder is built on

**A gate proves a contract, not correctness.** `render:build-audit` proves the
built HTML carries what the routes composed. It does not prove the page is
right, and it says so in its own header. Every tool here names its blind spot.

**Both directions, or it is a suppression file.** Every baseline in this
repository is asserted twice: a recorded finding does not fail the run, and a
recorded finding the build **no longer produces** is an error. A list that only
ever grows is a list nobody prunes, and a repository asserting something untrue
about itself is a defect rather than a status.

**"Did not run" is not "passed".** The release audit has four states per check
and three verdicts, because a build has three genuinely different ways of not
being a candidate. A boolean makes "we did not check" indistinguishable from
"we checked and it is fine".

## What no gate here can see

Listed plainly, because this is the part people forget:

- **Whether a page is any good.** Every gate is a comparison — against a model,
  against a record, against a threshold. A listing that was badly designed on
  its first render passes all of them.
- **Whether the words are true.** The build audit reports phrases that might
  describe the build rather than the site, and leaves the judgement to you. In
  the project this came from, five hard-coded sentences saying "this preview
  does not send messages yet" rendered on 306 public pages of a production
  build, and every environment-aware surface was correct.
- **Whether a page is laid out right.** `content-reconcile` proves your page
  says what the source page says; two pages that say the same words in a
  different arrangement reconcile clean.

PLAYBOOK.md §7 step 5 is the walk. Nothing in this directory replaces it.
