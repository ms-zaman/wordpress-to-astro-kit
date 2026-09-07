# content/seo/

**Content set:** SEO data · **Collection:** `seoOverride` · **Schema:**
`apps/website/src/content-model/seo-override.ts`

`overrides.json` is the per-URL override table, keyed by `path` + `locale`.
A row supplies what the route would otherwise derive — `metaTitle`,
`metaDescription`, `canonical`, `ogImage` — and rows exist for archive and
utility URLs that have no content entry at all, which is why this is a table
and not a field on entries.

Seed it from the live site's SEO plugin export (Yoast, Rank Math, ThinkRank —
every one of them exports per-URL titles and descriptions), one row per URL,
each carrying `disposition: { state: "preserve" }` and `source.system:
"wordpress"`. A row that fixes a live defect says so: `state: "fix"` with a
note. The pipeline seeds values; it does not optimise them.

`robots` on a row is READ and reported, never applied: indexing is the launch
switch (`src/deployment/site-environment.ts`), not a per-row property.
