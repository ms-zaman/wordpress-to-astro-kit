# Identity and ownership

**Identity is not a slug.** And **downstream integrity cannot compensate for
upstream entity loss.**

```
pnpm identity-test     the invariants
pnpm content           where most of them are enforced
```

## The pattern

Four defects in this kit turned out to be one shape:

| Defect                                                      | What was lost                         | What every gate reported |
| ----------------------------------------------------------- | ------------------------------------- | ------------------------ |
| Astro's `glob()` derived entry ids from front-matter `slug` | one of two translations, never loaded | green                    |
| A post-type profile was deleted, its directory stayed       | a whole content set                   | green                    |
| Astro's `file()` keyed registry rows by `slug`              | one of two terms, and its route       | green                    |
| Two `en` pages with slug `home`, one the front page         | the real home page, replaced          | green                    |

The last one is the clearest. The build succeeded, the second file rendered at
`/`, the manifest listed `pages/home@en` **twice**, and `content:integrity`
exited 0 — because it joins through a `Map` and a `Set` and **both of those
deduplicate**. Two entities, one identity, every gate agreeing with itself.

## The invariant

> Identity uniqueness must be checked at the earliest boundary that can observe
> the complete set of competing entities.

By the time a loader has produced a collection, the losing entry is not late —
it is gone, and nothing downstream can tell "one entity" from "two that
collapsed". A gate cannot miss what it was never shown.

## Where each invariant is enforced

| Invariant                                                                      | Enforced at                                                                                            | On collision                                                                                                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **identity → one source entity**<br>`(collection, slug, locale)`               | the content contract, reading `content/` from the **filesystem** — the only layer that sees both files | fails, naming the identity and **every** competing file                                                                                                   |
| **collection name → one owner**<br>core / post-type profile / taxonomy profile | `validate-content.ts`, before a single file is read                                                    | fatal immediately: `content.config.ts` composes collections with an object spread, so a contested name means one content set has already stopped existing |
| **route → one claimant**                                                       | the resolver, which sees every claim before any page exists                                            | throws, naming both claimants                                                                                                                             |
| **output → one claimant**                                                      | `render:build-audit` (emitted vs inventory) and the manifest validator                                 | fails                                                                                                                                                     |
| _(defence in depth)_ duplicate identity, one entity at two paths               | `content:integrity`                                                                                    | `IDENTITY_CONTESTED`                                                                                                                                      |

The last row is a **second** line, not the first. It exists because a manifest
can be written by a build the contract never ran over — but if it is the thing
that catches a collision, something upstream is missing a check.

## What cannot collide, and why

A slug is `^[a-z0-9]+(?:-[a-z0-9]+)*$`. That alphabet forbids everything
normalization could collapse: no Unicode (so no NFC/NFD pair), no uppercase (no
case folding), no percent-encoding, no whitespace. Two distinct slugs cannot
become one — measured against the schema, not assumed.

Route paths **can** collapse: `/about` and `/about/` are one page and one file.
Both the resolver and `duplicatePaths` compare through `routeKey`, so the two
spellings are one claim rather than two rows sharing an output.

Locale codes are language tags (`en`, `pt-BR`, `zh-Hans`, `en-GB`) and are part
of an entry's identity. `en` and `en-GB` are two entities; a normalization that
dropped the region — which this kit's first locale rule effectively did — would
merge them.

## Never

- first entry wins
- last entry wins
- filesystem order decides
- object spread decides
- a `Map` or a `Set` quietly keeping one

Any of those is a migration silently losing content. Every one of them was in
this kit at some point, and each is now a named failure.
