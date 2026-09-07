// The seven SEO checks.
//
// Every rule reads the BUILT output, because the built output is what a
// crawler receives. Where a value already has a home in the application it is
// imported rather than restated: the description bounds, the title budget, the
// robots directive and the origin seam all come from `apps/website/src/`, so a
// page and this audit cannot disagree about what the rule IS.
//
// ## What this audit deliberately does not check
//
// | Property | Where it is already checked |
// | --- | --- |
// | Exactly one `<h1>`, no skipped levels | `a11y:audit` |
// | Every image has an `alt` | `render:build-audit` |
// | No broken internal link | `preview:audit` |
// | No horizontal overflow (mobile usability) | `layout:audit` |
//
// A second copy of any of those would be a second thing to keep in step, and
// the first copy already has mutation tests behind it.
import { robotsDirective } from "../../apps/website/src/deployment/site-environment.ts";
import type { SiteEnvironment } from "../../apps/website/src/deployment/site-environment.ts";
import {
  META_DESCRIPTION_MAX,
  META_DESCRIPTION_MIN,
  TITLE_MAX,
} from "../../apps/website/src/rendering/head-model.ts";
import { isReviewOnly, type Page } from "../accessibility-audit/pages.ts";
import { error, warning, type Finding } from "./finding.ts";

/* ------------------------------------------------------------------ */
/* Reading the head                                                    */
/* ------------------------------------------------------------------ */

/** Everything before `</head>`. Nothing below it is a head tag. */
export function headOf(html: string): string {
  const end = html.indexOf("</head>");
  return end === -1 ? "" : html.slice(0, end);
}

/**
 * Decode the entities Astro emits in an attribute value.
 *
 * Only the five that matter: a description containing an apostrophe is emitted
 * as `&#39;` and would otherwise be counted six characters longer than the
 * crawler sees it. This is not a general HTML entity decoder and must not
 * become one.
 */
export function decodeAttribute(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Every `<meta>` in the head, as `name`/`property` to content. */
export function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const match of headOf(html).matchAll(/<meta\b([^>]*)>/g)) {
    const attributes = match[1]!;
    const key =
      /\sname="([^"]*)"/.exec(attributes)?.[1] ??
      /\sproperty="([^"]*)"/.exec(attributes)?.[1];
    const content = /\scontent="([^"]*)"/.exec(attributes)?.[1];
    if (key !== undefined && content !== undefined)
      tags.set(key, decodeAttribute(content));
  }
  return tags;
}

/** The `<title>` text, or `undefined` when there is no title element. */
export function titleOf(html: string): string | undefined {
  const match = /<title>([\s\S]*?)<\/title>/.exec(html);
  return match === null ? undefined : decodeAttribute(match[1]!).trim();
}

/** Every `rel="canonical"` href in the head. More than one is itself a defect. */
export function canonicalsOf(html: string): string[] {
  return [
    ...headOf(html).matchAll(/<link\b[^>]*rel="canonical"[^>]*>/g),
  ].flatMap((match) => {
    const href = /\shref="([^"]*)"/.exec(match[0])?.[1];
    return href === undefined ? [] : [decodeAttribute(href)];
  });
}

