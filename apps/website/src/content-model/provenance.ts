// Where a migrated thing came from — the fourth kind of name in this kit.
//
// ## Four names, and they are not interchangeable
//
// The kit already had three, and the whole point of this module is that they
// answer different questions:
//
//     source identity   which entity in the SOURCE this represents
//                       `wp:post/product#42` — WordPress's own primary key
//     local identity    which entry in `content/` represents it
//                       `products/analyser@en` — see content-identity.ts
//     route identity    which URL claims it
//                       `/products/analyser` — see routing/permalink.ts
//     output identity   which file was emitted for it
//                       `products/analyser/index.html`
//
// Related, and never equal. A slug edit changes the local, route and output
// identities of a thing whose source identity did not move at all — which is
// precisely why a re-capture matches on the source id and nothing else.
//
// ## Why it had to be built
//
// Traced before writing any of this, the pipeline lost provenance at ONE
// boundary and lost it completely. `content/` carried `source.sourceId` in
// front matter; `resolver.ts`'s `PostEntryData` did not declare the field, so
// the resolver could not see it; nothing downstream — route, inventory,
// manifest, `dist/` — carried it either. The kit could prove a page arrived
// and could not say what it was a page OF.
//
// ## Source entity vs derived entity
//
// A source entity exists in WordPress and has a primary key there. A derived
// entity is something this build generates because the CONFIGURATION says to,
// and inventing a WordPress id for one would be a lie the artifact then
// repeats forever.
//
//     source     page, post, custom-type entry, taxonomy term, user
//     derived    the posts index, a custom type's listing
//
// A TERM ARCHIVE is deliberately not in the derived list. It is generated, but
// it is generated FOR one term, and the term is a source entity with an id —
// so the archive's provenance is the term's, and `/product-category/laptops/`
// answers "which source entity?" with `wp:term/product_cat#7`. That is the
// representation the routing layer already uses, not a new one.
import type { ValidationIssue } from "./cross-entry.ts";
import { soleClaimant, type Claimant } from "./ownership.ts";
import type { ContentId } from "../deployment/content-identity.ts";

/**
 * What kind of thing this is in WordPress's own vocabulary.
 *
 * Three, because WordPress stores content in three tables with three id
 * spaces: `wp_posts.ID`, `wp_terms.term_id`, `wp_users.ID`. An id is only
 * unique WITHIN one of them, so a source identity that omitted the kind would
 * merge post 42 with term 42 — a collision this kit can and does check for.
 */
export type SourceEntityKind = "post" | "term" | "user";

/** The primary key of one thing on the source site. */
export interface SourceEntity {
  readonly kind: SourceEntityKind;
  /**
   * The post type key or the taxonomy name — `page`, `post`, `product`,
   * `category`, `post_tag`, `product_cat`. `user` for a user, which WordPress
   * has exactly one kind of.
   *
   * WordPress's key, not this kit's collection name. The two differ on
   * purpose: a collection is where the content lives here, a type is what the
   * source called it, and the profile in `migration.config.ts` carries both
   * because two installs have used one type key for different things.
   */
  readonly type: string;
  /** `wp_posts.ID`, `wp_terms.term_id` or `wp_users.ID`. */
  readonly id: number;
  /**
   * The language of this particular source entity, where language is part of
   * its identity.
   *
   * WordPress core has no translations, and every plugin that adds them
   * (Polylang, WPML, a multisite) makes each translation a separate row with a
   * separate id. So this is usually redundant — and it is carried anyway,
   * because a site that DOES key one id to several languages needs post 123 in
   * `en` and post 123 in `pt-BR` to stay two things rather than collide.
   */
  readonly locale?: string;
}

/**
 * A stable string for one source entity: `wp:post/product#42@en`.
 *
 * The join key for "no source identity maps to two local identities". Not a
 * URL and never parsed back into one — `wp:` says so at a glance, so a reader
 * who finds one in a report cannot mistake it for something to click.
 */
export function sourceKey(source: SourceEntity): string {
  const locale = source.locale === undefined ? "" : `@${source.locale}`;
  return `wp:${source.kind}/${source.type}#${source.id}${locale}`;
}

