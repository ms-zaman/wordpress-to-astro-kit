# `media` — the asset migration engine

```sh
pnpm media discover   # what the content tree references, classified
pnpm media capture    # download what is migratable into public/
pnpm media verify     # every reference names a file that is really there
```

A migration is not finished while the site still asks the old WordPress server
for its images.

## What was here before

A **seam**, not a pipeline. `rendering/media.ts` rewrote the _origin_ of a
preserved uploads reference at render time and nothing fetched, copied or
verified a byte — so a migrated site could not be served with the source
install switched off. There were also two uncoordinated definitions of "the
uploads namespace" (one allowed a query string, the other refused it), and
`//host/wp-content/uploads/…` was recognised by four modules in this kit and
not by the media seam.

Both strategies still exist, and a real migration uses both at once:

|            | named by            | what happens                                                          | when                            |
| ---------- | ------------------- | --------------------------------------------------------------------- | ------------------------------- |
| **COPY**   | `media.migrateFrom` | the file is captured into `public/`, the reference becomes `/media/…` | the source is going away        |
| **ORIGIN** | `WPK_MEDIA_ORIGIN`  | nothing is copied; the reference keeps its uploads path               | a host still serves the library |

The engine runs first, so a reference it owns becomes local and one it does not
— a file nobody has captured yet — still gets an origin.

## Four identities

```
source      https://old.example.com/wp-content/uploads/2026/01/a.png?ver=2
normalized  uploads:2026/01/a.png
local       /media/2026/01/a.png
output      apps/website/public/media/2026/01/a.png
```

The normalized identity is what makes one file referenced fifteen times **one
owned asset**. It keeps the uploads directory structure and **hashes nothing**:
WordPress puts `2026/01/a.png` and `2026/02/a.png` in different months, and
flattening would collide two real files while hashing would only rename the
collision and make the output unreadable.

## Six classifications, and none of them is a warning

