// Deployment manifest: one JSON document describing what a build produced,
// emitted to `dist/deployment.json`. It exists so the question "is this build
// deployable, and is what got deployed what was built?" has an answer that
// does not require a host, a vendor API, or a person reading a directory.
//
// It is a DESCRIPTION, never a configuration. Nothing reads it to decide how
// to build or where to deploy.
import {
  MANIFEST_VERSION,
  PLACEHOLDER,
  PLACEHOLDER_TIMESTAMP,
  PREVIEW_ENVIRONMENT,
  PRODUCTION_ENVIRONMENT,
  buildMetadata,
  isBuildTimestamp,
  type BuildMetadata,
  type EnvironmentRecord,
} from "./build-metadata.ts";
import type { IntendedContent } from "./content-integrity.ts";
import { publicProvenanceProblems } from "../content-model/provenance.ts";
import {
  buildRouteInventory,
  countRoutes,
  duplicatePaths,
  type InventoryInput,
  type InventoryRoute,
  type RouteCounts,
} from "./route-inventory.ts";

/** One custom post type, as this build treated it. */
export interface PostTypeRecord {
  /** The WordPress type key. */
  readonly name: string;
  /** The content directory and Astro collection. */
  readonly collection: string;
  readonly published: boolean;
  readonly archive: "none" | "archive";
  /** Taxonomy names attached to the type; no archive is published for them. */
  readonly taxonomies: readonly string[];
}

/** One custom taxonomy, as this build treated it. */
export interface TaxonomyRecord {
  readonly name: string;
  readonly collection: string;
  readonly published: boolean;
  /** The post-type collections its terms file. */
  readonly appliesTo: readonly string[];
  /** Terms have parents. */
  readonly hierarchical: boolean;
  /** URLs carry those parents — WordPress's `rewrite['hierarchical']`. */
  readonly urlHierarchy: boolean;
}

/** What one collection contributed to the build. */
export interface CollectionSummary {
  readonly name: string;
  /** Entries (or registry rows) the collection holds, all locales. */
  readonly entries: number;
  /** Of those, how many became a page in this build. */
  readonly routed: number;
}

export interface DeploymentManifest {
  readonly manifestVersion: number;
  readonly generator: string;
  readonly build: BuildMetadata;
  readonly routes: RouteCounts & {
    readonly inventory: readonly InventoryRoute[];
  };
  readonly content: {
    readonly collections: readonly CollectionSummary[];
    readonly entries: number;
    /** The locale this build routed. One at a time, by design. */
    readonly locale: string;
    /**
     * Every identity `content/` intends to publish, in EVERY locale.
     *
     * The half the manifest never carried. Counts could say 280 entries became
     * 279 pages; only names can say WHICH one did not arrive, and a build that
     * drops one entry and invents another produces identical counts. An entry
     * this build does not route is listed here too — being named as intended
     * is what lets it be reported as withheld instead of vanishing.
     */
    readonly intended: readonly IntendedContent[];
    /**
     * Custom post types this build knows about, and how it treated each.
     *
     * Recorded in the ARTIFACT so `content:integrity` reads what the build
     * actually did rather than re-reading the configuration. A gate that reads
     * the same config the build read cannot notice the build ignoring it.
     */
    readonly postTypes: readonly PostTypeRecord[];
    /** Custom taxonomies this build knows about, and how it treated each. */
    readonly taxonomies: readonly TaxonomyRecord[];
  };
  /** The open hosting decision, stated in the artifact. */
  readonly hosting: {
    readonly decision: string;
    readonly adapter: null;
    readonly provider: null;
    readonly reference: string;
  };
}

export const GENERATOR = "wpk-website";

const HOSTING_UNDECIDED = {
  decision: "open",
  adapter: null,
  provider: null,
  reference:
    "Static output; no adapter is configured and no hosting provider is chosen by the kit. " +
    "See docs/04-implementation/launch-runbook.md §4 for what a host must do.",
} as const;

export interface ManifestInput extends InventoryInput {
  readonly collections: readonly CollectionSummary[];
  readonly intended: readonly IntendedContent[];
  readonly locale: string;
  readonly postTypes?: readonly PostTypeRecord[];
  readonly taxonomies?: readonly TaxonomyRecord[];
  readonly environment?: EnvironmentRecord;
}

