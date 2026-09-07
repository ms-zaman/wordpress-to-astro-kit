# ADR candidates

**Status:** Draft
**Owner:** <name>
**Last updated:** <YYYY-MM-DD>
**Phase:** 02-architecture

The eight decisions every WordPress→Astro migration makes. Each becomes an
ADR in `decisions/ADR/`, written as a proposal with its evidence, and accepted
or rejected by a person.

| # | Decision | Depends on |
| --- | --- | --- |
| 1 | Rendering strategy — static, server-rendered, or hybrid | the dynamic surfaces in the integration census |
| 2 | Content ownership — repository files, a headless CMS, or both | who edits, and how often |
| 3 | Documentation architecture (if the site has docs) | ADR-2 |
| 4 | SEO and URL strategy — what is preserved, redirected, retired | the URL inventory |
| 5 | Multilingual architecture | whether translations are migrated at all |
| 6 | Forms and the lead pipeline | the integration census |
| 7 | Media strategy — where uploads are served from after cutover | hosting |
| 8 | Component and styling architecture | the presentation census |

## Still open

_Hosting provider, CMS vendor, form processor, analytics. A strategy being
accepted never implies its vendor is chosen._
