# Custom post types

WordPress ships two content types and lets a plugin register any number more.
This is what the kit can do with them, stated as a boundary rather than a
claim.

```
pnpm content:census        what the source site has, and this kit's capability for each
pnpm custom-types-test     the suite
```

## A type is published only when a profile says so

Nothing about a custom type tells you how it should be published. `product`
might be a public catalogue with a listing, an internal record with no public
page, or a type whose URLs depend on a taxonomy this kit cannot route. REST
reports that the type exists; it does not report which of those it is.

So a type earns a profile in `migration.config.ts`:

```ts
postTypes: [
  {
    name: "product", // the WordPress type key
    collection: "products", // content/products/ and the Astro collection
    restBase: "product",
    permalink: "/products/%postname%/",
    published: true,
    archive: { kind: "archive", path: "/products/", title: "Products" },
    taxonomies: { attached: [], archives: false },
  },
];
```

`name` and `collection` are separate because the type key is WordPress's and
the directory is yours — and because two installs have used one key for
different things. Identity, routes and reports all use the **collection**.

## SUPPORTED

**Permalink forms**, each exercised end to end:

| Pattern                                 | Example output            |
| --------------------------------------- | ------------------------- |
| `/products/%postname%/`                 | `/products/analyser/`     |
| `/events/%year%/%monthnum%/%postname%/` | `/events/2026/03/summit/` |

The tokens a custom type may use are exactly `%postname%`, `%year%`,
`%monthnum%`, `%day%`. `%postname%` is required — without it every entry of the
type shares one URL.

**Archive behaviour**, all three declared explicitly:

| `archive`                          | Result                                   |
| ---------------------------------- | ---------------------------------------- |
| `{ kind: "none" }`                 | single entries only, no listing          |
| `{ kind: "archive", path, title }` | a paginated listing at `path`            |
| `published: false`                 | nothing published; entries still tracked |

A type does not get a listing because it exists — WordPress's own
`has_archive` defaults to false too.

**Content**: the shared `customTypeSchema` — title, body, slug, locale, dates,
optional excerpt, and taxonomy terms as data. Rendered by
`CustomTypePage.astro`, with `custom-type-templates.ts` as the override seam
when a type needs its own presentation.

**Integrity**: every entry of every profiled type, published or not, is named
in `deployment.json`'s `content.intended` and joined against `dist/` by
`pnpm content:integrity`.

## UNSUPPORTED — and what happens instead

|                                                                         |                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A type with no profile**                                              | Not routed, and reported by `content:census` as `UNCONFIGURED` with the profile to paste. Never "0 custom types", never silence — a decision waiting is not a finished migration.                                                                                                    |
| **Taxonomy-dependent URLs** (`%category%`, `%tag%`)                     | Refused at build time, by name. An entry usually has several terms, so expanding one would publish a URL WordPress never served.                                                                                                                                                     |
| **Taxonomy archives for a custom type**                                 | `taxonomies.archives: true` fails the build. The kit's taxonomy routing is written against posts — the `categories` and `tags` registries filtered over the posts collection. Terms are still stored on the entry and printed as text, never as links to archives that do not exist. |
| **Any other permalink token** (`%post_id%`, `%author%`…)                | Refused by name, with the supported set listed.                                                                                                                                                                                                                                      |
| **Fields the shared schema cannot hold** (`price`, `sku`, an ACF group) | The schema is a `strictObject`, so the entry fails validation naming the key. Write a schema and a template of your own — the generic path is the floor, not the ceiling.                                                                                                            |
| **Hierarchical custom types**                                           | No `parent` field. A type whose entries nest needs the page model, not this one.                                                                                                                                                                                                     |

## The one thing to understand about the boundary

Every refusal above is a **build failure with a name**, not a silent omission.
That is the whole design: the kit already learned once that a gate cannot miss
content it was never shown, and a type it quietly declined to route would be
exactly that failure again.

The matching rule sits in the content contract: a directory under `content/`
holding entries that **no collection claims** is an error. Delete a profile and
its content does not become invisible — it becomes a diagnostic.