/** Compose the manifest for one build. Every count is DERIVED from the inventory. */
export function buildManifest(input: ManifestInput): DeploymentManifest {
  const inventory = buildRouteInventory(input);

  const collisions = duplicatePaths(inventory);
  if (collisions.length > 0) {
    throw new Error(
      `Deployment manifest: ${collisions.length} path(s) claimed by more than ` +
        `one route — ${collisions.join(", ")}. Two routes cannot publish one ` +
        `URL; resolve the collision before the build emits a manifest that ` +
        `describes an impossible site.`,
    );
  }

  return {
    manifestVersion: MANIFEST_VERSION,
    generator: GENERATOR,
    build: buildMetadata(input.environment),
    routes: { ...countRoutes(inventory), inventory },
    content: {
      collections: [...input.collections].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      entries: input.collections.reduce(
        (sum, collection) => sum + collection.entries,
        0,
      ),
      locale: input.locale,
      // Sorted so two builds of one content tree serialise identically.
      intended: [...input.intended].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      postTypes: [...(input.postTypes ?? [])].sort((left, right) =>
        left.collection.localeCompare(right.collection),
      ),
      taxonomies: [...(input.taxonomies ?? [])].sort((left, right) =>
        left.collection.localeCompare(right.collection),
      ),
    },
    hosting: HOSTING_UNDECIDED,
  };
}

