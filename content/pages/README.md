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

## The two translated samples

`sobre.md` (`pt-BR`) and `guanyu.md` (`zh-Hans`) are deliberately in locales
this build does not publish. They are not decoration: they are the only reason
the `EXCLUDED` path of `pnpm content:integrity` runs on every build rather than
only in a fixture.

That gate exists because a translated corpus used to migrate into `content/`,
validate, build green and publish **nothing**, with no gate saying a word —
every other gate reads one side of the build boundary. These two entries make
the withheld case visible in the kit's own ladder, and they prove the locale
registry accepts the regional and script forms (`pt-BR`, `zh-Hans`) that a real
WordPress site publishes.

Delete them when you replace the sample content, the same as every other
`source.system: sample` entry — and if your own site has translations, the gate
will name yours instead.
