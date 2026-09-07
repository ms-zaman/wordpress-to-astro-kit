# content/posts/

**Content set:** Posts (WordPress `post` post type) · **Collection:** `posts` ·
**Schema:** `apps/website/src/content-model/post.ts`

One Markdown file per post; body rules as for `content/pages/`. `author`,
`categories` and `tags` reference the registries beside this directory —
`authors.json`, `categories.json`, `tags.json` — and `pnpm content:validate`
fails on a reference no registry row satisfies.

`featuredImage.url` is the upload's URL in the preserved namespace
(`/wp-content/uploads/...`, relative or on the live origin), byte-for-byte.
`variants` lists the renditions the library actually holds, for a `srcset`;
list only URLs that answered 200 when probed — a guessed rendition is a broken
image, not a smaller one.

Excerpts are carried only where WordPress holds an explicit one. A listing
derives its summary from the body otherwise; nothing is invented at migration.

The two sample posts carry `source.system: "sample"`. A production build fails
while any remain.
