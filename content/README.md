# content/

Repository-owned content. Collections are defined in
[`apps/website/src/content.config.ts`](../apps/website/src/content.config.ts);
their schemas live in `apps/website/src/content-model/`.

> one subdirectory (or registry file) = one content set = one owner = one schema

| Path                 | Content set                           | Collection    |
| -------------------- | ------------------------------------- | ------------- |
| `pages/`             | Pages (WordPress `page`)              | `pages`       |
| `posts/`             | Posts (WordPress `post`)              | `posts`       |
| `authors.json`       | Author registry (WordPress users)     | `authors`     |
| `categories.json`    | Category registry                     | `categories`  |
| `tags.json`          | Tag registry                          | `tags`        |
| `navigation/`        | Menus                                 | `navigation`  |
| `seo/overrides.json` | Per-URL SEO overrides                 | `seoOverride` |
| `redirects.json`     | URL continuity (rules + splats)       | —             |
| `config/`            | Site identity and the locale registry | —             |

Every entry **and every registry row** carries `source` — where it came from.
`wordpress` entries record the source id and the capture date; `authored`
entries were written here; `sample` entries are the kit's own and **a production
build fails while any remain** (`pnpm render:build-audit` under
`WPK_SITE_ENV=production`).

`sourceId` is WordPress's own primary key and nothing else: `wp_posts.ID` for a
page, post or custom-type entry, `wp_terms.term_id` for a term, `wp_users.ID`
for an author. The schema refuses a slug or a URL there, because the whole
value of a source id is that it survives somebody renaming the thing — which is
exactly the case a slug cannot survive. `pnpm provenance` reads them back and
answers which source entity produced any URL or file in a build; two entries
carrying one id is a collision no other check in this kit can see.

**These ids stay here.** `dist/deployment.json` is a served route, so it records
that an entity came from WordPress and never which row it was — a deployment has
no use for the source site's primary keys, and this tree is where they
authoritatively live.

Media is not stored here. Upload references keep WordPress's
`/wp-content/uploads/` namespace byte-for-byte; which host serves them after
cutover is one build variable (`rendering/media.ts`).

A custom post type the live site has (a docs post type, case studies, a
portfolio) is a new subdirectory here, a new schema in `content-model/`, a new
collection in `content.config.ts`, and a new template — see PLAYBOOK.md,
Content §5.
