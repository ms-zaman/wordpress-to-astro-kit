// What a migrated asset IS, and which of six things this build can do with it.
//
// ## The state this replaces
//
// Measured before writing any of it, the kit had a media SEAM and no media
// pipeline: `rendering/media.ts` rewrites the ORIGIN of a preserved upload
// reference at render time and nothing fetches, copies or verifies a byte. It
// worked, and it means a migrated site cannot be served without the WordPress
// install still answering for its own uploads.
//
// It also had **two uncoordinated definitions of "the uploads namespace"**:
//
//     rendering/media.ts     /wp-content/uploads/[^ \t\r\n\f\v"'<>]*   query allowed
//     content-model/shared   /wp-content/uploads/[^?#]+                query REFUSED
//
// so a body could carry `…/x.png?ver=2` happily while a `featuredImage` with
// the same URL failed validation. This module is the one definition; both of
// those now describe the same thing.
//
// ## Four identities, and they are not the same string
//
//     source identity      https://old.example.com/wp-content/uploads/2026/01/a.png?ver=2
//                          exactly what the migrated markup says, byte for byte
//     normalized identity  uploads:2026/01/a.png
//                          the FILE, with host, scheme and www stripped
//     local identity       /media/2026/01/a.png
//                          the URL this site serves it at
//     output identity      apps/website/public/media/2026/01/a.png
//                          the file on disk that produces it
//
// The normalized identity is what makes "the same asset referenced fifteen
// times" one owned asset, and it deliberately keeps the uploads directory
// structure rather than hashing: WordPress puts `2026/01/a.png` and
// `2026/02/a.png` in different months, two genuinely different files that
// share a name, and flattening or hashing would either collide them or make
// the output unreadable. There is no hash anywhere here, on purpose.
//
// ## Six classifications, and none of them is a warning
//
// A migration either moves an asset or says why it did not. `UNSUPPORTED` and
// `EXTERNAL` are answers; `MISSING` and `CONFLICT` are failures. Nothing
// returns "probably fine".
import type { MediaProfile } from "../../../../migration.config.ts";

/** What this build can do with one referenced asset. */
export type AssetClass =
  /** In the uploads namespace, on a host the profile migrates. Copy it. */
  | "SUPPORTED"
  /**
   * Outside the uploads namespace but on a host the profile declares
   * migratable — a plugin that served files from its own directory, say.
   * Configuration decided this, not a guess.
   */
  | "CONFIGURED"
  /** A real remote asset, deliberately left where it is. */
  | "EXTERNAL"
  /**
   * A reference this engine will not act on, and says so: a `data:` URI, a
   * `mailto:`, a protocol-relative URL whose host it cannot resolve, a
   * fragment. Never silently rewritten.
   */
  | "UNSUPPORTED"
  /** Claimed by a reference and absent from the captured set. A failure. */
  | "MISSING"
  /** Two different source assets resolving to one local output. A failure. */
  | "CONFLICT";

/** One asset, as a reference names it and as this build will serve it. */
export interface AssetIdentity {
  /** Exactly what the markup said. Never modified, so a report can quote it. */
  readonly source: string;
  readonly classification: AssetClass;
  /**
   * `uploads:2026/01/a.png` — the FILE, independent of host, scheme, `www.`
   * and (where measured safe) query. The key two references de-duplicate on.
   */
  readonly key?: string;
  /** The path this site will serve it at, for a class that is migrated. */
  readonly local?: string;
  /**
   * Which namespace it was found in.
   *
   * `SUPPORTED` covers two genuinely different cases and a caller sometimes
   * needs to tell them apart: a file still in the SOURCE's uploads path, and
   * one already at this site's own output path. The media-origin strategy
   * re-hosts the first and must leave the second alone.
   */
  readonly namespace?: "uploads" | "extra" | "output";
  /**
   * The root-relative source path, with any host removed.
   *
   * `/wp-content/uploads/2026/01/a.png` for every spelling of it. What the
   * origin strategy prefixes a host onto, so that it does not need a namespace
   * regex of its own.
   */
  readonly path?: string;
  /**
   * The host the reference named, or `""` for a root-relative one.
   *
   * Returned rather than re-parsed by callers: the conflict check needs it,
   * and a second `new URL()` somewhere else is a second place for the `www.`
   * and scheme rules to drift.
   */
  readonly host?: string;
  /** The query string, kept because it may be meaningful. */
  readonly query?: string;
  readonly fragment?: string;
  /** Why, for a class a person has to act on. */
  readonly reason?: string;
}

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, "");

