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
import { kindOf, localeOf, type ContentId } from "./content-identity.ts";
import { claimOf } from "./route-inventory.ts";
import {
  contestedSourceEntities,
  provenanceProblems,
  type Provenance,
} from "../content-model/provenance.ts";

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
   * The entry belongs to a post type whose profile says `published: false`.
   *
   * Different from having no profile at all, and the difference is the point:
   * a profile with `published: false` says "this type is known, its entries
   * are content, and they are deliberately withheld". A type with NO profile
   * is not withheld — it is unconfigured, and `content:capture census` reports
   * that separately, because nobody has decided anything about it yet.
   */
  | "type-not-published"
  /**
   * The term belongs to a taxonomy whose profile says `published: false`.
   *
   * A stored-only taxonomy: its terms are captured, validated, filed on
   * entries and printed as text, and no archive is published for them. Named
   * so the difference between "stored on purpose" and "lost" is visible.
   */
  | "taxonomy-not-published";

/**
 * The pipeline boundary an exclusion is decided at.
 *
 * ONE member, today, and that is a measured statement rather than an oversight:
 * every legitimate exclusion this kit makes is made by the route resolver,
 * which sees the entity and publishes nothing for it. Nothing is excluded at
 * the loader — `content.config.ts` defines a collection for every profile,
 * published or not, precisely so a withheld type's entries still load and can
 * still be named.
 *
 * The type exists anyway, because a reason and a stage answer different
 * questions: "why was it withheld" and "where do I go to change that". A second
 * boundary that starts withholding things has to declare itself here rather
 * than borrow the resolver's name — which is what a union of one buys, and an
 * untyped string would not.
 *
 * `routed-elsewhere` was a reason in this vocabulary until provenance was
 * traced end to end and it turned out nothing produced it: the front page and
 * the page that titles the posts listing are both EMITTED, carrying their
 * identity onto `/` and onto the listing's route. A reason nothing can
 * produce is the same lie as a config field nothing reads.
 */
export type ExclusionStage = "resolver";

export interface Exclusion {
  readonly id: ContentId;
  readonly reason: ExclusionReason;
  /** Where in the pipeline the decision was taken. */
  readonly stage: ExclusionStage;
  /**
   * The configuration responsible — `postTypes["internal-note"].published`,
   * `content/config/locales.json`.
   *
   * An exclusion that cannot name what decided it is a rule nobody can
   * change, and Part 9 of the provenance contract is that a withheld entity
   * is as traceable as a published one.
   */
  readonly by: string;
  /** What a person reading the report needs in order to agree with it. */
  readonly detail: string;
}

/** One thing the content tree intends to publish. */
export interface IntendedContent {
  readonly id: ContentId;
  /** Where a reader would expect to find it, when that is knowable. */
  readonly expectedRoute?: string;
  /**
   * Where it came from.
   *
   * REQUIRED, and that is the point: an entity whose origin nothing states is
   * an entity nobody can trace, re-capture or reconcile, and "we do not know"
   * has to be spelled `origin: "authored"` rather than left blank. A manifest
   * row without one is reported, because JSON cannot be made to carry a
   * TypeScript requirement and a manifest may come from any build.
   */
  readonly provenance: Provenance;
}

/** One page this build actually emitted, as the manifest records it. */
export interface EmittedRoute {
  readonly path: string;
  readonly file: string;
  /** The content this route came from, when it came from content at all. */
  readonly entry?: ContentId;
  /** `static`, `redirect`, `page`, `post`, `archive`, `pagination`. */
  readonly origin: string;
  /** The route module, for a static route's claim. */
  readonly source?: string;
}

/**
 * A route whose source is the site's structure rather than one entry.
 *
 * The posts listing is the only one: it is derived from the whole collection
 * and exists whenever any post does. `routing/route-identity.ts` gives it a
 * name beginning with `@`, which a content identity can never begin with, so
 * this cannot accidentally excuse a category archive that lost its row.
 */
const isStructural = (id: ContentId): boolean => id.startsWith("@");

export type FindingKind =
  | "SOURCE_ONLY"
  | "OUTPUT_ONLY"
  | "UNUSED_EXCLUSION"
  /** Two intended entities share one identity, or one identity two routes. */
  | "IDENTITY_CONTESTED"
  /** An entity or a route whose origin nothing states — see provenance.ts. */
  | "PROVENANCE_MISSING"
  /** Two local entities claim one source entity. */
  | "PROVENANCE_CONTESTED";

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
  /** The boundary that decided it, and the configuration that says so. */
  readonly stage: ExclusionStage;
  readonly by: string;
  readonly detail: string;
}