/** Deterministic serialization: two builds of one content tree are identical. */
export function serializeManifest(manifest: DeploymentManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Validation — reads a manifest back and returns everything wrong with it.
// ---------------------------------------------------------------------------

export interface ManifestProblem {
  readonly at: string;
  readonly detail: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ROUTE_KINDS = new Set(["page", "data", "redirect"]);
// Kept in step with `RouteOrigin` in route-inventory.ts by hand, deliberately:
// this validator reads a manifest that may have been written by a DIFFERENT
// version of the kit, so deriving the set from the current type would make it
// agree with itself and check nothing.
const ROUTE_ORIGINS = new Set([
  "static",
  "page",
  "post",
  "archive",
  "pagination",
  "custom",
  "custom-archive",
  "taxonomy-archive",
  "redirect",
]);

export function validateManifest(value: unknown): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  const problem = (at: string, detail: string): void => {
    problems.push({ at, detail });
  };

  if (!isObject(value)) {
    problem(
      "",
      `expected an object, got ${value === null ? "null" : typeof value}.`,
    );
    return problems;
  }

  if (value.manifestVersion !== MANIFEST_VERSION)
    problem(
      "manifestVersion",
      `expected ${MANIFEST_VERSION}, got ${JSON.stringify(value.manifestVersion)}.`,
    );

  if (value.generator !== GENERATOR)
    problem(
      "generator",
      `expected ${JSON.stringify(GENERATOR)}, got ${JSON.stringify(value.generator)}.`,
    );

  validateBuild(value.build, problem);
  validateRoutes(value.routes, problem);
  validateContent(value.content, problem);
  validateHosting(value.hosting, problem);

  return problems;
}

type Report = (at: string, detail: string) => void;

function validateBuild(build: unknown, problem: Report): void {
  if (!isObject(build)) {
    problem("build", "missing or not an object.");
    return;
  }

  if (
    build.environment !== PREVIEW_ENVIRONMENT &&
    build.environment !== PRODUCTION_ENVIRONMENT
  )
    problem(
      "build.environment",
      `expected "${PREVIEW_ENVIRONMENT}" or "${PRODUCTION_ENVIRONMENT}", got ${JSON.stringify(build.environment)}.`,
    );

  const { timestamp, timestampSource } = build;
  if (timestampSource !== "placeholder" && timestampSource !== "environment") {
    problem(
      "build.timestampSource",
      `expected "placeholder" or "environment", got ${JSON.stringify(timestampSource)}.`,
    );
  } else if (timestampSource === "placeholder") {
    if (timestamp !== PLACEHOLDER_TIMESTAMP)
      problem(
        "build.timestamp",
        `timestampSource is "placeholder" but the timestamp is ${JSON.stringify(timestamp)}.`,
      );
  } else if (typeof timestamp !== "string" || !isBuildTimestamp(timestamp)) {
    problem(
      "build.timestamp",
      `timestampSource is "environment" but ${JSON.stringify(timestamp)} is not an ISO 8601 UTC instant.`,
    );
  }

  const { revision, revisionSource } = build;
  if (revisionSource !== "placeholder" && revisionSource !== "environment") {
    problem(
      "build.revisionSource",
      `expected "placeholder" or "environment", got ${JSON.stringify(revisionSource)}.`,
    );
  } else if (revisionSource === "placeholder" && revision !== PLACEHOLDER) {
    problem(
      "build.revision",
      `revisionSource is "placeholder" but the revision is ${JSON.stringify(revision)}.`,
    );
  } else if (
    revisionSource === "environment" &&
    (typeof revision !== "string" || revision.trim() === "")
  ) {
    problem(
      "build.revision",
      'revisionSource is "environment" but no revision is recorded.',
    );
  }

  if (build.output !== "static")
    problem(
      "build.output",
      `expected "static", got ${JSON.stringify(build.output)}.`,
    );

  if (typeof build.outputDir !== "string" || build.outputDir === "")
    problem("build.outputDir", "missing or empty.");

  if (!("adapter" in build) || build.adapter !== null)
    problem(
      "build.adapter",
      `expected null, got ${JSON.stringify(build.adapter)}.`,
    );
  if (!("provider" in build) || build.provider !== null)
    problem(
      "build.provider",
      `expected null, got ${JSON.stringify(build.provider)}.`,
    );
}

function validateRoutes(
  routes: unknown,
  problem: Report,
): readonly InventoryRoute[] {
  if (!isObject(routes)) {
    problem("routes", "missing or not an object.");
    return [];
  }

  const { inventory } = routes;
  if (!Array.isArray(inventory)) {
    problem("routes.inventory", "missing or not an array.");
    return [];
  }

  const paths = new Set<string>();
  const valid: InventoryRoute[] = [];

  inventory.forEach((entry, index) => {
    const at = `routes.inventory[${index}]`;
    if (!isObject(entry)) {
      problem(at, "not an object.");
      return;
    }

    const { path, file, kind, origin, source } = entry;
    let sound = true;

    if (typeof path !== "string" || !path.startsWith("/")) {
      problem(
        `${at}.path`,
        `expected a root-relative path, got ${JSON.stringify(path)}.`,
      );
      sound = false;
    } else if (path !== "/" && path.endsWith("/")) {
      problem(
        `${at}.path`,
        `"${path}" has a trailing slash; the route model emits none.`,
      );
      sound = false;
    } else if (paths.has(path)) {
      problem(`${at}.path`, `"${path}" is claimed by more than one route.`);
      sound = false;
    } else {
      paths.add(path);
    }

    if (typeof file !== "string" || file === "" || file.startsWith("/")) {
      problem(
        `${at}.file`,
        `expected a dist-relative file, got ${JSON.stringify(file)}.`,
      );
      sound = false;
    } else if (file.includes("..")) {
      problem(`${at}.file`, `"${file}" escapes the output directory.`);
      sound = false;
    }

    if (typeof kind !== "string" || !ROUTE_KINDS.has(kind)) {
      problem(
        `${at}.kind`,
        `expected "page", "data" or "redirect", got ${JSON.stringify(kind)}.`,
      );
      sound = false;
    }

    if (typeof origin !== "string" || !ROUTE_ORIGINS.has(origin)) {
      problem(
        `${at}.origin`,
        `expected one of ${[...ROUTE_ORIGINS].join(" · ")}, got ${JSON.stringify(origin)}.`,
      );
      sound = false;
    }

    if (typeof source !== "string" || source === "") {
      problem(
        `${at}.source`,
        "missing: every route names the module that generates it.",
      );
      sound = false;
    }

    if (sound) valid.push(entry as unknown as InventoryRoute);
  });

  const expected = countRoutes(valid);
  if (inventory.length === valid.length) {
    if (routes.total !== expected.total)
      problem(
        "routes.total",
        `says ${JSON.stringify(routes.total)} but the inventory holds ${expected.total}.`,
      );
    if (routes.pages !== expected.pages)
      problem(
        "routes.pages",
        `says ${JSON.stringify(routes.pages)} but the inventory holds ${expected.pages}.`,
      );
    if (routes.data !== expected.data)
      problem(
        "routes.data",
        `says ${JSON.stringify(routes.data)} but the inventory holds ${expected.data}.`,
      );
  }

  if (expected.pages === 0)
    problem(
      "routes.inventory",
      "no page route is listed. A deployment with nothing to serve is not a deployment.",
    );

  return valid;
}

function validateContent(content: unknown, problem: Report): void {
  if (!isObject(content)) {
    problem("content", "missing or not an object.");
    return;
  }

  const { collections } = content;
  if (!Array.isArray(collections)) {
    problem("content.collections", "missing or not an array.");
    return;
  }

  let total = 0;
  const names = new Set<string>();
  collections.forEach((collection, index) => {
    const at = `content.collections[${index}]`;
    if (!isObject(collection)) {
      problem(at, "not an object.");
      return;
    }
    const { name, entries, routed } = collection;
    if (typeof name !== "string" || name === "") {
      problem(
        `${at}.name`,
        `expected a collection name, got ${JSON.stringify(name)}.`,
      );
    } else if (names.has(name)) {
      problem(`${at}.name`, `"${name}" is listed twice.`);
    } else {
      names.add(name);
    }
    if (
      typeof entries !== "number" ||
      !Number.isInteger(entries) ||
      entries < 0
    ) {
      problem(
        `${at}.entries`,
        `expected a non-negative integer, got ${JSON.stringify(entries)}.`,
      );
      return;
    }
    if (typeof routed !== "number" || !Number.isInteger(routed) || routed < 0) {
      problem(
        `${at}.routed`,
        `expected a non-negative integer, got ${JSON.stringify(routed)}.`,
      );
      return;
    }
    if (routed > entries)
      problem(
        `${at}.routed`,
        `${routed} of ${entries} entries routed — a collection cannot publish more pages than it has entries.`,
      );
    total += entries;
  });

  if (content.entries !== total)
    problem(
      "content.entries",
      `says ${JSON.stringify(content.entries)} but the collections sum to ${total}.`,
    );

  validateIntended(content.intended, problem);
}

/**
 * Every intended entity, the origin each one states, and the source ids none
 * of them may carry.
 *
 * Checked here as well as in `content:integrity` on purpose: this validator
 * runs inside `render:build-audit`, over a manifest that may have been written
 * by a different version of the kit, and a manifest whose rows cannot say
 * where they came from is not a manifest anything can trace a migration
 * through. The TypeScript type requires `provenance`; JSON cannot, so this
 * does.
 *
 * It is also where the exposure rule is ENFORCED rather than documented. The
 * manifest is a served route, so a source entity appearing in one of these
 * rows is a leak — and because this runs on every build, a future change that
 * reintroduces one fails the build audit instead of being noticed by whoever
 * reads the artifact next.
 */
function validateIntended(intended: unknown, problem: Report): void {
  if (intended === undefined) return;
  if (!Array.isArray(intended)) {
    problem("content.intended", "present but not an array.");
    return;
  }
  intended.forEach((row, index) => {
    const at = `content.intended[${index}]`;
    if (!isObject(row)) {
      problem(at, "not an object.");
      return;
    }
    if (typeof row.id !== "string" || row.id === "") {
      problem(
        `${at}.id`,
        `expected a content identity, got ${JSON.stringify(row.id)}.`,
      );
      return;
    }
    const { provenance } = row;
    if (!isObject(provenance)) {
      problem(
        `${at}.provenance`,
        `"${row.id}" states no origin. Every intended entity records where it ` +
          "came from — `wordpress` with a source entity, or `authored`, " +
          "`sample` or `derived` saying plainly that there is none.",
      );
      return;
    }
    for (const detail of publicProvenanceProblems(
      provenance as unknown as Parameters<typeof publicProvenanceProblems>[0],
    ))
      problem(`${at}.provenance`, `"${row.id}": ${detail}`);
  });
}

function validateHosting(hosting: unknown, problem: Report): void {
  if (!isObject(hosting)) {
    problem("hosting", "missing or not an object.");
    return;
  }
  if (hosting.decision !== "open")
    problem(
      "hosting.decision",
      `expected "open", got ${JSON.stringify(hosting.decision)}.`,
    );
  if (!("adapter" in hosting) || hosting.adapter !== null)
    problem(
      "hosting.adapter",
      `expected null, got ${JSON.stringify(hosting.adapter)}.`,
    );
  if (!("provider" in hosting) || hosting.provider !== null)
    problem(
      "hosting.provider",
      `expected null, got ${JSON.stringify(hosting.provider)}.`,
    );
  if (typeof hosting.reference !== "string" || hosting.reference === "")
    problem(
      "hosting.reference",
      "missing: an open decision names where it is recorded.",
    );
}
