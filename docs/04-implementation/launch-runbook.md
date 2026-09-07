# Launch runbook

**Status:** Draft
**Owner:** Engineering (execution); the decisions in §2–§4 are the site owner's
**Last updated:** <YYYY-MM-DD>
**Phase:** 04-implementation

What has to be true for this build to replace the WordPress site, in the order
it has to be true.

## 1. The launch switch

One variable decides which of two sites a build is
(`apps/website/src/deployment/site-environment.ts`):

| `WPK_SITE_ENV` | robots meta | `robots.txt` | `sitemap.xml` | footer |
| --- | --- | --- | --- | --- |
| unset / `preview` | `noindex` everywhere | `Disallow: /` | empty `<urlset>` | carries the scope notice |
| `production` | indexable, except `/search` and `/404` | `Allow: /`, names the sitemap | every indexable, non-paginated page | no notice |

Nothing else reads it. `grep -rn "siteEnvironment(" apps/website/src` is the
complete list of surfaces that change at cutover, and `dist/deployment.json`
records which build you are holding. Every gate reads that field and checks
the contract of the build it was given:

```sh
WPK_SITE_ENV=production pnpm build
pnpm --filter @wpk/website render:build-audit
```

**Do not flip it before the DNS cutover.** A production build served anywhere
public while WordPress still answers the domain puts two copies of every page
in one index.

## 2. Media — one variable, one decision that is not engineering's

Every migrated body references the source site's uploads namespace
byte-for-byte. `dist/media-manifest.json` lists every file the build depends
on, including the `srcset` renditions. The seam that decides which host serves
them is `apps/website/src/rendering/media.ts`:

| `WPK_MEDIA_ORIGIN` | effect |
| --- | --- |
| unset | the live origin from `migration.config.ts` — paths unchanged, WordPress keeps serving them |
| e.g. `https://media.example.com` | the same paths, that host |

**The decision:** does the WordPress box (or a proxy in front of it) keep
serving `/wp-content/uploads/` after cutover, or is the library mirrored to
object storage first? Both are one variable here; only the second needs an
infrastructure step, and the manifest is the list to mirror and verify against.

Until then the site depends on that host being up. It is the one external
runtime dependency the build has.

## 3. Forms — one variable per form

`apps/website/src/forms/routing.ts` is the authority on where a submission
goes. A form is unwired until a build variable names an endpoint for it:

```sh
WPK_FORM_ENDPOINT_CONTACT=https://…  pnpm build
```

Wired, a form posts natively and the transport island upgrades it to an
in-page submit with explicit success and failure states. Unwired, it renders
its fields, says a submission is not sent, and offers the alternative that
does work. Nothing ever reports a success it did not get.

**The decision:** the processor (a vendor choice) and the owner of each lead
stream. The endpoint must accept `multipart/form-data` and answer 2xx.

## 4. Hosting

No adapter is configured and none is needed: the build is static. What a host
must do:

1. **Serve `dist/` with directory-index resolution** (`/blog/` →
   `blog/index.html`). The site emits one URL shape and it is the
   trailing-slash one. A host that strips the slash answers every internal
   link with a 301 — configure it to keep the directory form.
2. **Answer the redirect table.** `dist/_redirects` is the Netlify /
   Cloudflare Pages format; `dist/redirects.json` is the same table
   host-agnostically. A host that reads neither still works — every rule is
   also a meta-refresh page — but answers 200 where it should answer 301.
3. **Serve `dist/404.html`** for an unmatched path.
4. **Honour any splat rules.** A language prefix is a splat: only a host can
   honour a prefix, because a static build cannot enumerate what falls under
   one.

## 5. The cutover order

1. Mirror the media, or confirm the uploads host stays up (§2).
2. Wire the forms that have an owner (§3).
3. Deploy `WPK_SITE_ENV=production` to a temporary hostname.
4. **Walk the review map** — a person, not a gate. Record it in
   `apps/website/src/release/signoff.ts` under the name of whoever looked.
5. Point DNS at the host.
6. Verify, with curl and a browser: a redirect answers; `robots.txt` allows
   and names the sitemap; `sitemap.xml` lists the pages; a migrated page
   renders its images.
7. Submit the sitemap to Search Console.

## 6. What is not engineering-blocked

Everything above except §2, §3 and §4: those are the site owner's decisions.
The build, the redirects, the launch switch, the search and the SEO layer are
in the repository and green.