export interface IntegrityReport {
  readonly emitted: readonly ContentId[];
  readonly excluded: readonly ExcludedRecord[];
  readonly findings: readonly IntegrityFinding[];
  /** Emitted entries per collection, plus `total`. Keys grow with the config. */
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * Counts start at the core collections and GROW.
 *
 * A fixed shape was wrong the moment collections became configuration: a
 * custom type's collection name is not known here, and incrementing a key that
 * does not exist yields NaN rather than 1 — a count that reads as a number and
 * is not one.
 */
const emptyCounts = (): Record<string, number> => ({
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

  // Defence in depth, and a lesson paid for: this gate joins through a `Map`
  // and a `Set`, and BOTH of those deduplicate. Two intended entries with one
  // identity used to collapse into one key, match the one emitted route, and
  // report zero findings — the gate agreeing with itself about a page that had
  // silently replaced another.
  //
  // The content contract catches this at the filesystem, which is the earliest
  // boundary that sees both files. This is the second line, because a manifest
  // can also be written by a build the contract never ran over.
  const intendedSeen = new Map<ContentId, number>();
  for (const intent of input.intended)
    intendedSeen.set(intent.id, (intendedSeen.get(intent.id) ?? 0) + 1);
  for (const [id, count] of [...intendedSeen].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
    if (count > 1)
      findings.push({
        kind: "IDENTITY_CONTESTED",
        subject: id,
        detail:
          `${count} intended entries share this identity. One of them was ` +
          "loaded and the rest were not, and a join through a map cannot tell " +
          "that apart from there only ever having been one.",
      });

  // Provenance. Two rules, and both are about a thing that is PRESENT and
  // unattributable rather than a thing that went missing — which is why no
  // other check in this gate can see either of them.
  //
  //   1. every intended entity states an origin
  //   2. no source entity is claimed by two local identities
  //
  // The second is the one nothing else could ever catch: two entries carrying
  // WordPress post 42 have different slugs, different routes and different
  // output files, so identity, route and output uniqueness all pass, and one
  // of the two is still not the thing it says it is.
  for (const intent of input.intended) {
    if (intent.provenance === undefined) {
      findings.push({
        kind: "PROVENANCE_MISSING",
        subject: intent.id,
        detail:
          "the manifest names it as intended and says nothing about where it " +
          "came from. An entity with no stated origin cannot be re-captured, " +
          'reconciled, or traced back to a source site — write `"authored"` if ' +
          "it genuinely has no WordPress entity behind it.",
      });
      continue;
    }
    for (const problem of provenanceProblems(intent.provenance))
      findings.push({
        kind: "PROVENANCE_MISSING",
        subject: intent.id,
        detail: problem,
      });
  }

  for (const contested of contestedSourceEntities(
    input.intended
      .filter((intent) => intent.provenance !== undefined)
      .map((intent) => ({ provenance: intent.provenance, by: intent.id })),
  ))
    findings.push({
      kind: "PROVENANCE_CONTESTED",
      subject: contested.key,
      detail: contested.detail,
    });

  const emittedIds = new Map<ContentId, EmittedRoute>();
  const routesPerIdentity = new Map<ContentId, string[]>();
  for (const route of input.emitted) {
    if (route.entry === undefined) continue;
    if (!emittedIds.has(route.entry)) emittedIds.set(route.entry, route);
    const seen = routesPerIdentity.get(route.entry);
    if (seen === undefined) routesPerIdentity.set(route.entry, [route.path]);
    else seen.push(route.path);
  }

  // One identity claiming two routes that are not pages of one listing. A
  // paginated archive legitimately spans several paths and shares one
  // identity; two SINGLE pages from one entry is an entity published twice,
  // which is a duplicate-content defect no search engine forgives.
  for (const [id, paths] of [...routesPerIdentity].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (paths.length < 2) continue;
    const listing = input.emitted.some(
      (route) =>
        route.entry === id &&
        (route.origin === "pagination" ||
          route.origin === "archive" ||
          route.origin === "custom-archive" ||
          route.origin === "taxonomy-archive"),
    );
    if (listing) continue;
    findings.push({
      kind: "IDENTITY_CONTESTED",
      subject: id,
      detail:
        `one entity is published at ${paths.length} paths — ${paths.sort().join(", ")}. ` +
        "Only a paginated listing may span several, and none of these is one.",
    });
  }

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
      if (kind !== undefined) counts[kind] = (counts[kind] ?? 0) + 1;
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
        stage: exclusion.stage,
        by: exclusion.by,
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
  //
  // Attribution is asked as a TOTAL question — `claimOf` — rather than as a
  // content check with two origins exempted. A set called CONTENT_FREE_ORIGINS
  // used to skip `static` and `redirect`, which is true and also meant a route
  // became unattributable simply by claiming to be one of them. Now a static
  // route is claimed by its module and a redirect by its rule, and having no
  // claimant at all is the finding.
  const intendedIds = new Set(input.intended.map((intent) => intent.id));
  for (const route of input.emitted) {
    const claim = claimOf(route);
    if (claim === undefined) {
      findings.push({
        kind: "OUTPUT_ONLY",
        subject: route.path,
        detail:
          `a "${route.origin}" route has no claimant: it names no content ` +
          "identity, no route module and no redirect rule, so nothing can say " +
          "what this page is. Every emitted output is attributable to exactly " +
          "one owner.",
        expectedOutput: route.file,
      });
      continue;
    }
    if (claim.by !== "content") continue;
    if (isStructural(claim.local)) continue;
    if (!intendedIds.has(claim.local))
      findings.push({
        kind: "OUTPUT_ONLY",
        subject: route.path,
        detail: `emitted from "${claim.local}", which content/ does not intend.`,
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
 * Entries of a post type whose profile withholds it.
 *
 * Derived from the profile rather than hand-listed, for the same reason the
 * locale rule is: nobody maintains a list of every entry of a withheld type.
 * Each entry it covers is still named in the report — a type that is not
 * published is not a type that is forgotten.
 */
export function unpublishedTypeExclusions(
  intended: readonly IntendedContent[],
  withheldCollections: readonly { name: string; type: string }[],
): Exclusion[] {
  const byCollection = new Map(
    withheldCollections.map((one) => [one.name, one.type]),
  );
  const excluded: Exclusion[] = [];
  for (const intent of intended) {
    const collection = kindOf(intent.id);
    if (collection === undefined) continue;
    const type = byCollection.get(collection);
    if (type === undefined) continue;
    excluded.push({
      id: intent.id,
      reason: "type-not-published",
      stage: "resolver",
      by: `postTypes["${type}"].published`,
      detail:
        `post type "${type}" has a profile in migration.config.ts with ` +
        `published: false. Its entries are captured, validated and named here, ` +
        `and no page is produced for them. Set published: true to publish the ` +
        `type, or delete the profile if the type should not be migrated at all.`,
    });
  }
  return excluded;
}

/**
 * Terms of a taxonomy whose profile stores rather than routes them.
 *
 * Same shape as the withheld-type rule and for the same reason: derived from
 * the profile, and still naming every term it covers.
 */
export function unpublishedTaxonomyExclusions(
  intended: readonly IntendedContent[],
  withheldCollections: readonly { name: string; taxonomy: string }[],
): Exclusion[] {
  const byCollection = new Map(
    withheldCollections.map((one) => [one.name, one.taxonomy]),
  );
  const excluded: Exclusion[] = [];
  for (const intent of intended) {
    const collection = kindOf(intent.id);
    if (collection === undefined) continue;
    const taxonomy = byCollection.get(collection);
    if (taxonomy === undefined) continue;
    excluded.push({
      id: intent.id,
      reason: "taxonomy-not-published",
      stage: "resolver",
      by: `taxonomies["${taxonomy}"].published`,
      detail:
        `taxonomy "${taxonomy}" has a profile in migration.config.ts with ` +
        `published: false. Its terms are stored on entries and rendered as ` +
        `text; no term archive is published. Set published: true to route ` +
        `them, or delete the profile if the taxonomy should not be migrated.`,
    });
  }
  return excluded;
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
      stage: "resolver",
      by: "content/config/locales.json — defaultLocale",
      detail:
        `locale "${locale}"; this build publishes "${builtLocale}". The kit ` +
        "routes one language at a time and chooses no URL strategy for the " +
        "others, so the entry is withheld rather than published at a path " +
        "nobody decided on.",
    });
  }
  return excluded;
}
