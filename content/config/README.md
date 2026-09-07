# content/config/

Configuration data, not content entries.

- `site.json` — who this site is: `name` (the `og:site_name`, the header's
  wordmark when `logo` is null, and the `| Site` suffix on titles), `tagline`,
  `origin` (the production origin, `https://example.com`, or `null` while it is
  undecided — a canonical, an `og:url` and a sitemap URL are absolute, and none
  of them is emitted until this exists), `logo` (a root-relative path under
  `apps/website/public/`, or null), and `social` (`[{ "label", "href" }]`, the
  footer's profile links and the `sameAs` of the site's structured data).
  `pnpm kit:init` writes `name` and `origin`.
- `locales.json` — the language registry. Adding a language is a row here plus
  content variants sharing a `cluster`; it is never a code change.
