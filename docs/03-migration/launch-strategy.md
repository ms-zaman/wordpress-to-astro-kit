# Launch strategy

**Status:** Draft
**Owner:** <name>
**Last updated:** <YYYY-MM-DD>
**Phase:** 03-migration

What ships first, what ships later, and what has to be true on the day.

## Release 1

_The surfaces that must be live at cutover._

## Later

_What is deliberately deferred, and why that is safe._

## The SEO gate

- [ ] Every live URL is a page, a redirect, or a recorded retirement
- [ ] Per-URL metadata seeded and dispositioned
- [ ] Canonicals absolute and correct
- [ ] `robots.txt` and `sitemap.xml` correct for a production build
- [ ] Redirects resolve in one hop to a page that exists

## Rollback

_The old site stays up and untouched until cutover is verified. Say what the
trigger to roll back is, and who decides._
