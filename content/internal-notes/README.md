# `content/internal-notes`

Entries of the `internal-note` custom post type: **NOT published — captured, validated, named as intended, and deliberately withheld**.

The profile that decides all of that is in `postTypes` in
`migration.config.ts`; the boundary of what a profile can express is
[scripts/custom-types/](../../scripts/custom-types/README.md).

Every entry here is `source.system: sample` — a synthetic fixture, not
migrated content, and not a claim about any real site. They exist so the
custom-type path runs in the kit's own ladder on every build instead of only in
a unit test. Delete them when you replace the sample content.