/** Something this build generates because the configuration says to. */
export type DerivedEntityKind =
  /** The posts listing — `permalinks.postsIndex`. */
  | "posts-index"
  /** A custom type's listing — `postTypes[].archive`. */
  | "type-archive";

export interface DerivedEntity {
  readonly kind: DerivedEntityKind;
  /** The collection it lists. */
  readonly collection: string;
  /**
   * The configuration that declares it — `permalinks.postsIndex`,
   * `postTypes["product"].archive`.
   *
   * Named rather than implied, because "why does this route exist?" is the
   * question a derived entity has to answer and "the code makes it" is not an
   * answer anybody can act on.
   */
  readonly declaredBy: string;
}

/**
 * Where a thing came from.
 *
 * `wordpress` carries a source entity; `authored` and `sample` are honest
 * statements that there is no source entity to carry, and `derived` says the
 * configuration produced it. There is no fifth value and no "unknown": an
 * origin nobody can name is the failure this module exists to end.
 */
export type ProvenanceOrigin = "wordpress" | "authored" | "sample" | "derived";

/** One entity's lineage, as far as this build can state it. */
export interface Provenance {
  /** The local content identity — `products/analyser@en`, `@archive/products`. */
  readonly local: ContentId;
  readonly origin: ProvenanceOrigin;
  /** The collection that owns it. Absent only for a derived structural route. */
  readonly collection?: string;
  /** The locale of the local entry, where it has one. */
  readonly locale?: string;
  /** Present when, and only when, `origin` is `wordpress`. */
  readonly source?: SourceEntity;
  /** Present when, and only when, `origin` is `derived`. */
  readonly derived?: DerivedEntity;
}

// ---------------------------------------------------------------------------
// The collection → WordPress type vocabulary.
// ---------------------------------------------------------------------------

/**
 * What WordPress calls each of this kit's core collections.
 *
 * Measured from `create_initial_post_types()` and `create_initial_taxonomies()`
 * in `wp-includes/taxonomy.php` and `post.php`: the tag taxonomy's name is
 * `post_tag`, not `tag`, and the category taxonomy's is `category`. Writing
 * `tag` here would produce a source identity that matches nothing on the
 * source site — which is the one thing a source identity must never do.
 */
export const CORE_SOURCE_TYPES: Readonly<
  Record<string, { kind: SourceEntityKind; type: string }>
> = {
  pages: { kind: "post", type: "page" },
  posts: { kind: "post", type: "post" },
  authors: { kind: "user", type: "user" },
  categories: { kind: "term", type: "category" },
  tags: { kind: "term", type: "post_tag" },
};

export interface TypeVocabulary {
  /** Collection → what WordPress calls it. */
  readonly of: (collection: string) =>
    | {
        kind: SourceEntityKind;
        type: string;
      }
    | undefined;
}

/**
 * The vocabulary for one configuration: the core collections plus a profile's.
 *
 * Built from the profiles rather than hard-coded, for the reason every other
 * derived thing in this kit is: a type added to `migration.config.ts` must not
 * need a second edit here, and a profile REMOVED must leave its collection
 * unknown so the contract can report the orphan rather than guess a type key.
 */
export function typeVocabulary(config: {
  readonly postTypes: readonly { name: string; collection: string }[];
  readonly taxonomies: readonly { name: string; collection: string }[];
}): TypeVocabulary {
  const table = new Map<string, { kind: SourceEntityKind; type: string }>(
    Object.entries(CORE_SOURCE_TYPES),
  );
  for (const profile of config.postTypes)
    table.set(profile.collection, { kind: "post", type: profile.name });
  for (const profile of config.taxonomies)
    table.set(profile.collection, { kind: "term", type: profile.name });
  return { of: (collection) => table.get(collection) };
}

// ---------------------------------------------------------------------------
// Deriving a record.
// ---------------------------------------------------------------------------

/** The `source` block a content entry or registry row carries. */
export interface SourceBlock {
  readonly system: string;
  readonly sourceId?: string;
  readonly capturedAt?: string;
}

/**
 * The provenance of one local entity.
 *
 * `undefined` for a collection the vocabulary does not know, which is not a
 * default: it means a profile was removed and its content left behind, and the
 * content contract reports that directory as unclaimed. Guessing a type key
 * here would paper over exactly that.
 */
