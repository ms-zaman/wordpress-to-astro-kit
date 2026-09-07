# `content-capture`

What does the source site publish, and will it hand it over?

```
pnpm content:census                              # what exists, and how much
pnpm content:capture -- --type post --limit 5    # a first look at one type
pnpm content:capture -- --type post              # the whole type, to research/
pnpm content:capture-test                        # the suite, no network
```

Two commands, and the first is the cheap one. `census` asks the site what it
publishes in a handful of requests; `capture` downloads one type. Answer the
first question before spending an hour on the second.

Read-only. Every request is a GET against a public endpoint, no credential is
ever sent, and the only thing written is one JSON artifact under `research/`.

## The census is PLAYBOOK.md §1.2, automated

It reads `wp/v2/types` and `wp/v2/taxonomies`, then asks each route for
`per_page=1` and reads `x-wp-total`. One request per route, and it sizes the
whole migration. On a real site, in 29 requests:

```
  POST TYPES
   4786  attachment         media              Media
    278  post               posts              Posts
    121  docs               docs               Docs
     30  page               pages              Pages
      ?  elementor_library  elementor_library  My Templates
         the route refused an anonymous reader

  TAXONOMIES
   1544  post_tag           flat         on post
     86  doc_tag            hierarchical on docs
     13  doc_category       hierarchical on docs
      4  category           hierarchical on post
```

The surprise is usually in the middle of that list: a site described as "a blog
and some pages" publishes a custom post type a plugin registered, with its own
archive and its own URLs, and it is in nobody's plan.

## Anonymous first, and measure before assuming

A migration is often planned around "we need admin credentials first". That
assumption is worth an hour of measurement before it costs a week.

On the site this kit came from, the whole blog had been recorded as blocked
behind a credential. **251 of its 278 posts returned their complete body to an
anonymous reader.** The census names the routes that genuinely refuse, and on
that site they were template and menu internals — nothing anybody was
migrating.

## `_fields` is a contract, not an optimisation

Every request names the fields it wants, so a field that silently stops being
returned shows up as `undefined` in one place instead of as a missing key three
layers down.

Nested selection (`_fields=content.rendered`) is deliberately not used: it
silently returns nothing on some versions, which is the worst failure a capture
can have — an empty body that looks like an empty post.

## Paging follows the header, not the page size

`x-wp-totalpages` decides when a listing ends. A filter that removes a row
after the query runs makes a full page look short, and a reader that stopped
there would capture part of a site and report success. `x-wp-total` travels
into the artifact beside the number that arrived, and the CLI compares them out
loud.

## Which bodies did not come back whole

A page builder keeps its document in postmeta, and `content.rendered` carries
only what the classic editor held. So an entry built with one returns its intro
and nothing else: a 200, a body, no error, and most of the article missing.

Measured on a real site, over all 278 posts:

|                |                                       |
| -------------- | ------------------------------------- |
| ordinary posts | 264, from 8,698 to 153,234 characters |
| stub bodies    | 14, from 1,913 to 2,794               |
| corpus median  | 20,790                                |

A clean cliff. **Two signals find it, and either alone is wrong:**

- **Markers** — Elementor, Divi, WPBakery, Beaver Builder wrappers left in the
  body. On that site they matched 27 posts and one WPBakery post, but only 14
  were stubs, so a marker on its own over-reports by half.
- **Length against the corpus median** — a fifth of it, relative with **no
  absolute cap**. This is what puts an entry on the list and earns it a page
  fetch.

### Expect zero of these on a Gutenberg site

This is a page-**builder** problem, not a WordPress problem. Gutenberg keeps its
document in `post_content` as block markup with HTML comment delimiters, so a
Gutenberg or classic-editor corpus hands `content.rendered` the whole article
and this check finds nothing.

**Zero incomplete bodies is then the correct answer, not a broken instrument.**
Which builders your corpus carries is PLAYBOOK §1.3, and it tells you which
answer to expect before you run this — so a silent zero is a confirmation
rather than a thing to wonder about.

### The cap was a real defect, found by real data

The first version used `min(median / 5, 1500)`. The cap had been added to stop
over-reporting on a high-variance corpus, and on the corpus above it put the
floor _below_ every stub: 14 missing bodies, none of them flagged, and a report
that said everything was fine.

The asymmetry settles it. Over-reporting costs one extra page fetch and a line
in a list somebody reads. Under-reporting silently writes stub articles and
reports success. So the rule leans to over-reporting and there is no cap. A
fifth sits mid-band: on that corpus every fraction from 0.15 to 0.3 finds
exactly the same 14 entries.

### The bodies are reachable

All 14 rendered completely at their own URLs — around 290,000 characters each
— so the capture fetches those pages and stores them under `renderedPage`,
verbatim. It does **not** interpret them: turning a rendered page into an
article body is a reduction with judgement in it, and this tool's job is to
have the evidence, not to decide what it means.

## Politeness, and the one place a retry is correct

Everything goes through `scripts/site-map-audit/fetch.ts`: GET only, same
origin, one request at a time, the configured delay between every one.

A failure is **not** retried to get past a refusal — retrying into a rate limit
deepens it. But a capture that WRITES content is different, and getting this
wrong is measurable: 278 back-to-back media requests with 80 refused turned
into 80 posts quietly losing their featured image, because the `catch` around
each one read a refusal as "no image". A transient condition had rewritten
somebody's content.

So a collection page and a media row are retried, bounded, with backoff. A
**404 is never retried**: a missing attachment is a fact about the site, and
hammering it would turn a correct answer into four requests.

## Evidence, and what happens next

`research/content-capture-<date>/<type>.json`, dated, because a capture is a
measurement of a site at a moment.

Turning that artifact into content entries is a **separate step**, and
PLAYBOOK.md §5 says why: fetch and interpretation should be reviewable apart,
because when a body comes out wrong you need to know which of the two did it.
That transform is yours to write against your own schemas — carry the body
verbatim, keep media paths byte-for-byte, and record inherited defects rather
than fixing them.
