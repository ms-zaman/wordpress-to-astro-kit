// One entity, one identity, one owner — checked where both are still visible.
//
// ## The pattern this exists for
//
// Three defects in this kit turned out to be one shape:
//
//   1. Astro's `glob()` loader derived an entry id from front-matter `slug`,
//      and two translations sharing a slug — which the content contract
//      REQUIRES — collided. One was never loaded.
//   2. A post-type profile was deleted and its `content/<collection>/`
//      directory stayed behind. Nothing loaded it, so nothing could report it
//      missing.
//   3. Astro's `file()` loader keyed registry rows by `slug`, and two terms
//      with slug `laptops` collapsed to one. The route for the first vanished,
//      the manifest listed one term, intended and emitted agreed, and
//      `content:integrity` reported zero findings.
//
// And a fourth, found while writing this module: two `en` pages with slug
// `home`, one of them the configured front page. The build succeeded, the
// second file silently rendered at `/`, the manifest listed `pages/home@en`
// TWICE, and the integrity gate exited 0 — because it joins through a `Map`
// and a `Set`, and both of those deduplicate. Two entities, one identity,
// every gate agreeing with itself.
//
// ## The invariant
//
// > Identity uniqueness must be checked at the earliest boundary that can
// > observe the complete set of competing entities.
//
// A downstream gate cannot detect an entity that was already lost upstream. By
// the time a loader has produced a collection, the losing entry is not late —
// it is gone, and nothing downstream can tell the difference between "one
// entity" and "two that collapsed".
//
// For content, that earliest boundary is the FILESYSTEM: the content contract
// reads every file itself, so it is the only layer that sees both sides of a
// collision. For routes it is the resolver, which sees every claim before any
// page exists. For outputs it is the build audit, which sees the manifest and
// `dist/` together.
//
// ## What this module is not
//
// It is not a framework. It is two functions and a table, because the
// invariant is small and stating it once is the whole point — three of the
// four defects above were the same three lines of code written in three
// places, each one deduplicating without saying so.
import type { ValidationIssue } from "./cross-entry.ts";

/** One thing competing for an identity, with enough to name it in a report. */
export interface Claimant {
  /** The identity being claimed. */
  readonly key: string;
  /** Where the claim comes from — a file path, a profile name, a route. */
  readonly by: string;
}

/**
 * Every identity claimed by more than one thing.
 *
 * The general invariant, written once. Returns an issue per contested
 * identity, naming EVERY claimant rather than just the collision — a report
 * that says "duplicate" without saying which two files leaves the reader to
 * grep for it, and the whole failure mode here is things that are hard to see.
 *
 * `code` is the caller's, because "two pages share a slug" and "two profiles
 * claim a collection" are different problems with the same shape and a reader
 * should not have to work out which one they have.
 */
export function soleClaimant(
  claims: readonly Claimant[],
  code: ValidationIssue["code"],
  describe: (key: string, by: readonly string[]) => string,
): ValidationIssue[] {
  const byKey = new Map<string, string[]>();
  for (const claim of claims) {
    const existing = byKey.get(claim.key);
    if (existing === undefined) byKey.set(claim.key, [claim.by]);
    else existing.push(claim.by);
  }
  const issues: ValidationIssue[] = [];
  for (const [key, by] of [...byKey].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
    if (by.length > 1) issues.push({ code, message: describe(key, by.sort()) });
  return issues;
}

/**
 * Who owns each content collection.
 *
 * A collection is a directory or a registry file, and exactly one thing may
 * own it: the kit's own content model, a post-type profile, or a taxonomy
 * profile. Two owners is not a preference to resolve — `content.config.ts`
 * builds its collections with an object spread, so the later one silently
 * replaces the earlier and one whole content set stops existing.
 *
 * Measured before this check: pointing a taxonomy's `collection` at a post
 * type's directory failed only by accident, with an `ENOENT` looking for a
 * registry file. Had that file existed, the post type's entries would have
 * been replaced without a word.
 */
export const CORE_COLLECTIONS = [
  "pages",
  "posts",
  "authors",
  "categories",
  "tags",
  "navigation",
  "seo",
  "config",
] as const;

export interface OwnershipInput {
  readonly postTypes: readonly { name: string; collection: string }[];
  readonly taxonomies: readonly { name: string; collection: string }[];
}

export function collectionOwnershipIssues(
  input: OwnershipInput,
): ValidationIssue[] {
  const claims: Claimant[] = [
    ...CORE_COLLECTIONS.map((collection) => ({
      key: collection,
      by: "the kit's own content model",
    })),
    ...input.postTypes.map((profile) => ({
      key: profile.collection,
      by: `postTypes["${profile.name}"]`,
    })),
    ...input.taxonomies.map((profile) => ({
      key: profile.collection,
      by: `taxonomies["${profile.name}"]`,
    })),
  ];

  return soleClaimant(
    claims,
    "collection-ownership-contested",
    (collection, by) =>
      `Collection "${collection}" is claimed by ${by.length} owners: ` +
      `${by.join(", ")}. content.config.ts composes its collections with an ` +
      `object spread, so the later claim silently replaces the earlier one and ` +
      `a whole content set stops existing. Give each owner its own collection.`,
  );
}

/**
 * Every content identity claimed by more than one file.
 *
 * `(collection, slug, locale)` — the identity the manifest and the integrity
 * gate join on. Two files producing one of these is the fourth defect in the
 * header, and it is invisible everywhere downstream: the loader keeps one, the
 * resolver routes one, and the gate's `Map` and `Set` deduplicate the rest.
 */
export function entryIdentityIssues(
  entries: readonly {
    collection: string;
    slug: string;
    locale: string;
    file?: string;
  }[],
): ValidationIssue[] {
  return soleClaimant(
    entries.map((entry) => ({
      key: `${entry.collection}/${entry.slug}@${entry.locale}`,
      by: entry.file ?? `${entry.collection}/${entry.slug}`,
    })),
    "entry-identity-contested",
    (identity, by) =>
      `${by.length} files produce the content identity "${identity}": ` +
      `${by.join(", ")}. One of them will be loaded and the rest will not — ` +
      `and nothing downstream can tell that apart from there only ever having ` +
      `been one. A slug is unique per locale within its collection.`,
  );
}
