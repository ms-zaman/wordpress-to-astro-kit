// Does the content actually cross the build boundary?
//
// ## The hole this closes
//
// The kit could prove two things and believed it had proved a third:
//
//     content-contract   every file in `content/` is valid          ✓
//     build-audit        every route in the manifest exists in dist ✓
//     ------------------------------------------------------------------
//     nothing            every entry in `content/` became a page    ✗
//
// Both existing gates read one side. `content-contract` never opens `dist/`;
// `build-audit` compares the manifest's inventory against the emitted files,
// and both of those are OUTPUTS of the same build. Nothing crossed the
// boundary, so anything the resolver dropped between the two was invisible.
//
// That is not hypothetical. `resolveSiteRoutes` filters entries by locale,
// deliberately and correctly — the kit builds one language at a time. But a
// project that migrates a translated corpus into `content/` and builds gets a
// green ladder, a complete manifest, a valid site, and **not one of those
// pages**. Every gate is telling the truth about what it looked at.
//
// ## Identity, not counts
//
// A count comparison would pass a build that dropped one entry and invented
// another. So each intended thing carries a name (`content-identity.ts`) and
// the routes carry the same name, and this module joins the two sets.
//
// ## Three verdicts, and only one of them is allowed
//
//   EMITTED      intended, routed, and the file is in `dist/`
//   EXCLUDED     intended, not routed, and a TYPED exclusion says why
//   SOURCE_ONLY  intended, and it did not arrive — a failure
//   OUTPUT_ONLY  a page in `dist/` that no intended content explains
//
// The distinction between EXCLUDED and SOURCE_ONLY is the whole design. An
// exclusion has to be declared, has to give a reason, and has to match
// something — a rule that excludes nothing is a rule somebody forgot to
// delete, and it is reported too.
import {
  kindOf,
  localeOf,
  type ContentId,
  type ContentKind,
} from "./content-identity.ts";

/**
 * A reason an intended entry legitimately produces no page.
 *
 * Typed, and deliberately a short closed list. Every member is a decision the
 * kit has actually made and can defend; there is no `"other"`, because a
 * reason nobody can name is a defect wearing a reason's clothes.
 */
export type ExclusionReason =
  /**
   * The entry is in a language this build does not publish.
   *
   * The kit routes one locale (`resolveSiteRoutes`), and publishing a German
   * entry at an English path would be inventing a URL strategy nobody chose.
   * Declared here so a translated corpus is REPORTED as withheld rather than
   * silently absent — the difference between a decision and an accident.
   */
  | "locale-not-built"
  /**
   * The entry is routed, but at a path the permalink pattern does not
   * describe: the front page, and the page that supplies the posts listing's
   * title. WordPress does the same thing, and the page is emitted — this is a
   * REMAPPING, not a withholding, and it is listed as an exclusion only
   * because the naive `slug -> permalink` expectation does not hold for it.
   */
  | "routed-elsewhere";

export interface Exclusion {
  readonly id: ContentId;
  readonly reason: ExclusionReason;
  /** What a person reading the report needs in order to agree with it. */
  readonly detail: string;
}

/** One thing the content tree intends to publish. */
export interface IntendedContent {
  readonly id: ContentId;
  /** Where a reader would expect to find it, when that is knowable. */
  readonly expectedRoute?: string;
}

/** One page this build actually emitted, as the manifest records it. */
export interface EmittedRoute {
  readonly path: string;
  readonly file: string;
  /** The content this route came from, when it came from content at all. */
  readonly entry?: ContentId;
  /** `static`, `redirect`, `page`, `post`, `archive`, `pagination`. */
  readonly origin: string;
}

/** Route origins that legitimately have no content behind them. */
const CONTENT_FREE_ORIGINS = new Set(["static", "redirect"]);

/**
 * A route whose source is the site's structure rather than one entry.
 *
 * The posts listing is the only one: it is derived from the whole collection
 * and exists whenever any post does. `routing/route-identity.ts` gives it a
 * name beginning with `@`, which a content identity can never begin with, so
 * this cannot accidentally excuse a category archive that lost its row.
 */
