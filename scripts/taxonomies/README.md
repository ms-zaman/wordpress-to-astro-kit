# Custom taxonomies

What the kit can and cannot do with a WordPress taxonomy, stated as a measured
boundary.

```
pnpm content:census     what the source has, and this kit's capability for each
pnpm taxonomies-test    the suite
```

## What was measured

Four facts, read off WordPress core on 2026-09-08 and confirmed against a live
install. Each one rules out a guess:

| Measured                                                                                                                                                                               | Where                                                      | Consequence                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| REST exposes **no rewrite**. `wp/v2/taxonomies` returns `name`, `slug`, `description`, `types`, `hierarchical`, `rest_base`, `rest_namespace`                                          | `class-wp-rest-taxonomies-controller.php`, and a live site | The URL prefix can only be configuration                      |
| **The taxonomy name is not the URL base** — `doc_category` serves terms at `/docs-category/`                                                                                           | a live install                                             | Deriving one from the other publishes URLs the site never had |
| **URL hierarchy is a separate flag.** `get_term_link()` includes ancestors only when `rewrite['hierarchical']` is true, which `register_taxonomy` sets independently of `hierarchical` | `wp-includes/taxonomy.php`                                 | Two flags, two questions                                      |
| **A term slug is unique within its taxonomy.** `wp_unique_term_slug()` appends a parent suffix or a number; duplicates across _different_ taxonomies are allowed (WP 4.1+)             | `wp-includes/taxonomy.php`                                 | `(taxonomy, slug)` identifies a term                          |

A term's `link` **is** exposed, so a profile is checkable against the URL the
source really serves.

## The profile

```ts
taxonomies: [
  {
    name: "product_cat", // the WordPress key
    label: "Product category", // wp/v2/taxonomies' `name`
    collection: "product-categories", // content/product-categories.json
    restBase: "product_cat",
    appliesTo: ["products"], // post-type COLLECTIONS its terms file
    published: true,
    permalink: "/product-category/%term%/",
    urlHierarchy: true, // rewrite['hierarchical']
    hierarchical: true, // terms have parents
  },
];
```

`category` and `post_tag` are **not** configured here — the kit models
WordPress's two core taxonomies directly, through `content/categories.json`,
`content/tags.json` and `permalinks.category` / `permalinks.tag`.

## SUPPORTED

**Permalink form** — one token, because `get_term_link()` expands one:

| Profile                                            | Route                                    |
| -------------------------------------------------- | ---------------------------------------- |
| `/product-category/%term%/`, `urlHierarchy: false` | `/product-category/laptops/`             |
| `/product-category/%term%/`, `urlHierarchy: true`  | `/product-category/electronics/laptops/` |

The literal prefix is arbitrary and used verbatim — that is the point.

**Hierarchy**: root, child and grandchild terms; ancestors in the URL when the
profile says so; ancestor breadcrumbs computed from the term chain, never by
splitting a path. Sibling branches keep distinct paths.

**Relationships**: a taxonomy may name **several** post-type collections in
`appliesTo`; its archives list the union, newest first. One term name may exist
in two taxonomies — the collection namespaces the identity, and the taxonomy
label qualifies the title and description so the two pages do not collide.

**Archive behaviour**: `published: true` routes term archives (paginated);
`published: false` stores terms on entries, renders them as text, and routes
nothing. A term archive is never created merely because terms exist.

**Terms** carry `slug`, `parent`, per-locale `name`, per-locale `description`,
and a required `source` block — the same one every other source entity uses,
holding `wp_terms.term_id` as `sourceId`. Those are exactly the REST fields that
are content; `count` and `link` are facts about the source at capture time and
stay in the capture.

The term id is what survives a slug being edited on the source site, which is
the one thing a slug cannot do — so a re-capture matches on it, and
[`pnpm provenance`](../provenance/README.md) answers which term produced a given
term archive. A term registry written by hand says `{ "system": "authored" }`
and is then honest about having no source entity behind it.

## UNSUPPORTED — and what happens instead

|                                                                       |                                                                                                                                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A taxonomy with no profile**                                        | Not routed; reported by `content:census` as `UNCONFIGURED` with a profile to paste and instructions to read the prefix off the source's address bar.                                          |
| **`%parent%` or any second token**                                    | Refused by name, pointing at `urlHierarchy` — ancestors are a flag in WordPress, not a token.                                                                                                 |
| **`urlHierarchy` on a flat taxonomy**                                 | Refused: a URL shape describing a hierarchy the data does not have.                                                                                                                           |
| **A parent on a flat taxonomy**                                       | Refused. WordPress refuses it too (`rest_taxonomy_not_hierarchical`).                                                                                                                         |
| **Two terms sharing a slug in one taxonomy**                          | Refused, citing `wp_unique_term_slug`. WordPress cannot produce it, so a capture that shows it lost a suffix.                                                                                 |
| **A published taxonomy filing an unpublished post type**              | Refused: its archives would list pages that do not exist.                                                                                                                                     |
| **Locale-specific term URLs**                                         | Not supported, and not faked. A term is **one row with a name per locale**, so it has one URL in every build; only its title changes. A term therefore cannot be dropped by locale filtering. |
| **Taxonomy terms on core `post`**                                     | Out of scope here — that is `categories.json` / `tags.json` and the core permalink patterns.                                                                                                  |
| **Term fields the schema cannot hold** (a thumbnail id, an ACF group) | The schema is strict: validation fails naming the key.                                                                                                                                        |

## Where the term archive draws its entries

From every collection in `appliesTo` whose entry lists the term under the
taxonomy's **WordPress key** in its `terms` map:

```yaml
terms:
  product_cat: [laptops]
  product_tag: [featured, laptops]
```

An entry page prints its terms as **text, not links**. The kit publishes
archives only for configured taxonomies, and a link to an archive that does not
exist is worse than no link.
