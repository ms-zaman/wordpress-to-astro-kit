# `content-reconcile`

Proves that **every string the source site's page paints is said by yours, or
explicitly ruled on** — and that nothing on yours is invented.

```
pnpm content:reconcile-fetch   # save the source pages, once
pnpm content:reconcile         # build, then compare — offline
pnpm content:reconcile-test    # the suite
```

Two commands, for the reason every capture in this kit is split from its
comparison: `fetch` reaches out to somebody else's server once, and the
reconciliation then runs on every build, in CI, with no network at all.

## Why it exists

In one session on the project this kit came from, the owner personally caught
two defects that **fourteen gates had passed**: a plan bar shipped with two tabs
where the source had three, and a panel was rebuilt as a centred variant of one
the source already painted differently.

Nothing asked the obvious question. A URL audit proves a page exists. A build
audit proves it carries what the routes composed. Neither asks whether the page
**says what the source page says**.

## What it compares, and why not markup

Not "is the markup the same". Two engines mark the same role up differently and
always will: the source puts a plan price in an `<h2>`, your build puts it in a
`<th>`. **Three prototypes compared element-for-element and each buried the real
findings under forty differences nobody can see.**

The comparison is deliberately asymmetric:

|            |                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `asked()`  | the STRUCTURED strings — headings and things a reader acts on. What a missing band, tab or card shows up as |
| `saidBy()` | everything a page says, flattened                                                                           |

A finding is a string one page **asks** that the other never **says**, matched
at a word boundary. Run both ways, that catches content the source carries and
you dropped, and copy you invented that the source has no trace of.

**A match ends where a word ends.** Plain containment is not enough, and a test
caught it: `$999.99/mo` sits inside `$999.99/month`, so a struck-through price
matched the live one and a real difference reported itself as agreement.

## Three things come off first, from both sides

1. **Anything hidden at every breakpoint, by ancestry.** A page builder emits
   full markup for a section it never paints, and the flags sit on the section,
   not on the heading six levels down. **Three markers are not four** —
   measured, a support page's FAQ band carried `desktop`, `tablet` and `mobile`
   but not `laptop`, so it painted at exactly one width and is real content.
2. **Anything the document carries but the page is not** — a popup, a modal, an
   off-canvas drawer.
3. **`aria-hidden="true"` subtrees.** Better than a hand-kept list of "icon
   noise": a footer's social links read `f Facebook` and `X X` to a naive scan,
   and the accessible name is what a reader gets. It also keeps what such a list
   would wrongly silence — a screen-reader-only label is a real accessible name,
   and differing from it is worth a ruling rather than a hush.

Hidden markers are dropped on the **source side only**. Your build does not
emit a section it does not paint, and a class that happened to collide with a
marker name would silently delete real content.

## The four ways it fails

|                |                                                                 |
| -------------- | --------------------------------------------------------------- |
| `UNPAINTED`    | the source paints it, you never say it, nobody said why         |
| `INVENTED`     | you paint it and the source has no trace of it                  |
| `STALE`        | a ruling for a string neither page paints any more              |
| `CONTRADICTED` | a ruling for a string that IS matched — one of the two is wrong |

## Rulings are claims about evidence

Every unmatched string needs a row in `rulings.ts` or the run fails. The table
ships **empty**, and each row says what was looked at and what it said.

A `reworded` row **must name what your build says instead**, and the table
checks itself: a row whose reason only says "we say it differently" is rejected,
because it silences a finding without recording anything a later reader can
check.

A key may be global or scoped to one route (`"/pricing:the string"`). Route
scope exists because one string can mean different things on different pages: a
plan description on a pricing page can be the heading of a shared feature list
elsewhere, and a flat map can only rule a string everywhere.

**"Hidden" is not a verdict.** Whether the source paints a string at any width
is derived from its own markup, per element. It needs no human claim and cannot
go stale — if the source un-hides something, the reconciler sees a painted
string with no ruling and fails.

## What it looks like on real pages

Two live pages against a real build:

```
  /pricing      65 matched   0 ruled   (source asks 90, we ask 60)
  /enterprise   99 matched   0 ruled   (source asks 119, we ask 111)

  UNPAINTED (45)   a thirteen-language switcher, a struck `$999.99/mo`,
                   screen-reader-only social labels
  INVENTED (12)    `skip to content`, and six `… (required)` form labels
```

Every one is a real difference somebody has to rule on. The required-field
labels are the interesting case: the source marks a required field with a bare
asterisk that a screen reader skips, and this build adds a visually hidden
"(required)" so the control's accessible name states it. That is a `ours`
ruling with evidence, not a defect — and the reconciler is right to demand the
row.

## What it cannot see

- **Order and layout.** Two pages that say the same words in a different
  arrangement reconcile clean. That is the walk's job.
- **Prose you rewrote wholesale.** A paragraph replaced by a different
  paragraph is one `unpainted` and one `invented`, and nothing here knows they
  are the same paragraph.
- **A page you have not paired.** `routePairs` is added to as each page is
  built; a page with no pair is not compared, and the run says how many pairs
  it ran.
