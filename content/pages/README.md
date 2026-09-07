# content/pages/

**Content set:** Pages (WordPress `page` post type) · **Collection:** `pages` ·
**Schema:** `apps/website/src/content-model/page.ts`

One Markdown file per page. The front matter is the entry's data; the body is
**HTML, exactly as WordPress rendered it** (`bodyFormat: html`, the default),
rendered through `set:html` after `rendering/body.ts` prepares it. It is never
run through the Markdown pipeline, which is what keeps a migrated body from
being reworded by smart-quote substitution or re-parsed at an indented block.
A page you author by hand may set `bodyFormat: markdown` instead.

`parent` names another page's slug and publishes this one under it
(`/%pagename%/` expands to `parent/child`). `form` names a form key from
`src/forms/definitions.ts` and renders it under the body.

The page named by `permalinks.frontPage` in `migration.config.ts` renders at
`/` and nowhere else.

The four sample pages carry `source.system: "sample"`. A production build
fails while any remain.
