# `preview-audit`

Verifies a build before anyone looks at it. Read-only, zero dependency.

```
pnpm preview:audit        # build, then audit apps/website/dist/
pnpm preview:audit-test   # the suite, including one mutation per fault

node scripts/preview-audit/cli.ts [dist-directory] [--json] [--quiet]
```

## What it checks

| Check      | Question                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| `build`    | Does the output directory exist, and does it hold anything?                                           |
| `manifest` | Is `deployment.json` present, parseable and structurally sound?                                       |
| `routes`   | Was every route the manifest promised emitted — and was anything emitted the manifest does not claim? |
| `links`    | Does every same-origin link reach a page or file the build emitted?                                   |
| `assets`   | Does every stylesheet, image and other fetched file exist, and is it non-empty?                       |
| `scripts`  | Did any page acquire undeclared client-side JavaScript?                                               |

Exit 1 on any `error`. **Warnings never fail a run** — a warning is a fact the
audit can see but cannot call a defect without a ruling nobody has made. A local
build carrying the timestamp placeholder is the standing example.

## Why it duplicates part of the build audit

The build audit already asserts that no page ships an unexpected script. The
duplication is deliberate: the build audit runs inside the website package
against a build it just produced, and this runs against **an artifact**,
wherever that artifact came from. A host that injected an analytics snippet, a
preview-protection widget or a cookie banner into the served HTML would be
invisible to the first and caught by the second.

The two also fail differently in a useful way. The build audit knows what the
content _should_ have produced; this one knows only what is _in the directory_.
A build audit passing while this fails means the artifact was damaged after the
build — truncated, partially uploaded, or rewritten.

## Islands

A `<script>` fails unless it is one of three things:

1. `type="application/ld+json"` — data, which no engine executes, and which the
   SEO audit checks separately.
2. A declared island: `data-wpk-island="<name>"`, **inline**, and **not a
   module**. This kit ships two — the search island and the form transport.
3. Nothing else. A bare `<script>`, a `src=`, a `type="module"` and an inline
   `onclick` all fail.

The narrowing on an island is not cosmetic. This audit's link reader is a regex,
and a regex reader is only sound over markup that no script rewrites — so an
island that loaded a bundle could break the link check silently whether or not
somebody had declared it.

## Known limits

**The HTML reader is a regex, not a parser.** It cannot tell a comment from
markup, so a commented-out `<img src>` is checked as if it were live. That is
the conservative direction — it can report a link nobody follows, never miss a
broken one.

**It does not honour `<base href>`.** No layout emits one; a page that did would
change what every relative URL means, so it is reported as an error rather than
quietly resolved against.

**It does not follow external links.** They are counted and named, never
fetched. An audit that failed because someone else's site was down is an audit
nobody trusts.
