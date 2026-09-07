// What the source site publishes, against what this kit is configured to build.
//
// ## The case this exists for
//
// `wp/v2/types` reports `product`. `migration.config.ts` has no profile for it.
// The wrong answers are "0 custom types" and silence — both of which read as
// "there is nothing here", when what is true is "there is something here and
// nobody has decided about it yet".
//
// A decision waiting is not a gap in the tooling, and it is not a finished
// migration either. It gets its own verdict so it can be counted, reported and
// closed.
import type { PostType, Taxonomy } from "../content-capture/rest.ts";
import type {
  PostTypeProfile,
  TaxonomyProfile,
} from "../../migration.config.ts";

/** WordPress's own two content types, which the kit models directly. */
export const CORE_TYPES = ["post", "page"] as const;

/**
 * Types WordPress registers for its own machinery.
 *
 * Not content, never routed, and listing them as "unconfigured" would bury the
 * real answer under noise the reader has to learn to ignore. Named explicitly
 * rather than filtered by a `public` flag, because `wp/v2/types` reports these
 * whether or not a plugin has changed their visibility.
 */
export const INTERNAL_TYPES = [
  "attachment",
  "nav_menu_item",
  "wp_block",
  "wp_template",
  "wp_template_part",
  "wp_global_styles",
  "wp_navigation",
  "wp_font_family",
  "wp_font_face",
  "revision",
  "custom_css",
  "customize_changeset",
  "oembed_cache",
  "user_request",
  "patterns_ai_data",
] as const;

export type Capability =
  /** `post` or `page` — modelled by the kit directly. */
  | "core"
  /** A custom type with a profile that publishes it. */
  | "configured"
  /** A custom type with a profile that deliberately withholds it. */
  | "withheld"
  /** Discovered, no profile. A DECISION WAITING, not a gap and not nothing. */
  | "unconfigured"
  /** WordPress's own machinery. Not content. */
  | "internal";

export interface TypeCapability {
  readonly type: PostType;
  readonly capability: Capability;
  /** The profile's collection, when one exists. */
  readonly collection?: string;
  /** Taxonomies attached that this kit cannot route archives for. */
  readonly unroutableTaxonomies: readonly string[];
}

export function classifyTypes(
  types: readonly PostType[],
  profiles: readonly PostTypeProfile[],
): TypeCapability[] {
  const byName = new Map(profiles.map((profile) => [profile.name, profile]));
  const internal = new Set<string>(INTERNAL_TYPES);
  const core = new Set<string>(CORE_TYPES);

  return types.map((type) => {
    const profile = byName.get(type.name);
    const capability: Capability = core.has(type.name)
      ? "core"
      : profile !== undefined
        ? profile.published
          ? "configured"
          : "withheld"
        : internal.has(type.name)
          ? "internal"
          : "unconfigured";
    return {
      type,
      capability,
      ...(profile === undefined ? {} : { collection: profile.collection }),
      // Reported for every classification, because a CONFIGURED type with
      // taxonomies is the more dangerous case: the profile looks complete and
      // the taxonomy archives silently do not exist.
      unroutableTaxonomies:
        capability === "core"
          ? []
          : type.taxonomies.filter(
              (taxonomy) => taxonomy !== "category" && taxonomy !== "post_tag",
            ),
    };
  });
}

export function ofCapability(
  rows: readonly TypeCapability[],
  capability: Capability,
): TypeCapability[] {
  return rows.filter((row) => row.capability === capability);
}

// ---------------------------------------------------------------------------
// Taxonomies.
//
// The same five-way answer as post types, for the same reason: REST reports
// that `product_cat` exists, and says nothing about whether its terms should
// be public URLs, what prefix they live under, or whether that prefix carries
// ancestors. Measured — `wp/v2/taxonomies` returns name, slug, description,
// types, hierarchical, rest_base and rest_namespace, and no rewrite at all.

/** WordPress's own two, which the kit models without a profile. */
export const CORE_TAXONOMIES = ["category", "post_tag"] as const;

/** Taxonomies WordPress registers for its own machinery. */
export const INTERNAL_TAXONOMIES = [
  "nav_menu",
  "link_category",
  "post_format",
  "wp_theme",
  "wp_template_part_area",
  "wp_pattern_category",
] as const;

export interface TaxonomyCapability {
  readonly taxonomy: Taxonomy;
  readonly capability: Capability;
  readonly collection?: string;
  /**
   * Post types it is attached to that no profile publishes.
   *
   * The quiet failure this catches: a taxonomy configured and routed whose
   * types are not, so every term archive is empty and the profile looks fine.
   */
  readonly unroutableTypes: readonly string[];
}

export function classifyTaxonomies(
  taxonomies: readonly Taxonomy[],
  profiles: readonly TaxonomyProfile[],
  postTypes: readonly PostTypeProfile[],
): TaxonomyCapability[] {
  const byName = new Map(profiles.map((profile) => [profile.name, profile]));
  const internal = new Set<string>(INTERNAL_TAXONOMIES);
  const core = new Set<string>(CORE_TAXONOMIES);
  const publishedTypes = new Set(
    postTypes.filter((one) => one.published).map((one) => one.name),
  );

  return taxonomies.map((taxonomy) => {
    const profile = byName.get(taxonomy.name);
    const capability: Capability = core.has(taxonomy.name)
      ? "core"
      : profile !== undefined
        ? profile.published
          ? "configured"
          : "withheld"
        : internal.has(taxonomy.name)
          ? "internal"
          : "unconfigured";
    return {
      taxonomy,
      capability,
      ...(profile === undefined ? {} : { collection: profile.collection }),
      unroutableTypes:
        capability === "core" || capability === "internal"
          ? []
          : taxonomy.types.filter(
              (type) => type !== "post" && !publishedTypes.has(type),
            ),
    };
  });
}

export function taxonomiesOfCapability(
  rows: readonly TaxonomyCapability[],
  capability: Capability,
): TaxonomyCapability[] {
  return rows.filter((row) => row.capability === capability);
}