/** `https://www.x.com` and `http://x.com` are one host. */
export function hostKey(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/**
 * Split a reference into path, query and fragment without decoding anything.
 *
 * Decoding would be a normalisation nobody asked for: `%20` and a literal
 * space are different bytes in a URL and WordPress serves the encoded form, so
 * re-encoding a decoded path can produce a URL the source never had. The parts
 * are separated and left exactly as written.
 */
export function splitReference(raw: string): {
  path: string;
  query: string;
  fragment: string;
} {
  const hash = raw.indexOf("#");
  const fragment = hash === -1 ? "" : raw.slice(hash);
  const withoutHash = hash === -1 ? raw : raw.slice(0, hash);
  const mark = withoutHash.indexOf("?");
  return {
    path: mark === -1 ? withoutHash : withoutHash.slice(0, mark),
    query: mark === -1 ? "" : withoutHash.slice(mark),
    fragment,
  };
}

/**
 * Classify and name one reference.
 *
 * Pure, and takes the profile rather than reading it, so a test can state a
 * site the kit's own configuration does not describe.
 */
export function identifyAsset(
  raw: string,
  profile: MediaProfile,
): AssetIdentity {
  const reference = raw.trim();
  if (reference === "")
    return {
      source: raw,
      classification: "UNSUPPORTED",
      reason: "empty reference",
    };

  // A fragment, a data URI, or any scheme that is not http(s). None of these
  // names a file this engine could fetch, and rewriting one would be a guess.
  if (reference.startsWith("#"))
    return {
      source: raw,
      classification: "UNSUPPORTED",
      reason: "a fragment, not an asset",
    };
  if (/^(?!https?:)[a-z][a-z0-9+.-]*:/i.test(reference))
    return {
      source: raw,
      classification: "UNSUPPORTED",
      reason: `the "${reference.slice(0, reference.indexOf(":"))}:" scheme is not a file this engine can migrate`,
    };

  const { path, query, fragment } = splitReference(reference);
  const uploads = `/${trimSlashes(profile.uploadsPath)}/`;
  const migratable = new Set(profile.migrateFrom.map(hostKey));

  /** Build the answer for a path that is inside a migratable namespace. */
  const owned = (
    absolutePath: string,
    classification: "SUPPORTED" | "CONFIGURED",
    namespace: string,
    which: "uploads" | "extra" | "output",
    host = "",
  ): AssetIdentity => {
    const relative = absolutePath.slice(namespace.length);
    if (relative === "" || relative.endsWith("/"))
      return {
        source: raw,
        classification: "UNSUPPORTED",
        reason: "names a directory, not a file",
      };
    // `..` would let a source reference write outside the output directory.
    if (relative.split("/").includes(".."))
      return {
        source: raw,
        classification: "UNSUPPORTED",
        reason: "the path escapes the uploads directory",
      };
    return {
      source: raw,
      classification,
      key: `uploads:${relative}`,
      local: `/${trimSlashes(profile.localBase)}/${relative}`,
      namespace: which,
      path: absolutePath,
      host,
      ...(query === "" ? {} : { query }),
      ...(fragment === "" ? {} : { fragment }),
    };
  };

  // Protocol-relative. Measured as a real gap: `rendering/media.ts` does not
  // recognise `//host/wp-content/uploads/…` at all, while four other modules in
  // this kit do handle the form — so it passed through unrewritten and absent
  // from every manifest. The host is knowable here, so it is resolved.
  const absolute = path.startsWith("//")
    ? `https:${path}`
    : /^https?:\/\//i.test(path)
      ? path
      : undefined;

  if (absolute !== undefined) {
    let url: URL;
    try {
      url = new URL(absolute);
    } catch {
      return {
        source: raw,
        classification: "UNSUPPORTED",
        reason: "not a parseable URL",
      };
    }
    if (!migratable.has(hostKey(url.host)))
      return {
        source: raw,
        classification: "EXTERNAL",
        host: hostKey(url.host),
        path: url.pathname,
        ...(query === "" ? {} : { query }),
        ...(fragment === "" ? {} : { fragment }),
        reason: `${url.host} is not in media.migrateFrom, so the reference is left as it is`,
      };
    const named = hostKey(url.host);
    if (url.pathname.startsWith(uploads))
      return owned(url.pathname, "SUPPORTED", uploads, "uploads", named);
    for (const extra of profile.extraPaths) {
      const namespace = `/${trimSlashes(extra)}/`;
      if (url.pathname.startsWith(namespace))
        return owned(url.pathname, "CONFIGURED", namespace, "extra", named);
    }
    const localNamespace = `/${trimSlashes(profile.localBase)}/`;
    if (url.pathname.startsWith(localNamespace))
      return owned(url.pathname, "SUPPORTED", localNamespace, "output", named);
    return {
      source: raw,
      classification: "EXTERNAL",
      host: hostKey(url.host),
      path: url.pathname,
      reason:
        `${url.host} is migratable but ${url.pathname} is outside ` +
        `media.uploadsPath and media.extraPaths`,
    };
  }

  // Root-relative. The site's own namespace, whatever host served it.
  if (path.startsWith("/")) {
    if (path.startsWith(uploads))
      return owned(path, "SUPPORTED", uploads, "uploads");
    for (const extra of profile.extraPaths) {
      const namespace = `/${trimSlashes(extra)}/`;
      if (path.startsWith(namespace))
        return owned(path, "CONFIGURED", namespace, "extra");
    }
    // Already at the output path. A reference that has been migrated already —
    // or an asset committed to `public/` by hand, like the kit's own sample —
    // is not "unsupported": it is a file this site owns and must therefore
    // still be there. Recognising it is what lets `verify` check it.
    const local = `/${trimSlashes(profile.localBase)}/`;
    if (path.startsWith(local))
      return owned(path, "SUPPORTED", local, "output");
    return {
      source: raw,
      classification: "UNSUPPORTED",
      reason: "a local path outside every migratable namespace",
    };
  }

  // A document-relative reference. It resolves against the page it is on, and
  // this engine sees references without their pages — so it refuses rather
  // than assuming a base.
  return {
    source: raw,
    classification: "UNSUPPORTED",
    reason:
      "a document-relative reference; this engine sees references without " +
      "the page they are on, so the file it names cannot be determined",
  };
}

/** The asset classes this engine migrates. */
export const MIGRATED_CLASSES: readonly AssetClass[] = [
  "SUPPORTED",
  "CONFIGURED",
];

export function isMigrated(identity: AssetIdentity): boolean {
  return MIGRATED_CLASSES.includes(identity.classification);
}

/**
 * The file one asset is stored at, relative to the static directory.
 *
 * Deterministic and structure-preserving: `uploads:2026/01/a.png` becomes
 * `media/2026/01/a.png`. Two assets sharing a filename in different months
 * stay two files, which flattening would not, and there is no hash — a hashed
 * name would make the output unreadable and would not prevent a collision, it
 * would only rename it.
 */
export function outputFileFor(
  identity: AssetIdentity,
  profile: MediaProfile,
): string | undefined {
  if (identity.key === undefined) return undefined;
  return `${trimSlashes(profile.localBase)}/${identity.key.slice("uploads:".length)}`;
}
