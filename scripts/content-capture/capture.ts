// Capturing a WordPress post type to evidence.
//
// **This writes evidence and nothing else.** One JSON artifact under
// `research/`, no content file touched. The transform that turns a capture
// into content entries is a separate step for the reason PLAYBOOK.md §5 gives:
// fetch and interpretation should be reviewable apart, because when a body
// comes out wrong you need to know which of the two did it.
//
// Nothing here writes to the source site. Every request is a GET against a
// public endpoint and no credential is ever sent.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { migration } from "../../migration.config.ts";
import { PoliteReader, settingsFromConfig } from "../site-map-audit/fetch.ts";
import { bodyReport, type BodyReport } from "./bodies.ts";
import { WordPressRest, type PostType, type Taxonomy } from "./rest.ts";

/**
 * The fields a capture asks for, by name.
 *
 * Named rather than defaulted, so the artifact's shape is a decision somebody
 * made and a field that stops being returned is visible in one place. See
 * `rest.ts` on why nested selection is not used.
 */
export const ENTRY_FIELDS = [
  "id",
  "slug",
  "date",
  "modified",
  "link",
  "status",
  "title",
  "content",
  "excerpt",
  "author",
  "featured_media",
  /**
   * The page hierarchy, and the taxonomy assignments.
   *
   * `parent` is how WordPress nests pages. `categories` and `tags` are the
   * REST field names for the two core taxonomies — a custom taxonomy appears
   * under its own `rest_base`, which `captureType` appends from the type's own
   * declaration rather than guessing.
   *
   * Their absence was a silent, total loss: the capture recorded the taxonomy
   * REGISTRIES faithfully and not one entry's membership in them, so every
   * post looked uncategorised and a transform could not migrate a single
   * taxonomy relationship. `_fields` had simply never listed them.
   */
  "parent",
  "categories",
  "tags",
] as const;

export const TERM_FIELDS = [
  "id",
  "slug",
  "name",
  "description",
  "parent",
  "count",
] as const;

export interface CapturedEntry {
  readonly id: number;
  readonly slug: string;
  readonly date: string;
  readonly modified: string;
  readonly link: string;
  readonly status?: string;
  readonly title?: { rendered?: string };
  readonly content?: { rendered?: string; protected?: boolean };
  readonly excerpt?: { rendered?: string };
  readonly author?: number;
  readonly featured_media?: number;
  /** The parent page's id, for a hierarchical type. */
  readonly parent?: number;
  /** Core taxonomy assignments, as WordPress names them in REST. */
  readonly categories?: readonly number[];
  readonly tags?: readonly number[];
  /** Every taxonomy's term ids, keyed by taxonomy name. */
  readonly terms?: Readonly<Record<string, readonly number[]>>;
  /**
   * The rendered page, fetched because the REST body looked incomplete.
   *
   * Stored verbatim and NOT interpreted here. Turning a rendered page into an
   * article body is a reduction with judgement in it, and this file's job is
   * to have the evidence, not to decide what it means.
   */
  readonly renderedPage?: { url: string; status: number; html?: string };
}

export interface CaptureResult {
  readonly origin: string;
  readonly type: string;
  readonly restBase: string;
  readonly capturedAt: string;
  readonly requests: number;
  /** What `x-wp-total` said, against what arrived. */
  readonly declaredTotal: number | null;
  readonly received: number;
  readonly entries: readonly CapturedEntry[];
  readonly taxonomies: Readonly<
    Record<string, readonly Record<string, unknown>[]>
  >;
  readonly media: readonly {
    id: number;
    sourceUrl?: string;
    alt?: string;
    status: number;
  }[];
  readonly bodies: BodyReport;
  readonly notes: readonly string[];
}

export interface CaptureOptions {
  /** The post type's REST base, e.g. `posts`, `pages`, `docs`. */
  readonly restBase: string;
  /** The type key, for the artifact's name. */
  readonly type: string;
  /** Stop after this many entries. A sample, for a first look. */
  readonly limit?: number;
  /** Taxonomies to capture alongside, from `wp/v2/taxonomies`. */
  readonly taxonomies?: readonly Taxonomy[];
  /** Resolve `featured_media` ids to their URLs. One request each. */
  readonly withMedia?: boolean;
  /** REST bases of the taxonomies attached to this type, for `_fields`. */
  readonly taxonomyRestBases?: readonly string[];
  /** Fetch the rendered page for every entry whose body looks incomplete. */
  readonly withIncompletePages?: boolean;
  readonly onProgress?: (line: string) => void;
}