const isStructural = (id: ContentId): boolean => id.startsWith("@");

export type FindingKind = "SOURCE_ONLY" | "OUTPUT_ONLY" | "UNUSED_EXCLUSION";

export interface IntegrityFinding {
  readonly kind: FindingKind;
  /** The content identity, or the route path for an `OUTPUT_ONLY`. */
  readonly subject: string;
  readonly detail: string;
  /** Everything a person needs to act, without opening the code. */
  readonly expectedRoute?: string;
  readonly expectedOutput?: string;
}

export interface ExcludedRecord {
  readonly id: ContentId;
  readonly reason: ExclusionReason;
  readonly detail: string;
}

export interface IntegrityReport {
  readonly emitted: readonly ContentId[];
  readonly excluded: readonly ExcludedRecord[];
  readonly findings: readonly IntegrityFinding[];
  readonly counts: Readonly<Record<ContentKind | "total", number>>;
}

const emptyCounts = (): Record<ContentKind | "total", number> => ({
  posts: 0,
  pages: 0,
  categories: 0,
  tags: 0,
  authors: 0,
  total: 0,
});

export interface IntegrityInput {
  /** Every identity `content/` intends to publish, in this build's locale set. */
  readonly intended: readonly IntendedContent[];
  /** Every route the manifest claims, with the identity behind it. */
  readonly emitted: readonly EmittedRoute[];
  /** Declared, typed reasons an intended identity produces no page. */
  readonly exclusions: readonly Exclusion[];
  /**
   * Files that actually exist in `dist/`, relative to it.
   *
   * Separate from `emitted` on purpose: the manifest is a CLAIM about what was
   * written, and a claim is not the artifact. `build-audit` already checks the
   * two agree; this gate needs the real set so "the route resolved but the
   * page is absent" is distinguishable from "the route was never resolved".
   */
  readonly filesInDist: ReadonlySet<string>;
}

/**
 * Join what the content tree intended against what the build emitted.
 *
 * Pure: no filesystem, no `astro:content`. The CLI reads `dist/` and hands the
 * result in, which is what lets the render contract execute every branch of
 * this without a build.
 */
