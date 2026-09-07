# Content model

**Status:** Draft
**Owner:** <name>
**Last updated:** <YYYY-MM-DD>
**Phase:** 01-discovery

What the live site holds, counted.

## Post types

| Type | REST route | Count | Body format | Migrates to |
| --- | --- | --- | --- | --- |
| `post` | `wp/v2/posts` | | | `content/posts/` |
| `page` | `wp/v2/pages` | | | `content/pages/` |

## Taxonomies

| Taxonomy | Route | Terms | Assignments | Archive URLs? |
| --- | --- | --- | --- | --- |

## Users

_How many publish? Does `wp/v2/users` answer, or must nicenames be read from
author-archive links?_

## Media

_Attachment count, total size, and which rendition widths the library holds._

## Bodies

_How many are block-editor, classic, or builder-rendered. A builder-rendered
body often returns only an intro over REST — count those separately, they need
a page scrape._
