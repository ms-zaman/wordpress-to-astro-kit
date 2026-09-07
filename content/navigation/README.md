# content/navigation/

**Content set:** Navigation data · **Collection:** `navigation` · **Schema:**
`apps/website/src/content-model/navigation.ts`

One JSON file per menu. Array position **is** menu order; there is no `order`
field, because two sources of order is how they drift apart.

**Structure is content; rendering is not.** A file here carrying markup, CSS
classes or builder vocabulary is a boundary violation — the schema rejects it.

| File                  | Rendered by                                    |
| --------------------- | ---------------------------------------------- |
| `header.json`         | `SiteHeader` → `Navigation variant="bar"`      |
| `header-actions.json` | `SiteHeader` — the calls to action, as buttons |
| `footer.json`         | `SiteFooter` → `Navigation variant="columns"`  |
| `footer-legal.json`   | `SiteFooter` — the bottom row                  |

The four sample menus carry `source.system: "sample"`. Replace them with the
live site's menus, captured over `wp/v2/menus` and `wp/v2/menu-items` (public
on WordPress 5.9+ when a theme registers menu locations) or transcribed from
the rendered header and footer. Every internal `href` must resolve to a page
this build publishes; the rendering contract fails on one that does not,
because a broken link in site chrome is broken on every page at once.
