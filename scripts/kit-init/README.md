# kit-init

```sh
pnpm kit:init --name acme --site-name "Acme" --origin https://acme.com --live-origin https://old.acme.com
```

Stamps your identity into the kit. The kit ships with a placeholder prefix —
`wpk-` on classes and data attributes, `WPK_` on build variables, `@wpk/` on
workspace packages — so it builds the moment it is cloned. This renames every
occurrence to the name you give it, records the new prefix in the root
`package.json` (`kit.prefix`), writes the site's name and production origin to
`content/config/site.json`, and the live origin to `migration.config.ts`.

Design tokens carry no prefix (`--color-primary`) and are untouched.

Run it again with a different name and it renames again: the current prefix is
read from `package.json`, never assumed. `--dry-run` lists what would change.
After a rename, `pnpm install` refreshes the workspace links.

`pnpm kit:init-test` proves it on a copy of the repository: no file still
carries the old prefix, the identity landed where it lives, and a second run
reads the new prefix as current.
