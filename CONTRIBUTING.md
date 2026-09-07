# Contributing

## The rule that shapes everything here

**Nothing site-specific goes in the kit.** Not a colour, not a URL, not a
class prefix, not a page. If a change would make the kit fit one site better
and every other site worse, it belongs in that site's repository.

The three places identity is allowed to live, and nowhere else:

- `migration.config.ts` — the source site and its URL structure
- `content/config/site.json` — the site's name, origin, logo, profiles
- the prefix `pnpm kit:init` stamps — classes, build variables, package scope

Design tokens carry no prefix and no measured value: every one ships marked
`provisional`, because a token with somebody else's brand in it is worse than
a neutral placeholder.

## Before you open a pull request

```sh
pnpm validate
```

That is lint, format, Astro diagnostics, both content contracts, the rendering
contract, the build audit and the suites. CI runs the same thing.

Two more, by hand, when your change touches what a page looks like:

- build and **open** the pages you changed at 1440 and 375. A gate proves a
  page has not changed; only a person can say it is right.
- read the rendered text of a page you changed. Prose is not something any
  audit reads for truth.

## Adding a gate

A gate earns its place by catching a defect that reached a person. Write down
which one, in the gate's own header, along with what it cannot see. A check
whose claim is broader than its implementation is how a project comes to
believe it is covered.

## Adding a capture tool

Read-only, polite, and it identifies itself. It writes evidence under
`research/` and never touches a content file — the transform is a separate,
pure module, so the fetch and the interpretation can be reviewed apart.