|               | meaning                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPPORTED`   | in the uploads namespace, on a host `migrateFrom` names. Copy it                                                                              |
| `CONFIGURED`  | outside uploads but inside `media.extraPaths` — somebody decided this                                                                         |
| `EXTERNAL`    | a real remote asset, left exactly where it is                                                                                                 |
| `UNSUPPORTED` | a `data:` URI, a fragment, a `mailto:`, a document-relative path, a directory, a path escaping uploads. Never rewritten, always with a reason |
| `MISSING`     | a reference whose file nothing captured. `verify` fails                                                                                       |
| `CONFLICT`    | two hosts resolving to one output file. The engine will not choose                                                                            |

## The rule that keeps this safe

**A reference is migrated when its HOST is named in `migrateFrom` — never
because it contains `/wp-content/uploads/`.** A migrated body routinely carries
images from other people's sites, and some of those are WordPress too.
Rewriting one would point this site at a file it never captured.

A root-relative path needs no host and is always the site's own.

## One authority, and what it replaced

`identifyAsset` is the only answer to _"is this URL a migratable or local asset,
and which asset is it?"_ Three places used to answer it independently:

|                                        | its rule                                                                                                           | what it got wrong                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `content-model/shared.ts` (`mediaRef`) | its own `^(?:<liveOrigin>)?/wp-content/uploads/[^?#]+$` plus a `url.includes("wp-content/uploads")` substring test | measured across 18 forms, it disagreed with the engine on **11**                   |
| `rendering/media.ts`                   | two regexes built from `liveOrigin`                                                                                | did not recognise `//host/…` at all                                                |
| `pages/media-manifest.json.ts`         | its own extension allowlist and host parse                                                                         | assumed every asset is an image or a PDF; skipped custom types and unbuilt locales |

Three of the schema's disagreements were live defects:

```
/media/2026/01/a.png                  REJECTED — the engine's own output form,
                                      so a migrated image could not be stored
                                      in a featuredImage
/wp-content/uploads/../../etc/passwd  ACCEPTED — a path escape
/wp-content/uploads/2026/01/          ACCEPTED — a directory
```

plus a hard-coded `/wp-content/uploads/` that ignored `media.uploadsPath`, so a
**multisite** library was unrepresentable.

`mediaRef` keeps exactly one rule of its own, and it is deliberately not a
namespace rule: a media URL in the uploads namespace **on a host
`migrateFrom` does not list** is refused. That is either your library rewritten
onto a CDN — a decision `WPK_MEDIA_ORIGIN` owns at build time, not the content
tree — or somebody else's library stored as this entry's image. A _body_ may
reference another site's uploads freely; `featuredImage`, `avatar` and
`ogImage` are curated fields.

**`/assets/` is gone.** It was an address space `mediaRef` accepted and nothing
implemented — no directory, no copy step, nothing served it. A file you keep in
the repository goes in `apps/website/public/<localBase>/`, which the classifier
recognises as the `output` namespace.

## Reference forms that are read and rewritten

`src` · `srcset` (every candidate, descriptors preserved) · `href` (only when
it names a file the engine owns — an ordinary page link is not media) ·
`poster` · `data-src` · `data-srcset` · `data-lazy-src` · `data-lazy-srcset` ·
CSS `url(...)` in a `style` attribute or a `<style>` block · Markdown
`![](…)` and `[](…)`.

Queries and fragments survive: WordPress appends `?ver=` and a plugin can
append a real parameter, and dropping either changes what the browser asks for.
The _file_ is the same either way, which is why the normalized key ignores the
query and the emitted reference keeps it.

Encoded paths are **never decoded**. `%20` and a literal space are different
bytes in a URL; WordPress serves the encoded form, and decoding then re-encoding
can produce a URL the source never had.

## Where each stage is enforced

| stage                | module                                | checked by                               |
| -------------------- | ------------------------------------- | ---------------------------------------- |
| DISCOVER             | `scripts/media/scan.ts`               | `pnpm media discover`                    |
| IDENTIFY / NORMALIZE | `src/media/asset-identity.ts`         | `pnpm media-test`                        |
| OWN                  | `distinctAssets`, `assetConflicts`    | `pnpm media verify`                      |
| CAPTURE              | `scripts/media/cli.ts`                | paced, refuses a path escaping `public/` |
| EMIT                 | `apps/website/public/<localBase>/`    | Astro's static passthrough               |
| REWRITE              | `src/media/references.ts`             | `prepareBody`, on every render           |
| VERIFY               | `pnpm media verify`, in `validate`    | plus `render:build-audit`                |
| BROWSER              | `scripts/browser-tests/media.spec.ts` | `naturalWidth`, not a status code        |

`public/` was chosen over an asset pipeline because Astro copies it verbatim —
the output path _is_ the URL, the build is deterministic, and `preview-audit`
**already** asserts that every internal asset a page references exists in the
build output. Migrated media became checkable by a gate written before this
engine existed.

## What is deliberately not supported

- **No remote fetching of external assets.** `EXTERNAL` means left alone. There
  is no allowlist that quietly mirrors somebody else's file.
- **No image optimisation, no `astro:assets`.** Re-emitting a file at a new path
  is a decision with an owner; the engine moves bytes, it does not transform
  them.
- **No document-relative references.** The engine sees references without the
  page they are on, so it cannot resolve `images/a.png` — and it says so rather
  than assuming a base.
- **No CDN strategy.** `localBase` is a path on this site. Where that path is
  served from is a hosting decision the kit does not make.
- **No `sizes` rewriting.** It holds lengths, not URLs.
- **Capture needs `liveOrigin`** for root-relative references: without a host
  there is nothing to fetch from, and it refuses rather than guessing.

## Mutations this suite proves

`pnpm media-test` runs thirteen. The ones worth reading are the **upstream
omissions** — a reference the scanner never sees is one no downstream gate can
report:

- **M9** proves the scanner walks JSON for any `url`, rather than reading a
  field list that goes stale the moment a schema gains a field.
- **M10** caught a real defect while it was being written: `variants[].url`
  lines begin with `- `, and a pattern anchored on `url:` after whitespace
  missed every rendition in the library.

`pnpm stranger-test` runs the whole engine over a museum — a multisite uploads
path, encoded filenames, one file in three spellings, a PDF, a missing file, a
background image, and somebody else's WordPress install.
