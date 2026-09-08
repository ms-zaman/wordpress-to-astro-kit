# `core-taxonomy` — WordPress's own two, in the same model as yours

`pnpm core-taxonomy-test`

## What was measured

From WordPress core (`create_initial_taxonomies()`, `wp-includes/taxonomy.php`,
read 2026-09-08):

```php
register_taxonomy( 'category', 'post', array(
  'hierarchical' => true,
  'rewrite'      => array( 'hierarchical' => true,
                           'slug' => get_option('category_base') ?: 'category' ),
  'rest_base'    => 'categories', … ) );

register_taxonomy( 'post_tag', 'post', array(
  'hierarchical' => false,
  'rewrite'      => array( 'hierarchical' => false,
                           'slug' => get_option('tag_base') ?: 'tag' ),
  'rest_base'    => 'tags', … ) );
```

So a WordPress **category has parents, and its archive URL carries them** —
`/category/parent/child/`. `post_tag` is flat in both senses. The taxonomy key
is `post_tag`, not `tag`.

## What that proved wrong

The kit had two taxonomy implementations that had grown apart:

|                 | core `category` / `post_tag`       | configured taxonomy           |
| --------------- | ---------------------------------- | ----------------------------- |
| terms           | `content/categories.json`          | `content/<collection>.json`   |
| schema          | `categorySchema` — **no `parent`** | `taxonomyTermSchema`          |
| URL             | `permalinks.category`, `%slug%`    | `profile.permalink`, `%term%` |
| hierarchy       | **none**                           | parent + cycle guard          |
| validated by    | hand-written, per registry         | profile-driven                |
| in the manifest | nothing                            | a `taxonomies[]` row          |

The row that matters is hierarchy. A migration that met a nested category had
to flatten it, publishing a URL the source never served.

## The unification

`category` and `post_tag` are now **derived** `TaxonomyProfile`s
(`src/routing/taxonomies.ts`), built from `permalinks.category` and
`permalinks.tag`. **The public configuration did not change** and nobody
declares them.

`ResolvedTaxonomy` adds the two things a public profile cannot carry:

- `builtIn` — WordPress registers this one; a configuration cannot award itself
  the flag, and a profile named `category` or `post_tag` is refused.
- `reference` — where an entry names its terms. Measured, and genuinely two
  shapes: `wp/v2/posts` returns `categories` and `tags` as **top-level arrays**,
  and everything else is filed in the generic `terms` map keyed by taxonomy name.

## Backward compatibility, as evidence

Two facts, both checkable:

1. The built-in profiles are derived from `permalinks`, so a **flat** category
   tree produces byte-identical URLs. `CORE URLS ARE UNCHANGED` executes this.
2. A content tree that existed before the change **cannot have a nested
   category**, because `categorySchema` had no field to put a parent in. So
   turning `urlHierarchy` on cannot move an existing URL.

`content/categories.json` and `content/tags.json` **do not move**. They are the
compatibility boundary, and their consumers did not change. What retired is the
duplicate _model_ behind them.

`%slug%` and `%term%` are synonyms expanding to the same value, so unifying the
two models required nobody to edit a pattern they already had.

## What the unification exposed

Four real holes, each fixed where the data is:

- A custom entry could name a **taxonomy term that did not exist**. Nothing
  checked it at any layer — the archive simply did not list the entry, so a typo
  made a product vanish from its listing with every gate green.
- Core registries had **no hierarchy rules at all**: no cycle guard, no
  unknown-parent check, no duplicate-slug throw of their own.
- `PostPage` computed category links **from the slug alone** — correct while
  every category was flat, a 404 the moment one had a parent.
- `render-contract/run.ts` **restated the registries** as a hand-written list, a
  second authority for the same fact.

## Boundaries

- **A taxonomy term is not a route.** A slug change moves the URL; the
  WordPress `term_id` in `source.sourceId` does not move, and that is what a
  re-capture matches on.
- **The same slug in two taxonomies is two entities.** The collection
  namespaces it — WordPress allows the duplicate.
- **Core taxonomies cannot be withheld.** They have always been published, and
  making them optional now would retire live URLs.
- **`category_base` and `tag_base` are `permalinks.category` / `permalinks.tag`.**
  There is no separate knob.
- **Locale-specific term URLs are not supported.** A term is one row with a name
  per language.
