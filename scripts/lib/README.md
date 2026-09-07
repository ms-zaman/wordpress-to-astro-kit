# `scripts/lib/`

The seams every browser gate shares. Nothing here is a gate; each file exists
because two or more tools needed the same answer and a second copy would drift.

| File          | What it is                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cdp.ts`      | A Chrome DevTools Protocol client in a few dozen lines. Drives a Chrome already on the machine and downloads none.                                              |
| `serve.ts`    | A static server for `dist/`. Never a dev server: that would inject its own runtime and make "this site ships no script" a claim about the dev server.           |
| `routes.ts`   | Every HTML route in a build, discovered by walking the output — never from a list, because a list is how a new route escapes the audit that covers every route. |
| `manifest.ts` | The build's own route inventory, read back out of `dist/deployment.json`.                                                                                       |

## Why `manifest.ts` exists

Two gates need to know **which template generated a page**: `render-digest`
samples one family down to a handful of representatives, and
`accessibility-audit` asks whether a nav landmark is site chrome or is
contextual to one template.

Deriving that from the path shape looked adequate and was not. The first path
segment puts `/`, `/404` and `/about` in one bucket, so a breadcrumb that every
real page carries and the home page correctly does not becomes a majority — and
the audit then demands a breadcrumb on the home page. Measured on this kit's own
sample site, on the first run.

The manifest already knows the answer, because the route table built it.

## Why the browser is not downloaded

`cdp.ts` finds Chrome, Chromium or Brave in the usual places, or takes
`CHROME_PATH`. The trade is one fewer install step and no browser binary in a
lockfile, against a CI runner that must ship Chrome — `ubuntu-latest` does, and
the workflow checks for it out loud so a runner image that stops shipping it
fails with a readable message.

Playwright is the exception and brings its own browser, because operating a
control is a different job from measuring a page at rest.