export function provenanceOfEntity(input: {
  readonly local: ContentId;
  readonly collection: string;
  readonly locale?: string;
  readonly source?: SourceBlock;
  readonly vocabulary: TypeVocabulary;
}): Provenance | undefined {
  const known = input.vocabulary.of(input.collection);
  if (known === undefined) return undefined;

  const system = input.source?.system;
  if (system !== "wordpress")
    return {
      local: input.local,
      origin: system === "sample" ? "sample" : "authored",
      collection: input.collection,
      ...(input.locale === undefined ? {} : { locale: input.locale }),
    };

  const id = Number(input.source?.sourceId);
  return {
    local: input.local,
    origin: "wordpress",
    collection: input.collection,
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    source: {
      kind: known.kind,
      type: known.type,
      id,
      ...(input.locale === undefined ? {} : { locale: input.locale }),
    },
  };
}

/** The provenance of something the configuration generates. */
export function provenanceOfDerived(
  local: ContentId,
  derived: DerivedEntity,
): Provenance {
  return { local, origin: "derived", derived };
}

// ---------------------------------------------------------------------------
// Public provenance — the same record with the source site's keys taken out.
// ---------------------------------------------------------------------------

/**
 * Provenance as a PUBLIC artifact may carry it: origin, collection, locale and
 * the derived entity, and never the source site's primary keys.
 *
 * ## Why the type says `never` rather than just omitting the field
 *
 * `Omit<Provenance, "source">` would describe the same shape and catch nothing:
 * `source` is optional on `Provenance`, so a full record assigns to an `Omit`
 * of it without complaint and the key rides along into the JSON. `source?:
 * never` makes putting one there a compile error at the call site, which is
 * where a leak would be introduced and the only place it is cheap to stop.
 *
 * ## Why the rest of it stays
 *
 * `origin` is a category, not an identifier — "this came from WordPress" says
 * nothing about which install or which row. `collection` and `locale` are
 * already in the manifest on every route. `derived.declaredBy` names a setting
 * in THIS repository's own configuration. None of them describes the source
 * site, and the deployment contract needs every one: the integrity gate joins
 * on identity and reports a withheld entity by name, and it cannot do either
 * from a row that says only "something was here".
 */
export interface PublicProvenance extends Omit<Provenance, "source"> {
  readonly source?: never;
}

/**
 * Drop the source entity, keeping everything a deployment artifact needs.
 *
 * The one place the split happens. A public artifact that wants provenance
 * calls this; there is no second path that could quietly forget to.
 */
export function withoutSourceEntity(record: Provenance): PublicProvenance {
  const { source: _source, ...rest } = record;
  return rest;
}

/**
 * Everything structurally wrong with a record that is DELIBERATELY missing its
 * source entity.
 *
 * Not `provenanceProblems` with a flag: the two disagree about the same field
 * in opposite directions, and a boolean parameter that inverts a rule is how a
 * check ends up being called with the wrong argument and passing. Here, a
 * `wordpress` row with no source entity is correct, and a row that still
 * carries one is the defect — which is the regression this whole change is
 * about, stated as a rule the build audit runs on every build.
 */
