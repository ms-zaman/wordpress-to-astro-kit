# Architecture Decision Records

**Every architectural decision is recorded here.** A decision that exists only
in a chat transcript, a report or a code comment is not a decision.

- Filename: `NNNN-short-kebab-title.md`, sequential from `0001`, never reused.
- Status: `Proposed` → `Accepted` | `Rejected` → `Superseded by ADR-NNNN`.
- **Agents write `Proposed` only.** Only a person moves an ADR.
- ADRs are immutable once accepted. To change one, write a new ADR and mark
  the old one superseded.
- One decision per ADR.

## The nine a WordPress→Astro migration makes

1. **Rendering strategy** — static, server-rendered, or hybrid.
2. **Content ownership** — repository files, a headless CMS, or both.
3. **Documentation architecture**, if the site has documentation.
4. **SEO and URL strategy** — what is preserved, redirected, retired.
5. **Multilingual architecture** — whether translations migrate at all.
6. **Forms and the lead pipeline** — where a submission goes, and who owns it.
7. **Media** — which host serves the uploads namespace after cutover.
8. **Component and styling architecture.**
9. **Inherited markup** — what happens to the page builder's classes in a
   migrated body. Carried verbatim and styled, normalised on the way in, or
   stripped to semantic HTML. WordPress is not one editor, so this depends on
   which builders §1.3 found and in what proportion; a corpus that is 90%
   Gutenberg and 10% Elementor is a different decision from an even split.

`docs/02-architecture/adr-candidates.md` holds the same list with what each
depends on. `0000-template.md` is the shape.
