# `research/`

Evidence. Crawls, captures, measurements, baselines — the raw material every
claim in `docs/` traces back to.

**Tracked by default.** `.gitignore` ignores only what is generated,
temporary, or machine-specific; it never ignores `research/` wholesale, and it
explicitly keeps capture logs, because a capture without its method and
conditions is a number nobody can check.

**Never reformatted.** `research/` is in `.prettierignore`. A formatter
rewriting captured evidence, however harmlessly, ends its value as evidence —
in the project this kit came from, one `pnpm format` run collapsed 32,100 blank
lines across 251 migrated bodies, and a byte-for-byte comparison against the
live site would have been over.

## What belongs here

| | |
| --- | --- |
| `url-inventory/` | What the live site publishes: sitemaps, a crawl, the URLs that answer |
| `content-capture/` | What the REST API returned, per post type, with the date and the method |
| `page-capture/` | Rendered pages from the live site, for the ones the API cannot describe |
| `render-digest/` | This build's own recorded appearance — see the README there |

Every file says **when** it was captured, **how**, and **under what
conditions**. A crawl taken while a firewall was throttling the REST API looks
exactly like a crawl of a smaller site, and only the log tells them apart.
