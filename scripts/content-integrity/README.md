# `content-integrity`

Proves that **every entry in `content/` crossed the build boundary** — and that
every page in `dist/` can name the content it came from.

```
pnpm build              # the gate reads the artifact, not the source
pnpm content:integrity
pnpm content:integrity-test
```

## The hole it closes

The kit could prove two things and behaved as though it had proved a third:

|                      |                                                   |     |
| -------------------- | ------------------------------------------------- | --- |
| `content:contract`   | every file in `content/` is valid                 | ✓   |
| `render:build-audit` | every route the manifest claims exists in `dist/` | ✓   |
| **nothing**          | **every entry in `content/` became a page**       | ✗   |

Both existing gates read one side. The content contract never opens `dist/`;
the build audit compares the manifest's inventory against the emitted files,
and **both of those are outputs of the same build**. Nothing crossed the
boundary, so anything the resolver dropped in between was invisible to all of
them — and every gate was telling the truth about what it looked at.

That is not hypothetical. `resolveSiteRoutes` filters entries by locale,
deliberately and correctly: the kit builds one language at a time. A project
that migrates a translated corpus into `content/` and builds gets a green
ladder, a complete manifest, a valid site, and **not one of those pages**.

## Identity, never counts

A count comparison would pass a build that dropped one entry and invented
another. So every intended thing carries a name and every route carries the
same name:

```
posts/hello-world@en      an entry — exists once per language
pages/about@pt-BR
categories/news           a registry row — carries every language itself
tags/sample
authors/jane-doe
```

The manifest gained `content.intended` (**all** locales) and `routes.inventory[].entry`.
Naming an entry the build does not route is the point: that is what makes it
reportable as withheld instead of absent.

The join is by identity, not by path, which is what makes it correct for the
pages WordPress moves. The home page is `pages/home@en` and is emitted at `/`,
not at `/home/`; a child page is emitted under its parent. A path comparison
would call both of those missing.

## What it reports

|                    |                                                                    |
| ------------------ | ------------------------------------------------------------------ |
| `SOURCE_ONLY`      | `content/` intends it and no page arrived, with no declared reason |
| `OUTPUT_ONLY`      | a page `dist/` has that no intended content explains               |
| `UNUSED_EXCLUSION` | a declared exclusion that excuses nothing — a rule left behind     |
| `EXCLUDED`         | withheld on purpose, with a **typed** reason. Not a finding        |

`SOURCE_ONLY` covers two different failures and says which: the entry was never
routed, or **the manifest claimed a page the build did not write**. The manifest
is a claim; a claim is not the artifact.

## Exclusions are typed, and a stale one is a finding

```
EXCLUDED
  pages/about@pt-BR
    reason: locale-not-built
    locale "pt-BR"; this build publishes "en". The kit routes one language at
    a time and chooses no URL strategy for the others, so the entry is withheld
    rather than published at a path nobody decided on.
```

An accidental exclusion and a deliberate one look identical in a build log.
They must not look identical here, so a reason is a value from a closed list —
there is no `"other"`, because a reason nobody can name is a defect wearing a
reason's clothes.

`locale-not-built` is derived from the rule rather than hand-listed (nobody
maintains a list of 1,235 translated entries), but **every entry it covers is
still named**. That is the whole difference between withheld and vanished.

## What it cannot see

- **Whether the page says the right thing.** A file with the right name and the
  wrong words passes. `content-reconcile` is that gate.
- **Content that never loaded.** Identity is assigned by Astro's loader, so an
  entry the loader never yields is never intended either. That is why
  `content.config.ts` pins `generateId` to the file path: the default derives
  the id from front matter `slug`, and two translations of one page share a
  slug by design — under the default, one silently won.
- **Custom post types.** The kit models WordPress core's five shapes. A CPT has
  no collection to be intended from.