export function checkContentIntegrity(input: IntegrityInput): IntegrityReport {
  const findings: IntegrityFinding[] = [];
  const emittedIds = new Map<ContentId, EmittedRoute>();
  for (const route of input.emitted)
    if (route.entry !== undefined && !emittedIds.has(route.entry))
      emittedIds.set(route.entry, route);

  const excusedBy = new Map<ContentId, Exclusion>();
  for (const exclusion of input.exclusions)
    excusedBy.set(exclusion.id, exclusion);

  const emitted: ContentId[] = [];
  const excluded: ExcludedRecord[] = [];
  const counts = emptyCounts();
  const usedExclusions = new Set<ContentId>();

  for (const intent of input.intended) {
    const route = emittedIds.get(intent.id);

    if (route !== undefined) {
      // Routed. The remaining question is whether the file is really there —
      // a manifest that promises a page it did not write is exactly the
      // silent failure this gate is for.
      if (!input.filesInDist.has(route.file)) {
        findings.push({
          kind: "SOURCE_ONLY",
          subject: intent.id,
          detail:
            "the route resolved and the manifest claims the page, but the file " +
            "is not in dist/. The build did not write what it said it wrote.",
          expectedRoute: route.path,
          expectedOutput: route.file,
        });
        continue;
      }
      emitted.push(intent.id);
      const kind = kindOf(intent.id);
      if (kind !== undefined) counts[kind] += 1;
      counts.total += 1;
      continue;
    }

    // Not routed. Only a declared reason makes that acceptable.
    const exclusion = excusedBy.get(intent.id);
    if (exclusion !== undefined) {
      usedExclusions.add(intent.id);
      excluded.push({
        id: intent.id,
        reason: exclusion.reason,
        detail: exclusion.detail,
      });
      continue;
    }

    findings.push({
      kind: "SOURCE_ONLY",
      subject: intent.id,
      detail:
        "content/ intends it and the build published nothing for it, with no " +
        "declared exclusion. Either route it, or declare why it is withheld.",
      expectedRoute: intent.expectedRoute,
      expectedOutput:
        intent.expectedRoute === undefined
          ? undefined
          : expectedFileFor(intent.expectedRoute),
    });
  }

  // Every emitted page must be explicable. A page nobody asked for is as much
  // a defect as a page that went missing — it is content the site publishes
  // that no source describes, which is what a stale build directory looks like.
  const intendedIds = new Set(input.intended.map((intent) => intent.id));
  for (const route of input.emitted) {
    if (CONTENT_FREE_ORIGINS.has(route.origin)) continue;
    if (route.entry !== undefined && isStructural(route.entry)) continue;
    if (route.entry === undefined) {
      findings.push({
        kind: "OUTPUT_ONLY",
        subject: route.path,
        detail:
          `a "${route.origin}" route carries no content identity, so nothing ` +
          "can say which entry it came from. Every content-derived route must " +
          "name its source.",
        expectedOutput: route.file,
      });
      continue;
    }
    if (!intendedIds.has(route.entry))
      findings.push({
        kind: "OUTPUT_ONLY",
        subject: route.path,
        detail: `emitted from "${route.entry}", which content/ does not intend.`,
        expectedOutput: route.file,
      });
  }

  // An exclusion that excuses nothing is a rule somebody forgot to delete, and
  // a stale rule is how a real defect gets waved through later.
  for (const exclusion of input.exclusions)
    if (!usedExclusions.has(exclusion.id))
      findings.push({
        kind: "UNUSED_EXCLUSION",
        subject: exclusion.id,
        detail:
          `declared "${exclusion.reason}", but no content has that identity. ` +
          "Delete it, or correct the identity it names.",
      });

  return { emitted, excluded, findings, counts };
}

/**
 * The `dist/` file a route path lands at.
 *
 * Duplicated from `route-inventory.ts`'s `pageFileFor` on purpose: this module
 * must stay importable by a gate that is checking the inventory, and a gate
 * that derives its expectation from the thing it is auditing proves nothing.
 */
export function expectedFileFor(path: string): string {
  // The trailing slash is stripped first. A permalink hint arrives as
  // `/a-second-post/` while a route key is `/a-second-post`, and joining the
  // first with `/index.html` produced `a-second-post//index.html` — a path
  // that exists nowhere, in a diagnostic whose only job is to be pasteable.
  const key = path.replace(/\/+$/, "");
  if (key === "") return "index.html";
  if (key === "/404") return "404.html";
  return `${key.replace(/^\//, "")}/index.html`;
}

/** The findings, grouped for a report a person reads top to bottom. */
export function findingsOfKind(
  findings: readonly IntegrityFinding[],
  kind: FindingKind,
): IntegrityFinding[] {
  return findings.filter((finding) => finding.kind === kind);
}

/**
 * The systemic exclusion this kit ships: entries in a language it does not build.
 *
 * Derived rather than hand-listed, because hand-listing every translated entry
 * would be a maintenance burden that nobody would keep and everybody would
 * eventually silence with a wildcard. The RULE is the declaration; each entry
 * it covers still appears by name in the report.
 */
export function localeExclusions(
  intended: readonly IntendedContent[],
  builtLocale: string,
): Exclusion[] {
  const excluded: Exclusion[] = [];
  for (const intent of intended) {
    const locale = localeOf(intent.id);
    if (locale === undefined || locale === builtLocale) continue;
    excluded.push({
      id: intent.id,
      reason: "locale-not-built",
      detail:
        `locale "${locale}"; this build publishes "${builtLocale}". The kit ` +
        "routes one language at a time and chooses no URL strategy for the " +
        "others, so the entry is withheld rather than published at a path " +
        "nobody decided on.",
    });
  }
  return excluded;
}
