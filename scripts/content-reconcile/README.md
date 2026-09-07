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

**And "a word" is not an English word.** The first version of that guard was
`/[a-z0-9]/`, which describes the Latin alphabet and nothing else. No character
of `会社`, `দাম` or `كتاب` matches it, so on any non-Latin site every position
read as a word boundary, the guard silently evaporated, and containment alone
counted as agreement again — in the dangerous direction. Measured, before the
fix:

```
  says("$999.99/month", "$999.99/mo")   false   correct
  says("会社概要",  "会社")               TRUE    wrong
  says("দামি",     "দাম")               TRUE    wrong
  says("كتابي",    "كتاب")              TRUE    wrong
```

The rule is now Unicode general categories — a letter, a number or a **combining
mark** continues a word. The mark is the part a rule written against letters and
digits misses: after a match on `দাম` comes the vowel sign `ি`, which is a mark,
not a letter.

**Short is not the same as decorative.** The length floor was three characters,
which discarded `会社` ("company") and `採用` ("recruitment") — measured, a
Japanese page asked one string of three, and the other two were reported as
matched because they were never compared. The floor is now measured in
**graphemes** (`দামি` is 4 code points and 2 graphemes) and is script-aware:
three for text written entirely in Latin, Cyrillic, Greek and symbols, where an
icon font's glyphs live; two everywhere else, where one grapheme is a syllable
or a whole word. Latin behaviour is unchanged.

**Keys are normalised to NFC, never NFKC.** WordPress serves whatever the editor
stored, so `café` composed and decomposed must compare equal. NFKC is refused
because it folds full-width `Ａ` to `A` and `①` to `1`, and in Japanese and
Korean content that distinction is a real editorial choice a migration can get
wrong — folding it would hide the difference rather than report it.

`Intl.Segmenter` with `granularity: "word"` is deliberately **not** used. Its
CJK segmentation comes from an ICU dictionary that differs between builds, so
the same page would reconcile differently on two machines. Grapheme
segmentation is used, because UAX #29 grapheme rules are stable.

## Three things come off first, from both sides

1. **Anything hidden at every breakpoint, by ancestry.** A page builder emits
   full markup for a section it never paints, and the flags sit on the section,
   not on the heading six levels down. **Three markers are not four** —
   measured, a support page's FAQ band carried `desktop`, `tablet` and `mobile`
   but not `laptop`, so it painted at exactly one width and is real content.
   Which classes mean this is **configuration**, not an assumption — see
   "WordPress is not one editor" below.
2. **Anything the document carries but the page is not** — a popup, a modal, an
   off-canvas drawer.
3. **`aria-hidden="true"` subtrees.** Better than a hand-kept list of "icon
   noise": a footer's social links read `f Facebook` and `X X` to a naive scan,
   and the accessible name is what a reader gets. It also keeps what such a list
   would wrongly silence — a screen-reader-only label is a real accessible name,
   and differing from it is worth a ruling rather than a hush.

## WordPress is not one editor

Gutenberg, Elementor, Divi, WPBakery, Beaver Builder, the classic editor — and
any site with a history has two of them in different eras of itself. What a
builder emits for a section it hides at every width is entirely its own
business, so `migration.config.ts` declares it:

```ts
sourceMarkup: {
  builders: ["gutenberg"],       // measured: "gutenberg", "elementor"
  hiddenEverywhere: [],          // your theme's or plugins' sets
  notPartOfThePage: [],
}
```

The first version of this tool hard-coded Elementor's four classes, which made
it **silently wrong on every other site**: a Gutenberg site got rules that match
nothing while the report still claimed to have dropped the hidden sections.

The profiles in `builders.ts` contain only class names read off a real
stylesheet or a real page, and each says what was read. Two facts worth knowing:

- **Gutenberg's set is empty, and that is the measurement.** WordPress core's
  block library (10.5.0) ships no responsive-hide utility of any spelling — its
  only `.hide` rule is an internal of the image block's lightbox. If your
  Gutenberg site hides sections, the classes are your theme's or a plugin's.
- **`role="dialog"` applies to every site**, profile or not. It is a role, not
  a class: Gutenberg's navigation overlay, Elementor's popup and a theme's
  search drawer all mark themselves that way because the accessibility contract
  says to.

Naming a builder with no profile is an **error**, not a silent no-op — a typo
that selected nothing would produce a report claiming to have dropped the
hidden sections when it dropped none. Divi, WPBakery and Beaver Builder are
identified by `content-capture` but not profiled here: identifying a builder
and knowing how it hides a section are different facts, and only the first has
been established. Open a section your source site never paints, read the
classes off it, and put the set in `hiddenEverywhere`.

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