/** Every `application/ld+json` block body in the page. */
export function structuredDataOf(html: string): string[] {
  return [
    ...html.matchAll(
      /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ].map((match) => match[1]!);
}

const isAbsolute = (url: string): boolean =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(url) || url.startsWith("//");

/** The path a dist file was built for. */
export const pagePath = (file: string): string => {
  if (file === "index.html") return "/";
  if (file === "404.html") return "/404";
  return `/${file.replace(/\/index\.html$/, "")}`;
};

/* ------------------------------------------------------------------ */
/* 1 — title                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every page has one title, it fits, and no two pages share one.
 *
 * The duplicate rule is the one with teeth. Two pages with the same title are
 * two pages a search engine has to choose between, and it is the commonest
 * on-page defect on a generated site — every archive page inheriting one
 * template string.
 *
 * ## The budget is an error on YOUR pages and a warning on the content's
 *
 * `families` maps an emitted file to the route origin the build's own manifest
 * recorded. A `static` route — the home page, `/404`, `/search` — is titled by
 * a template in this repository, so an over-budget title there is a rule you
 * can simply follow, and it is an error.
 *
 * A `page`, `post` or `archive` route takes its title from a content entry,
 * and in a migration that entry carries the SOURCE SITE'S title verbatim.
 * Those titles are the articles' names and their search identity; shortening
 * one is an editorial act on somebody else's writing. In the project this kit
 * came from, 175 of 278 live titles were over this budget. So it is reported,
 * counted in every run, and does not fail the build — and if you decide to
 * rewrite them, that is a decision to record, not a gate to satisfy.
 *
 * Without a manifest every page is treated as yours. That is the strict
 * direction, and it is what an arbitrary directory gets.
 */
export function checkTitle(
  pages: readonly Page[],
  families: ReadonlyMap<string, string> = new Map(),
): Finding[] {
  const findings: Finding[] = [];
  const byTitle = new Map<string, string[]>();

  for (const page of pages) {
    const title = titleOf(page.html);
    if (title === undefined || title.length === 0) {
      findings.push(
        error("title", page.file, "missing", "the page has no <title>"),
      );
      continue;
    }
    if (title.length > TITLE_MAX) {
      const origin = families.get(page.file) ?? "static";
      const authored = origin === "static";
      const report = authored ? error : warning;
      findings.push(
        report(
          "title",
          page.file,
          "too-long",
          `the title is ${title.length} characters and the budget is ${TITLE_MAX} — a search engine will cut it: "${title}"` +
            (authored
              ? ""
              : " (this page's title comes from a content entry; if it was carried from the source site, shortening it is an editorial decision to record rather than a defect to fix here)"),
        ),
      );
    }
    byTitle.set(title, [...(byTitle.get(title) ?? []), page.file]);
  }

  for (const [title, files] of byTitle)
    if (files.length > 1)
      findings.push(
        error(
          "title",
          files.sort()[0]!,
          `duplicate:${title}`,
          `${files.length} pages share the title "${title}" — ${files.sort().join(", ")}`,
        ),
      );

  return findings;
}

/* ------------------------------------------------------------------ */
/* 2 — meta description                                                */
/* ------------------------------------------------------------------ */

/**
 * Every page has one description, within budget, and its own.
 *
 * The bounds are imported rather than restated, so a page and this rule read
 * the same two numbers. Over the maximum is cut in the result; under the
 * minimum is usually ignored altogether and the engine writes its own snippet
 * from the page — which throws away the one sentence the author controlled.
 */
export function checkDescription(pages: readonly Page[]): Finding[] {
  const findings: Finding[] = [];
  const byDescription = new Map<string, string[]>();

  for (const page of pages) {
    const head = headOf(page.html);
    const count = [...head.matchAll(/<meta\b[^>]*name="description"/g)].length;
    if (count > 1)
      findings.push(
        error(
          "description",
          page.file,
          "duplicated-tag",
          `${count} <meta name="description"> tags on one page`,
        ),
      );

    const description = metaTags(page.html).get("description");
    if (description === undefined || description.trim().length === 0) {
      findings.push(
        error(
          "description",
          page.file,
          "missing",
          'the page has no <meta name="description">',
        ),
      );
      continue;
    }

    if (description.length > META_DESCRIPTION_MAX)
      findings.push(
        error(
          "description",
          page.file,
          "too-long",
          `the description is ${description.length} characters and the budget is ${META_DESCRIPTION_MAX} — a search engine will cut it`,
        ),
      );
    else if (description.length < META_DESCRIPTION_MIN)
      findings.push(
        error(
          "description",
          page.file,
          "too-short",
          `the description is ${description.length} characters, under the ${META_DESCRIPTION_MIN} floor — a search engine is likely to ignore it and write its own snippet`,
        ),
      );

    if (description.trim() === titleOf(page.html))
      findings.push(
        error(
          "description",
          page.file,
          "repeats-title",
          "the description is the title again, so it adds nothing to the result",
        ),
      );

    byDescription.set(description, [
      ...(byDescription.get(description) ?? []),
      page.file,
    ]);
  }

  for (const [description, files] of byDescription)
    if (files.length > 1)
      findings.push(
        error(
          "description",
          files.sort()[0]!,
          `duplicate:${description.slice(0, 40)}`,
          `${files.length} pages share one description — ${files.sort().join(", ")}`,
        ),
      );

  return findings;
}

/* ------------------------------------------------------------------ */
/* 3 — social tags                                                     */
/* ------------------------------------------------------------------ */

/** The tags `head-model.ts` emits on every production page, unconditionally. */
const REQUIRED_SOCIAL = [
  "og:title",
  "og:type",
  "og:site_name",
  "og:locale",
  "twitter:card",
  "twitter:title",
] as const;

/**
 * Production pages carry the social head, and it agrees with the page.
 *
 * The agreement half is the part a missing-tag check would not catch: an
 * `og:description` that drifts from `<meta name="description">` means a link
 * preview says one thing and a search result another, and both came from the
 * same route.
 */
export function checkSocial(pages: readonly Page[]): Finding[] {
  const findings: Finding[] = [];

  for (const page of pages) {
    if (isReviewOnly(page.file)) continue;
    const tags = metaTags(page.html);

    for (const key of REQUIRED_SOCIAL) {
      const content = tags.get(key);
      if (content === undefined || content.trim().length === 0)
        findings.push(
          error("social", page.file, `missing:${key}`, `no ${key}`),
        );
    }

    const title = titleOf(page.html);
    if (
      tags.has("og:title") &&
      title !== undefined &&
      tags.get("og:title") !== title
    )
      findings.push(
        error(
          "social",
          page.file,
          "og-title-drift",
          `og:title and <title> disagree — "${tags.get("og:title")}" vs "${title}"`,
        ),
      );

    const description = tags.get("description");
    if (
      tags.has("og:description") &&
      description !== undefined &&
      tags.get("og:description") !== description
    )
      findings.push(
        error(
          "social",
          page.file,
          "og-description-drift",
          "og:description and the meta description disagree",
        ),
      );

    // A card type that promises an image the page does not carry renders as a
    // blank preview.
    if (
      tags.get("twitter:card") === "summary_large_image" &&
      !tags.has("og:image")
    )
      findings.push(
        error(
          "social",
          page.file,
          "card-without-image",
          'twitter:card is "summary_large_image" and the page carries no og:image',
        ),
      );

    for (const key of ["og:url", "og:image"] as const) {
      const value = tags.get(key);
      if (value !== undefined && !isAbsolute(value))
        findings.push(
          error(
            "social",
            page.file,
            `relative:${key}`,
            `${key} is "${value}" — it must be an absolute URL, and a relative one is silently dropped by most consumers`,
          ),
        );
    }
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/* 4 — canonical, in both directions                                   */
/* ------------------------------------------------------------------ */

/**
 * The canonical contract, and which half applies depends on the project.
 *
 * **With no production origin** (`rendering/site-identity.ts`), a canonical
 * cannot be built and none may be emitted. This half is not a relaxation — it
 * is the assertion that nothing invented one. A canonical pointing at a
 * placeholder host is worse than no canonical at all: absent, a crawler treats
 * the fetched URL as canonical; wrong, it follows the placeholder.
 *
 * **With an origin**, every production page must carry exactly one, it must be
 * absolute, and it must be **on our own origin**.
 *
 * That last clause is the one that is easy to omit, and omitting it let the
 * defect through twice in the original project. The no-origin branch rejects
 * any canonical at all, precisely because one pointing at a placeholder is
 * worse than none — but the with-origin branch only asked whether the URL was
 * absolute, and `https://example.com/anything` is absolute. So the moment an
 * origin was configured, an override row started emitting a real instruction
 * to crawlers to index a domain nobody owned, and the audit reported zero
 * errors over it.
 *
 * A legitimate cross-host canonical is a real thing in general. If you want
 * one it needs a decision row, not a silent pass.
 */
export function checkCanonical(
  pages: readonly Page[],
  // REQUIRED, and it must not gain a default. A default parameter cannot
  // express "explicitly no origin": passing `undefined` selects the default,
  // so the moment `siteOrigin()` returns a host there is no longer any way —
  // from `audit.ts` or from a test — to reach the no-origin branch below, and
  // it rots while reading as covered. `audit.ts` computes this with an `in`
  // check, which is the distinction the language does make.
  origin: string | undefined,
): Finding[] {
  const findings: Finding[] = [];

  for (const page of pages) {
    const canonicals = canonicalsOf(page.html);

    if (canonicals.length > 1) {
      findings.push(
        error(
          "canonical",
          page.file,
          "multiple",
          `${canonicals.length} canonical links on one page — a crawler picks one and it is not defined which`,
        ),
      );
      continue;
    }

    if (origin === undefined) {
      if (canonicals.length > 0)
        findings.push(
          error(
            "canonical",
            page.file,
            "premature",
            `a canonical points at "${canonicals[0]}" and no production origin has been decided — a canonical to a host that is not ours sends every crawler somewhere else`,
          ),
        );
      continue;
    }

    if (isReviewOnly(page.file)) continue;
    if (canonicals.length === 0) {
      findings.push(
        error(
          "canonical",
          page.file,
          "missing",
          "an origin is configured and this page emits no canonical",
        ),
      );
      continue;
    }
    if (!isAbsolute(canonicals[0]!)) {
      findings.push(
        error(
          "canonical",
          page.file,
          "relative",
          `the canonical is "${canonicals[0]}" and a canonical must be absolute`,
        ),
      );
      continue;
    }
    if (!canonicals[0]!.startsWith(`${origin.replace(/\/$/, "")}/`))
      findings.push(
        error(
          "canonical",
          page.file,
          "foreign",
          `the canonical is "${canonicals[0]}", which is not on ${origin} — a canonical to a host that is not ours sends every crawler somewhere else`,
        ),
      );
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/* 5 — robots                                                          */
/* ------------------------------------------------------------------ */

/**
 * Every page carries the robots directive the launch switch decides.
 *
 * Preview: `noindex` everywhere — the one head tag whose absence would put a
 * preview into a search index. Production: the indexable directive on every
 * page except the surfaces no environment indexes. The environment comes from
 * `dist/deployment.json`, so this audit checks the contract of the build it is
 * actually reading rather than the one it assumes.
 */
export function checkRobots(
  pages: readonly Page[],
  environment: SiteEnvironment = "preview",
): Finding[] {
  return pages
    .map((page) => {
      const robots = metaTags(page.html).get("robots") ?? "";
      const expected = robotsDirective(pagePath(page.file), environment);
      return robots.trim() === expected
        ? undefined
        : error(
            "robots",
            page.file,
            "robots",
            `the page emits <meta name="robots" content="${robots}">; the ${environment} build expects "${expected}"`,
          );
    })
    .filter((finding): finding is Finding => finding !== undefined);
}

/* ------------------------------------------------------------------ */
/* 6 — structured data                                                 */
/* ------------------------------------------------------------------ */

/**
 * Structured data, where it exists, is valid.
 *
 * Not "every page has some" — most pages have no type worth claiming, and an
 * invented `@type` is worse than none. What is asserted is that a block which
 * IS emitted parses, names schema.org, and carries a type. A malformed block
 * is ignored in full by every consumer, so a typo costs the whole page's rich
 * result and produces no other symptom.
 */
export function checkStructuredData(pages: readonly Page[]): Finding[] {
  const findings: Finding[] = [];

  for (const page of pages) {
    for (const [index, block] of structuredDataOf(page.html).entries()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(block);
      } catch (cause) {
        findings.push(
          error(
            "structured-data",
            page.file,
            `invalid-json:${index}`,
            `a ld+json block is not valid JSON (${(cause as Error).message}) — a consumer discards the whole block`,
          ),
        );
        continue;
      }

      const record = parsed as Record<string, unknown>;
      if (record["@context"] !== "https://schema.org")
        findings.push(
          error(
            "structured-data",
            page.file,
            `context:${index}`,
            `a ld+json block declares @context ${JSON.stringify(record["@context"])} rather than "https://schema.org"`,
          ),
        );
      // A block says what it is in one of two ways, and both are correct
      // JSON-LD: a top-level `@type`, or a `@graph` of nodes that each carry
      // one. The graph form says two things at once — who publishes the site
      // and what the site is — and it is the shape every WordPress SEO plugin
      // emits, so a rule that only knew the first form reported it as typeless.
      const graph = record["@graph"];
      const typedGraph =
        Array.isArray(graph) &&
        graph.length > 0 &&
        graph.every(
          (node) =>
            typeof (node as Record<string, unknown>)?.["@type"] === "string" &&
            ((node as Record<string, string>)["@type"] ?? "").length > 0,
        );
      const typedRoot =
        typeof record["@type"] === "string" && record["@type"].length > 0;
      if (!typedRoot && !typedGraph)
        findings.push(
          error(
            "structured-data",
            page.file,
            `type:${index}`,
            "a ld+json block carries no @type, and no @graph of typed nodes, so nothing can interpret it",
          ),
        );
    }
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/* 7 — head hygiene                                                    */
/* ------------------------------------------------------------------ */

/**
 * The three head properties that are cheap, universal, and easy to lose.
 *
 * `lang` is the one that matters most and is checked nowhere else: a document
 * with no language is a document a screen reader pronounces with the wrong
 * voice and a search engine files under the wrong locale. `viewport` is a
 * mobile-usability ranking input. `keywords` has been ignored by every search
 * engine for over a decade, and its presence is a signal that someone is
 * following advice from a very old page — a warning, not a defect.
 */
export function checkHead(pages: readonly Page[]): Finding[] {
  const findings: Finding[] = [];

  for (const page of pages) {
    const lang = /<html\b[^>]*\slang="([^"]*)"/.exec(page.html)?.[1];
    if (lang === undefined || lang.trim().length === 0)
      findings.push(
        error("head", page.file, "no-lang", "<html> carries no lang attribute"),
      );

    const tags = metaTags(page.html);
    if (!tags.has("viewport"))
      findings.push(
        error(
          "head",
          page.file,
          "no-viewport",
          "the page emits no viewport meta, so a phone renders it at desktop width",
        ),
      );

    if (tags.has("keywords"))
      findings.push(
        warning(
          "head",
          page.file,
          "keywords",
          '<meta name="keywords"> is ignored by every search engine and is worth removing',
        ),
      );
  }

  return findings;
}
