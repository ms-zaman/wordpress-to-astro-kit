# `stranger-site` — a site this kit has never seen

`pnpm stranger-test`

Every other suite here is tested against the kit's own sample content, which
was written by whoever wrote the code — so it proves the code works on the
shapes its author thought of. That is precisely the failure this kit keeps
finding one level up.

So: a museum. Its vocabulary shares nothing with the kit's fixtures.

|                  | the kit's fixtures     | the stranger                              |
| ---------------- | ---------------------- | ----------------------------------------- |
| custom post type | `product`, `portfolio` | `exhibition`                              |
| custom taxonomy  | `product_cat`          | `gallery_room`, served at `/rooms/`       |
| uploads path     | `/wp-content/uploads`  | `/wp-content/uploads/sites/4` (multisite) |
| `category_base`  | `category`             | `topics`                                  |
| output path      | `/media`               | `/collection-media`                       |

And the shapes a real migration meets that the kit's own content does not have:

- a category tree two deep, and a custom taxonomy tree two deep
- the term slug `openings` in **two** taxonomies, with different WordPress ids
- one image referenced **three times in three spellings** — root-relative,
  absolute, protocol-relative
- a filename with an **encoded space** (`east%20wing.jpg`)
- a `srcset` with two candidates, plus `data-src` / `data-srcset`
- a **PDF download**, and an ordinary page link that must _not_ be read as media
- a **missing** file that will never be captured
- a **background image** in a `style` attribute
- an **external** asset on somebody else's WordPress install
- a **query string** that must survive, and a **data URI** that must not be touched

## What it proved

It passed without any abstraction changing — because the three shapes most
likely to be assumed away had been measured first: the multisite uploads path,
protocol-relative URLs (a **real gap**: `rendering/media.ts` did not recognise
`//host/…` at all while four other modules in this kit did), and encoded
filenames.

If a fixture here starts failing, the abstraction is wrong, not the fixture.
