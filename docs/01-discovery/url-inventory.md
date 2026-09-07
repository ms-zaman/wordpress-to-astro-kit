# URL inventory

**Status:** Draft
**Owner:** <name>
**Last updated:** <YYYY-MM-DD>
**Phase:** 01-discovery

Every URL the live site exposes, and where each one came from.

## Method

_Tool, version, date, rate, user agent, auth state, and anything that would
change the result on a re-run._

## Totals

| Source | URLs |
| --- | --- |
| Sitemaps | _n_ |
| Crawl (beyond the sitemaps) | _n_ |
| Total unique | _n_ |

## By family

| Family | Count | Example | Disposition |
| --- | --- | --- | --- |
| Pages | | | preserve |
| Posts | | | preserve |
| Category archives | | | preserve |
| Tag archives | | | _decide_ |
| Author archives | | | _decide_ |
| Date archives | | | _decide_ |
| Pagination | | | preserve |
| Feeds | | | _decide_ |
| Language prefixes | | | _decide_ |

**Every family gets exactly one disposition: preserve, redirect, or a
recorded decision to retire it. A family with none is this document's defect.**

## Beyond the sitemaps

_Date archives, author archives, tag archives, pagination, feeds and language
prefixes are usually live and usually absent from a sitemap. Record what you
found and how._
