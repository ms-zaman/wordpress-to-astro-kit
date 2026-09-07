// Build metadata: what a deployment manifest can honestly say about the build
// that produced it.
//
// Three properties are deliberate:
//
//   1. Placeholders, not invention. A real `Date.now()` would make every build
//      differ from the last one for no content reason, so the default IS a
//      placeholder and it says so in a sibling field. A deploy pipeline that
//      wants a real instant supplies one through the environment.
//   2. A closed environment allowlist. `readEnvironment` reads exactly the
//      keys in `DEPLOYMENT_ENV_KEYS`. A manifest is a public build artifact —
//      it is served at `/deployment.json` — so "do not put secrets in it" is
//      enforced by construction.
//   3. The environment is the launch switch's answer, recorded.
//
// Pure: a function of a plain env record.
import { siteEnvironment } from "./site-environment.ts";

export const MANIFEST_VERSION = 1;

/**
 * The stand-in for a build instant nobody has supplied. Deliberately NOT a
 * parseable date: `1970-01-01T00:00:00Z` would be accepted by every date
 * library and silently reported as "built in 1970".
 */
export const PLACEHOLDER_TIMESTAMP = "0000-00-00T00:00:00Z";

/** The stand-in for any other unsupplied scalar. */
export const PLACEHOLDER = "unset";

export const PREVIEW_ENVIRONMENT = "preview";
export const PRODUCTION_ENVIRONMENT = "production";

/** Every environment variable the manifest may read, and no others. */
export const DEPLOYMENT_ENV_KEYS = [
  "WPK_BUILD_TIMESTAMP",
  "WPK_BUILD_REVISION",
  "WPK_SITE_ENV",
] as const;

export type DeploymentEnvKey = (typeof DEPLOYMENT_ENV_KEYS)[number];

export type ValueSource = "placeholder" | "environment";

export interface BuildMetadata {
  /** `preview` or `production` — the launch switch, recorded. */
  readonly environment: string;
  /** ISO 8601 UTC, or `PLACEHOLDER_TIMESTAMP`. */
  readonly timestamp: string;
  readonly timestampSource: ValueSource;
  /** Commit-ish, or `PLACEHOLDER`. Never derived by shelling out to git. */
  readonly revision: string;
  readonly revisionSource: ValueSource;
  readonly output: string;
  readonly outputDir: string;
  /** `null` in both cases: no adapter is installed and no host is chosen. */
  readonly adapter: null;
  readonly provider: null;
}

export type EnvironmentRecord = Readonly<
  Partial<Record<DeploymentEnvKey, string | undefined>>
>;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function isBuildTimestamp(value: string): boolean {
  return ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
};

/** Read the closed key set out of a full environment record. */
export function readEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): EnvironmentRecord {
  const out: Record<string, string | undefined> = {};
  for (const key of DEPLOYMENT_ENV_KEYS) {
    const value = trimmed(source[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Build metadata for one build. Throws on a supplied-but-malformed value: a
 * pipeline that exports the timestamp in the wrong format has a bug, and
 * silently substituting a placeholder would hide it in the one artifact whose
 * job is to report the truth about the build.
 */
export function buildMetadata(
  environment: EnvironmentRecord = {},
  options: { readonly outputDir?: string } = {},
): BuildMetadata {
  const declared = siteEnvironment(environment);

  const suppliedTimestamp = environment.WPK_BUILD_TIMESTAMP;
  if (suppliedTimestamp !== undefined && !isBuildTimestamp(suppliedTimestamp)) {
    throw new Error(
      `Deployment manifest: WPK_BUILD_TIMESTAMP is "${suppliedTimestamp}", ` +
        `which is not an ISO 8601 UTC instant (YYYY-MM-DDTHH:MM:SSZ). Leave ` +
        `it unset to get the placeholder ${PLACEHOLDER_TIMESTAMP}.`,
    );
  }

  const suppliedRevision = environment.WPK_BUILD_REVISION;

  return {
    environment: declared,
    timestamp: suppliedTimestamp ?? PLACEHOLDER_TIMESTAMP,
    timestampSource:
      suppliedTimestamp === undefined ? "placeholder" : "environment",
    revision: suppliedRevision ?? PLACEHOLDER,
    revisionSource:
      suppliedRevision === undefined ? "placeholder" : "environment",
    output: "static",
    outputDir: options.outputDir ?? "dist",
    adapter: null,
    provider: null,
  };
}

export function isPlaceholderBuild(metadata: BuildMetadata): boolean {
  return metadata.timestampSource === "placeholder";
}