export function publicProvenanceProblems(record: PublicProvenance): string[] {
  const problems: string[] = [];

  if (record.source !== undefined)
    problems.push(
      "carries a source entity. Public deployment metadata records that " +
        "something came from WordPress, never which row it was: a served " +
        "artifact that lists the source site's primary keys describes the " +
        "install this site was migrated FROM, and nobody asked for that to be " +
        "public. The ids are kept in the internal provenance artifact.",
    );

  if (record.origin === "derived") {
    if (record.derived === undefined)
      problems.push('origin is "derived" but nothing says what derives it.');
    else if (record.derived.declaredBy === "")
      problems.push(
        'a derived entity names no configuration; "the code makes it" is not ' +
          "an answer a reader can act on.",
      );
  } else if (record.derived !== undefined) {
    problems.push(
      `origin is "${record.origin}" but a derived entity is recorded.`,
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// The invariants.
// ---------------------------------------------------------------------------

/**
 * Everything structurally wrong with one record, named.
 *
 * A runtime check and not only a type, because a manifest is JSON: it may have
 * been written by an older kit, a patched build, or an editor. Every rule here
 * is one the type states and JSON cannot.
 */
export function provenanceProblems(record: Provenance): string[] {
  const problems: string[] = [];
  const { origin } = record;

  if (origin === "wordpress") {
    const { source } = record;
    if (source === undefined)
      problems.push('origin is "wordpress" but no source entity is recorded.');
    else {
      if (!Number.isInteger(source.id) || source.id <= 0)
        problems.push(
          `source id ${JSON.stringify(source.id)} is not a WordPress primary ` +
            "key: those are positive integers, and a slug or a URL in this " +
            "field is the one thing a stable identity must not be.",
        );
      if (source.type === "")
        problems.push("source entity records no post type or taxonomy name.");
    }
  } else if (record.source !== undefined) {
    problems.push(
      `origin is "${origin}" but a source entity is recorded. Only a ` +
        '"wordpress" entity has a WordPress primary key; inventing one for ' +
        "anything else puts a number in the artifact that matches nothing.",
    );
  }

  if (origin === "derived") {
    if (record.derived === undefined)
      problems.push('origin is "derived" but nothing says what derives it.');
    else if (record.derived.declaredBy === "")
      problems.push(
        'a derived entity names no configuration; "the code makes it" is not ' +
          "an answer a reader can act on.",
      );
  } else if (record.derived !== undefined) {
    problems.push(`origin is "${origin}" but a derived entity is recorded.`);
  }

  return problems;
}

/**
 * Every source entity claimed by more than one local identity.
 *
 * The provenance form of the invariant `ownership.ts` states once: **identity
 * uniqueness must be checked at the earliest boundary that can observe the
 * complete set of competing entities.** Two entries claiming WordPress post 42
 * is not a duplicate slug and no other check in this kit sees it — the local
 * identities differ, the routes differ, the outputs differ, and one of the two
 * is nonetheless not the thing it says it is.
 *
 * Locale is part of the key, so post 123 in `en` and post 123 in `pt-BR` are
 * two claims and not a collision. That is the only sense in which a WordPress
 * id may legitimately repeat.
 */
export interface SourceClaimant {
  readonly provenance: Provenance;
  /** How to name the claimant in a report — a file path, or the local id. */
  readonly by?: string;
}

const claimsOf = (records: readonly SourceClaimant[]): Claimant[] => {
  const claims: Claimant[] = [];
  for (const record of records) {
    const { source } = record.provenance;
    if (source === undefined) continue;
    claims.push({
      key: sourceKey(source),
      by: record.by ?? record.provenance.local,
    });
  }
  return claims;
};

const contestedDetail = (key: string, by: readonly string[]): string =>
  `${by.length} entities claim the source entity "${key}": ${by.join(", ")}. ` +
  "One thing on the source site cannot be two things here. A WordPress id " +
  "is unique within its table, so this is a capture that copied a record " +
  "twice, or an id pasted onto the wrong entry — and neither slug, route " +
  "nor output uniqueness can see it, because all three differ.";

export function sourceIdentityIssues(
  records: readonly SourceClaimant[],
): ValidationIssue[] {
  return soleClaimant(
    claimsOf(records),
    "source-identity-contested",
    contestedDetail,
  );
}

/**
 * The same invariant, as data rather than as a message.
 *
 * The content contract wants a `ValidationIssue`; the integrity gate wants the
 * contested KEY as a report subject. Returning it twice in two shapes beats
 * either caller parsing a sentence back apart, which is what the first version
 * of this did.
 */
export function contestedSourceEntities(
  records: readonly SourceClaimant[],
): { key: string; by: readonly string[]; detail: string }[] {
  const byKey = new Map<string, string[]>();
  for (const claim of claimsOf(records)) {
    const existing = byKey.get(claim.key);
    if (existing === undefined) byKey.set(claim.key, [claim.by]);
    else existing.push(claim.by);
  }
  return [...byKey]
    .filter(([, by]) => by.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, by]) => {
      const sorted = [...by].sort();
      return { key, by: sorted, detail: contestedDetail(key, sorted) };
    });
}