/**
 * Capture one post type.
 *
 * Total: a refused route, a missing media row and an unreachable page are all
 * RECORDED. The one thing this must never do is return a shorter corpus than
 * the site has and say nothing, so `declaredTotal` travels beside `received`
 * and the CLI compares them out loud.
 */
export async function capturePostType(
  options: CaptureOptions,
  reader: PoliteReader = new PoliteReader(settingsFromConfig()),
): Promise<CaptureResult> {
  const rest = new WordPressRest(reader);
  const progress = options.onProgress ?? (() => {});
  const notes: string[] = [];

  progress(`reading ${options.restBase}`);
  // A custom taxonomy's assignments arrive under its own REST base, which only
  // the type itself can name. Requesting a field a type does not have is
  // harmless — WordPress omits it — so this is additive, never a guess.
  const entryFields = [
    ...ENTRY_FIELDS,
    ...(options.taxonomyRestBases ?? []).filter(
      (base) => !ENTRY_FIELDS.includes(base as (typeof ENTRY_FIELDS)[number]),
    ),
  ];

  const { items, declaredTotal } = await rest.collection<CapturedEntry>(
    options.restBase,
    entryFields,
    {
      limit: options.limit,
      onPage: (page, of) =>
        progress(`  ${options.restBase} page ${page} of ${of}`),
    },
  );

  if (
    declaredTotal !== null &&
    options.limit === undefined &&
    items.length !== declaredTotal
  )
    notes.push(
      `x-wp-total said ${declaredTotal} and ${items.length} arrived. A capture that is ` +
        "shorter than the site and says nothing is the failure this note exists for: " +
        "check for a refusal in the middle of the paging before trusting this artifact.",
    );

  // --- taxonomies ------------------------------------------------------------
  const taxonomies: Record<string, Record<string, unknown>[]> = {};
  for (const taxonomy of options.taxonomies ?? []) {
    progress(`reading ${taxonomy.restBase}`);
    const { items: terms } = await rest.collection<Record<string, unknown>>(
      taxonomy.restBase,
      TERM_FIELDS,
    );
    taxonomies[taxonomy.name] = terms;
  }

  // --- which bodies are probably not the whole article -----------------------
  const bodies = bodyReport(
    items.map((entry) => ({
      id: entry.id,
      slug: entry.slug,
      html: entry.content?.rendered ?? "",
    })),
  );
  if (bodies.incomplete.length > 0)
    notes.push(
      `${bodies.incomplete.length} of ${bodies.count} entries returned a body far shorter than ` +
        "the corpus median. That is what a page builder looks like over REST: the document " +
        "lives in postmeta and content.rendered carries only what the classic editor held.",
    );

  // --- the rendered pages for those, because the bodies ARE reachable --------
  const withPages = new Map<number, CapturedEntry["renderedPage"]>();
  if (options.withIncompletePages && bodies.incomplete.length > 0) {
    progress(`fetching ${bodies.incomplete.length} rendered page(s)`);
    for (const stat of bodies.incomplete) {
      const entry = items.find((candidate) => candidate.id === stat.id);
      if (entry === undefined) continue;
      const response = await reader.get(entry.link);
      withPages.set(entry.id, {
        url: entry.link,
        status: response.status,
        ...(response.body === undefined ? {} : { html: response.body }),
      });
    }
    const unreachable = [...withPages.values()].filter(
      (page) => page?.status !== 200,
    ).length;
    if (unreachable > 0)
      notes.push(
        `${unreachable} of those pages did not answer 200, so those entries have neither a ` +
          "complete REST body nor a rendered one. They are captured as they are, marked.",
      );
  }

  // --- authors ---------------------------------------------------------------
  //
  // The content model requires an author registry, and `nicename` is what an
  // author archive's URL is keyed by. `wp/v2/users` is closed to anonymous
  // readers on a great many sites — measured: 302 on a live install — so this
  // asks for each author individually and falls back to the copy WordPress
  // embeds in the post itself, which the same site served without complaint.
  const authors: {
    id: number;
    slug?: string;
    name?: string;
    description?: string;
    status: number;
  }[] = [];
  const authorIds = [
    ...new Set(
      items
        .map((entry) => (entry as { author?: number }).author)
        .filter((id): id is number => typeof id === "number" && id > 0),
    ),
  ].sort((left, right) => left - right);
  if (authorIds.length > 0) {
    progress(`resolving ${authorIds.length} author(s)`);
    for (const id of authorIds) authors.push(await rest.author(id));
    const unresolved = authors.filter((row) => row.slug === undefined);
    if (unresolved.length > 0) {
      // The embedded copy. `_embed=author` rides along on the entry request,
      // so this is one more page of entries rather than one request per author.
      progress(
        `${unresolved.length} author(s) refused; reading the embedded copy`,
      );
      const embedded = await rest.collection<{
        author?: number;
        _embedded?: {
          author?: {
            id: number;
            slug?: string;
            name?: string;
            description?: string;
          }[];
        };
      }>(options.restBase, [], { perPage: 100, embed: "author" });
      const byId = new Map<
        number,
        { id: number; slug?: string; name?: string; description?: string }
      >();
      for (const entry of embedded.items)
        for (const one of entry._embedded?.author ?? [])
          if (one.id !== undefined) byId.set(one.id, one);
      for (let index = 0; index < authors.length; index += 1) {
        const found = byId.get(authors[index]!.id);
        if (authors[index]!.slug === undefined && found !== undefined)
          authors[index] = { ...authors[index]!, ...found };
      }
    }
    const stillMissing = authors.filter((row) => row.slug === undefined);
    if (stillMissing.length > 0)
      notes.push(
        `${stillMissing.length} author(s) could not be resolved by either the users ` +
          "route or the embedded copy. Posts by them cannot be transformed: the " +
          "content model needs a registry row, and inventing one would put a " +
          "byline on the site that names nobody.",
      );
  }

  // --- featured media --------------------------------------------------------
  const media: {
    id: number;
    sourceUrl?: string;
    alt?: string;
    status: number;
  }[] = [];
  if (options.withMedia) {
    const ids = [
      ...new Set(
        items
          .map((entry) => entry.featured_media)
          .filter((id): id is number => typeof id === "number" && id > 0),
      ),
    ].sort((left, right) => left - right);
    progress(`resolving ${ids.length} media row(s)`);
    for (const id of ids) media.push(await rest.media(id));
    const refused = media.filter(
      (row) => row.status !== 200 && row.status !== 404,
    ).length;
    if (refused > 0)
      notes.push(
        `${refused} media request(s) were refused rather than answered 404. Those are not ` +
          "missing attachments, they are a rate limiter — and an entry whose image silently " +
          "goes absent is a transient condition rewriting content.",
      );
  }

  const entries: CapturedEntry[] = items.map((entry) => {
    const page = withPages.get(entry.id);
    return page === undefined ? entry : { ...entry, renderedPage: page };
  });

  return {
    origin: rest.origin,
    type: options.type,
    restBase: options.restBase,
    capturedAt: new Date().toISOString(),
    requests: reader.requests,
    declaredTotal,
    received: items.length,
    entries,
    taxonomies,
    authors,
    media,
    bodies,
    notes,
  };
}

/**
 * Write a capture into the evidence directory, dated and named by type.
 *
 * Dated for the reason every capture in this kit is: it is a measurement of a
 * site at a moment, and a default path that keeps pointing at a superseded
 * capture is how "the capture" quietly stops being current.
 */
export function writeCapture(
  repositoryRoot: string,
  result: CaptureResult,
): string {
  const day = result.capturedAt.slice(0, 10);
  const directory = path.join(
    repositoryRoot,
    migration.evidenceDir,
    `content-capture-${day}`,
  );
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${result.type}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  return file;
}
