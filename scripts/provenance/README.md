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

| stage                                     | what carries it                                              | what is checked, and where                                                                      |
| ----------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `content/` front matter and registry rows | `source: { system, sourceId, capturedAt }`                   | a WordPress entity's id is a **positive integer** — a slug or a URL is refused by the schema    |
| the content contract                      | the files, read directly                                     | **one source entity, one local entity** (`content:contract`, `content:validate`)                |
| the collection loader                     | `data.source`                                                | ids come from the file path, so translations sharing a slug both load                           |
| the resolver                              | `provenanceOf(route)`                                        | every route resolves to exactly one claimant                                                    |
| the manifest                              | `content.intended[].provenance`, **minus the source entity** | every intended entity **states an origin**, and none carries a source id (`render:build-audit`) |
| `dist/`                                   | `routes.inventory[].entry` + `claimOf`                       | every emitted output has exactly one owner (`content:integrity`)                                |

Provenance is deliberately **absent from the rendered page**. It is migration
machinery, and a site that printed its WordPress post ids would be telling every
visitor which install it came from. A browser test asserts that it does not.

## Two halves, in two places, for one reason

The lineage this prints is a join:

    content/                 local identity → SOURCE ENTITY
    dist/deployment.json     local identity → route, output file

**`dist/deployment.json` is a route, so everything in it is served.** It
describes the site being deployed — identities, collections, locales, type
keys, what was withheld — and it deliberately carries provenance _without_ the
source entity. The WordPress post, term and user ids describe the install the
content came FROM, and a deployment has no use for them.

So the ids stay in `content/`, where whoever migrated the content wrote them.
That is not a workaround, it is the shorter path: the content tree is where they
authoritatively live, and any build artifact would only have been a snapshot of
it — one more file to produce, keep in step, and accidentally deploy. There is
no `provenance.json` and no third artifact; `--json` writes the join to stdout
and nothing is written to disk.

The split is deliberately not a hash. Hashing a post id publishes the same
information wearing a hat — the set is small and the ids are sequential — and
the fix for "this should not be public" is to not publish it.

Three checks keep it that way, all of them on every build:

| where                                           | what it refuses                              |
| ----------------------------------------------- | -------------------------------------------- |
| `validateManifest`, inside `render:build-audit` | a `source` on any intended row               |
| the build audit                                 | any `sourceId`-shaped key in the served text |
| `scripts/browser-tests/provenance.spec.ts`      | the same, fetched over HTTP                  |

The type system carries the rule too: `PublicProvenance` declares
`source?: never`, so assigning a full record to a manifest row is a compile
error inside `apps/website` rather than a review comment.

**The caveat, because it is real:** this joins today's `content/` against the
last build's `dist/`. Every gate in this kit that reads `dist/` has that
property — run `pnpm build` first.

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
