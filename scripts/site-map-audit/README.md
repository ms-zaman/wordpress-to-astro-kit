# `site-map-audit`

What does the source site actually publish, and does this build account for all
of it?

```
pnpm sitemap:crawl        # read the live site, politely, into research/
pnpm sitemap:audit        # build, then diff the crawl against dist/
pnpm sitemap:audit-test   # the suite, no network
```

Two commands because they are two different acts. `crawl` reaches out to
somebody else's server and takes time; `diff` is arithmetic over files and takes
none. Keeping them apart means you can re-run the comparison as often as you
like against one polite capture, which is the behaviour a rate limit rewards.

## The sentence this exists for

**The sitemap is not the site.**

Date archives, author archives, tag archives, paginated pages, feeds and
language prefixes are all live and are usually absent from every sitemap a
WordPress plugin writes. Measured on a real site, on this tool's first run:

|                                                |          |
| ---------------------------------------------- | -------- |
| URLs listed across eight sitemap documents     | 431      |
| URLs found by following links from those pages | 955 more |

A migration planned from the sitemap alone discovers the rest at cutover, from
a 404 log.

## The one number it drives to zero

`GAP`: the source site serves this URL, the build publishes nothing at it, no
redirect covers it, and nobody has ruled it retired.

PLAYBOOK.md §7 step 1 states the rule: **every live URL is a page, a redirect,
or a recorded decision to retire it. There is no fourth category.** `GAP` is the
fourth category, so `diff` exits non-zero while any remains.

| Classification   | Means                                                               |
| ---------------- | ------------------------------------------------------------------- |
| `MATCH`          | Both sides publish it                                               |
| `REDIRECT`       | A rule or splat covers it, **and its target exists in `dist/`**     |
| `RETIRED`        | A family somebody ruled deliberately absent, with the ruling quoted |
| `INFRASTRUCTURE` | WordPress's own surface: `wp-json`, uploads, feeds, its sitemaps    |
| `GAP`            | Unaccounted for                                                     |
| `LOCAL_ONLY`     | This build publishes it and the crawl did not find it               |

A redirect whose target the build does not generate stays a **`GAP`**. A rule
pointing into a 404 turns one broken URL into a chain that ends broken, and it
reads as handled in every report.

Nothing is `RETIRED` by default. "We are not carrying the tag archives" is a
decision with an owner and a cost in rankings, not a default a tool makes for
you. Fill `RetiredFamilies` in from `decisions/ADR/`.

## Families come from your config

`classifyFamily` reads `migration.config.ts`. A post is whatever
`permalinks.post` describes on YOUR source site, so `/%postname%/` and
`/blog/%year%/%monthnum%/%day%/%postname%/` both classify correctly with no code
change. When several patterns match, the most specific wins — the one with more
literal characters.

`/%postname%/` and `/%pagename%/` are the same regular expression, so a
single-segment URL is reported as `entry` rather than guessed at. That is honest:
the URL genuinely does not say.

On top sit the shapes WordPress serves whether or not anybody configured them,
recognised **before** any pattern can swallow them: date archives, feeds, the
`wp-*` runtime, uploads, sitemaps, pagination, and `?s=` search.

### If your report is mostly `page`, the config is wrong

The commonest way to misuse this tool is to run it while `migration.config.ts`
still carries the kit's defaults. The result is not an error — it is a report
where almost everything reads `page`, which looks like an answer.

So the tool checks itself. Measured on a real site with the kit's defaults:

```
note: 1685 of 1792 URL(s) classified as page, entry or unknown, which is what
happens when `permalinks` in migration.config.ts does not describe the site
being crawled.
note: The prefixes those URLs share, which a permalink pattern would name:
/blog/ (292), /docs/ (121), /bn/ (95), /de/ (95)
```

Setting `post: "/blog/%postname%/"` and the thirteen language prefixes it named
turned that into 280 posts, 1235 translated, 95 date archives, 162 pages — a
correct census of the same capture.

## Politeness is not a preference

Everything about the crawl is read-only and paced, and `fetch.ts` is the only
module in this kit that touches the source site. GET only, same origin only,
one request at a time, `crawl.delayMs` between every one, and **no retry.**

A managed WordPress host's firewall watches request rate. In the migration this
kit came from, a burst got `wp-json` blocked for the better part of two hours
**while ordinary pages kept answering 200** — so an inventory captured in that
window is not empty and does not error. It is FALSE, and it looks exactly like a
smaller site.

That is why a failure is recorded and never retried: retrying into a rate limit
deepens it. And it is why the diff refuses to report a gap count when the
capture looks truncated:

```
INTEGRITY: 16 URL(s) answered 403 or 429. That is rate limiting or a firewall,
not the site's shape — an inventory captured now is FALSE and looks fine.
Wait it out; retrying deepens it
```

That message is not hypothetical: it is what this tool reported on its first
real run.

## What it deliberately does not do

- **It runs no browser.** A WordPress site server-renders its navigation, its
  archives and its post bodies. A link that exists only after JavaScript runs is
  invisible here; if the source site's menu is client-side, note it in
  `docs/01-discovery/` and seed the crawl by hand.
- **It follows no redirect.** A 3xx is recorded with its `location`, because an
  alias is a finding: the source site already considers that URL retired, and it
  is a redirect row you can carry across for free.
- **It fetches no media.** An upload path is recorded and skipped. The question
  is which PAGES exist.
- **It fetches one page per language prefix, not the corpus.** How many
  translated pages exist is worth knowing; downloading a second whole site to
  inform one decision is not.
- **It identifies itself.** `crawl.userAgent` goes on every request, and the
  crawl warns while it is still the kit's placeholder. A crawler that pretends
  to be a browser is one nobody can ask to stop.

## Evidence

A crawl is a measurement of a site at a moment, so it is written dated:
`research/site-map-<date>/live-inventory.json`, with `diff.json` and
`diff-report.md` beside it. Two crawls a month apart are two directories, and
the commonest way evidence goes bad is a default path that keeps pointing at a
superseded capture while everybody calls it "the crawl".
