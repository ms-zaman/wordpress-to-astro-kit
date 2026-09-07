# research/

**Raw evidence. Observation only — never interpretation.**

Everything captured from the site being migrated lands here, exactly as it was
received, and is **tracked in git**: it is the evidence base for every claim
in `docs/`, and a claim whose evidence is not reviewable is an assumption.

Every artifact records:

- **Source** — the exact URL, tool or origin
- **Date and time** of capture, ISO 8601
- **Method** — tool and version, the command or settings, the viewport where
  it matters
- **Conditions** — anything that would change the result on a re-run: network,
  location, auth state, cache state

## Rules

- **Raw artifacts stay raw.** Never edit a capture to make it tidier or more
  convenient. Corrections belong in the synthesis document, not in the
  evidence.
- **Observation here, interpretation in `docs/`.** Never mixed.
- **Quantitative claims need a number, a sample size and a date.** Not "the
  site is slow" — the metric, the URL, the run and the date.
- **All collection is read-only and polite.** It must never modify the source
  site.

## Suggested layout

```
research/
  crawls/         page HTML, sitemaps, robots.txt, URL inventories
  captures/       structured captures (REST responses, rendered measurements)
  screenshots/    visual captures, named with viewport and date
  performance/    measurement output
  seo/            metadata exports
```

Create a subdirectory when you have something to put in it, not to reserve a
name.
