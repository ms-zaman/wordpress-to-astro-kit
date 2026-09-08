# `provenance` — where did this page come from?

```sh
pnpm build && pnpm provenance                       # the lineage table
pnpm provenance route /products/analyser            # which entity publishes this URL
pnpm provenance output products/analyser/index.html # which entity produced this file
pnpm provenance source wp:post/product#42           # where a source entity ended up
pnpm provenance withheld                            # intended, and published by nothing
pnpm provenance --json                              # the whole join, for CI or a report
```

A migration is a claim: _this site is that site_. Every gate in this kit checks
some part of that claim, and until provenance existed none of them could answer
the first question anybody actually asks when a page looks wrong —

> Where did this come from?

## Four names, and they are not interchangeable

|                     | example                        | changes when                                         |
| ------------------- | ------------------------------ | ---------------------------------------------------- |
| **source identity** | `wp:post/product#42@en`        | never, while the entity exists on the source site    |
| **local identity**  | `products/analyser@en`         | the slug or the locale changes                       |
| **route identity**  | `/products/analyser`           | the slug, the parent, or a permalink pattern changes |
| **output identity** | `products/analyser/index.html` | the route changes                                    |

The last three all move when somebody renames something. The first does not,
and that is the entire reason it exists: a re-capture matches on the WordPress
primary key, and a reconciliation that matched on slugs would report every
renamed page as deleted-and-added.

WordPress keeps content in three tables with three id spaces — `wp_posts.ID`,
`wp_terms.term_id`, `wp_users.ID` — so an id alone is not an identity. Post 42
and term 42 are different things, and the key says which table it means.

## Source entities and derived entities

A **source entity** exists on the source site and has a primary key there:

    page · post · custom-type entry · taxonomy term · user

A **derived entity** exists because the _configuration_ says so, and inventing a
WordPress id for one would put a number in the artifact that matches nothing:

| derived entity          | declared by                   |
| ----------------------- | ----------------------------- |
| the posts listing       | `permalinks.postsIndex`       |
| a custom type's archive | `postTypes["<type>"].archive` |

A **term archive is not on that list**, deliberately. It is generated, but it is
generated _for_ one term, and a term is a source entity with a `term_id` of its
own — so `/product-category/laptops/` answers "which source entity?" with
`wp:term/product_cat#7`, and a term whose slug is edited keeps that answer.

## Where provenance is written, and where it is checked

| stage                                     | what carries it                            | what is checked, and where                                                                   |
| ----------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `content/` front matter and registry rows | `source: { system, sourceId, capturedAt }` | a WordPress entity's id is a **positive integer** — a slug or a URL is refused by the schema |
| the content contract                      | the files, read directly                   | **one source entity, one local entity** (`content:contract`, `content:validate`)             |
| the collection loader                     | `data.source`                              | ids come from the file path, so translations sharing a slug both load                        |
| the resolver                              | `provenanceOf(route)`                      | every route resolves to exactly one claimant                                                 |
| the manifest                              | `content.intended[].provenance`            | every intended entity **states an origin** (`render:build-audit`)                            |
| `dist/`                                   | `routes.inventory[].entry` + `claimOf`     | every emitted output has exactly one owner (`content:integrity`)                             |

Provenance is deliberately **absent from the rendered page**. It is migration
machinery, and a site that printed its WordPress post ids would be telling every
visitor which install it came from. A browser test asserts that it does not.

## The artifact is the manifest

**`dist/deployment.json` is a served route.** It already described your whole
content inventory — every identity, locale, collection and type key — and it now
also carries the source site's primary keys. That is not a secret and not a
credential, but it is a description of the site you migrated from, and
[the route-ownership table](../../docs/04-implementation/route-ownership-table.md)
says how to stop publishing it if you would rather not.

There is no `provenance.json`. Everything this reads is already in
`dist/deployment.json` — `content.intended` carries each entity's local identity
and origin, `routes.inventory` carries the route and file each identity
produced — and a second artifact would be a second copy of one join, which is a
thing that can drift from the first. This command is a **reader**; `--json`
writes the join to stdout for CI without putting a file on disk that somebody
has to keep in step.

## What is not supported

- **No provenance for anything WordPress does not give a primary key.** An SEO
  override row is keyed by URL and a navigation menu is a `nav_menu` term whose
  items are not entities of this content tree; both keep a free-form capture key
  and neither is a source entity.
- **No automatic capture of ids.** `content:capture` downloads evidence; turning
  evidence into content entries is the one transform the kit leaves to you,
  because the target schema is yours. Write `sourceId` while you do it — it is
  the only field a re-capture can match on.
- **One exclusion stage.** Every legitimate withholding this kit performs is
  decided by the route resolver. `ExclusionStage` is a union of one so that a
  second boundary has to declare itself rather than borrow the resolver's name.
- **Provenance does not prove content is correct.** It proves lineage: that this
  page is that entity's. Whether the words on it match the source is
  [`content-reconcile`](../content-reconcile/README.md).

## Mutations this suite proves

`pnpm provenance-test` runs twelve deliberate corruptions. Six of them fail
**before a build ever runs** — at the content contract or the manifest
validator — which is the invariant the whole kit turns on:

> A downstream gate cannot detect an entity that was already lost at an upstream
> boundary.

The one worth reading the code for is **M3**: two entries, two local identities,
two routes, two output files — every uniqueness rule in this kit passes — and
one of them has been edited to claim the other's WordPress post. Nothing but
provenance sees it, because everything else that could differ, differs.
