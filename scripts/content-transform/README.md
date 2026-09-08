# `content:transform` — a capture becomes the content tree

```sh
pnpm content:capture --type post      # evidence
pnpm content:capture --type page
pnpm content:transform                # content/
pnpm content && pnpm media capture && pnpm build
```

## Why this exists now, when it deliberately did not before

The kit's README used to call this "the one step the kit deliberately leaves to
you", on the reasoning that turning a WordPress row into a content entry depends
on _your_ schemas.

That reasoning holds for a schema you have extended — a custom type with a
`price`, an ACF group. It does **not** hold for the shape every WordPress site
has: a post, a page, a category, a tag, an author. Those map onto the kit's own
content model with no judgement in them at all, and leaving them out meant
every migration began by writing the same transform, differently, and getting
the identity rules wrong in a new way each time.

So this is deliberately **narrow**. It transforms what the kit's own schemas
already describe and refuses everything else by name.

## What it refuses to do

- **It does not touch the body.** WordPress's HTML is carried verbatim. Media
  rewriting, internal-link rewriting and emoji inlining all happen at RENDER
  time, where each is one function that can be re-run. A transform that
  rewrote bodies on the way in would bake today's decisions into the content
  tree permanently.
- **It does not invent an excerpt.** WordPress auto-generates one when a post
  has none; storing that makes a derived value indistinguishable from a chosen
  one.
- **It does not invent a date, an author, or a term.** A row that cannot
  produce a valid entry is excluded with a reason.
- **It does not transliterate a slug.** WordPress's `post_name` is not
  restricted to ASCII; the content model is. A slug it cannot represent is
  refused rather than mangled into a URL the source never served — see
  [stranger-site-boundaries](../../docs/04-implementation/stranger-site-boundaries.md).

## Every row leaves a trace

The one invariant. For each set the command prints what the source declared,
what the capture holds, what became entries, and what was excluded **with the
reason** — and it exits non-zero if those do not add up:

```
  POST
    the source declares   18
    the capture holds     18
    became entries        18
    excluded, with reason 0
```

A row that produces neither an entry nor an exclusion has disappeared, and no
downstream gate can report an entity it was never shown.

## Exclusion reasons

|                        | meaning                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not-published`        | a draft, pending, private or trashed row                                                                                                            |
| `password-protected`   | WordPress withholds the body from REST; the kit does not model password-protected content                                                           |
| `incomplete`           | a required field the source did not supply — no date, no title, an unresolvable author, or an empty body (what a page builder looks like over REST) |
| `unrepresentable-slug` | not lowercase kebab-case, which the content model requires                                                                                          |

## Identity, kept separate

```
source identity   wp:post/post#101        the WordPress primary key
local identity    posts/hello-world@en    the entry
route identity    /hello-world/           the URL
output identity   hello-world/index.html  the file
```

`source: { system, sourceId, capturedAt }` goes into every entry's front
matter. The `sourceId` is the only name that survives a slug being edited, and
it stays **internal** — `dist/deployment.json` carries an origin and never an
id.

## What it does not migrate

Custom post types and custom taxonomies. Both are supported by the kit
_through a profile_, and a profile is a decision about what should become a
public URL — which this command has no basis to make. Capture them, add the
profile, and extend this transform against your own schema; the generic path is
the floor, not the ceiling.
