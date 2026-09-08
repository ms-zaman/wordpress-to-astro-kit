// CAPTURE → CONTENT. The step the kit deliberately did not take, taken.
//
// ## Why it was left out, and what changed
//
// The kit's README called this "the one step the kit deliberately leaves to
// you", on the reasoning that turning a WordPress row into a content entry
// depends on YOUR schemas. That reasoning holds for a schema you have
// extended — a custom type with a `price`, an ACF group — and it does not hold
// for the shape every WordPress site has: a post, a page, a category, a tag,
// an author. Those map onto the kit's own content model with no judgement in
// it at all, and leaving them out meant every migration began by writing the
// same transform.
//
// So this is deliberately NARROW. It transforms what the kit's own schemas
// already describe, and it REFUSES anything else by name rather than guessing:
// a custom type's entry, a field no schema has, a body it cannot represent.
//
// ## What it will not do
//
//   * It does not touch the body. WordPress's HTML is carried verbatim, and
//     every rewrite — media, internal links, emoji — happens at RENDER time,
//     where it is one function and can be re-run. A transform that rewrote
//     bodies on the way in would bake today's decisions into the content tree.
//   * It does not invent an excerpt. WordPress auto-generates one when a post
//     has none, and storing that as if an editor wrote it makes a derived
//     value indistinguishable from a chosen one.
//   * It does not invent a date, an author, or a term. A row that cannot
//     produce a valid entry is reported, not repaired.
//
// ## Identity and provenance
//
// Every entry carries `source: { system: "wordpress", sourceId, capturedAt }`,
// which is the WordPress primary key — the only name that survives a slug
// being edited. `cluster` is `<set>/<slug>`, the kit's language-neutral key.
// The local identity is the file path; the route comes from the permalinks.
// Four names, none of them derived from another.
import type { ValidationIssue } from "../../apps/website/src/content-model/cross-entry.ts";
import { readSourceSlug } from "../../apps/website/src/content-model/slug.ts";
import type { SlugRefused } from "../../apps/website/src/content-model/slug.ts";

/** One entry as `content-capture` writes it. */
export interface CapturedRow {
  readonly id: number;
  readonly slug: string;
  readonly status?: string;
  readonly date?: string;
  readonly modified?: string;
  readonly link?: string;
  readonly title?: { rendered?: string };
  readonly content?: { rendered?: string; protected?: boolean };
  readonly excerpt?: { rendered?: string; protected?: boolean };
  readonly author?: number;
  readonly parent?: number;
  readonly categories?: number[];
  readonly tags?: number[];
  readonly featured_media?: number;
}

/** One taxonomy term as the capture records it. */
export interface CapturedTerm {
  readonly id: number;
  readonly slug: string;
  readonly name?: string;
  readonly parent?: number;
  readonly count?: number;
  readonly description?: string;
}

/** One author, as `_embed` yields it — the users route is often closed. */
export interface CapturedAuthor {
  readonly id: number;
  readonly slug: string;
  readonly name?: string;
  readonly description?: string;
  readonly url?: string;
}

/** One media row the capture resolved by id. */
export interface CapturedMedia {
  readonly id: number;
  readonly sourceUrl?: string;
  readonly alt?: string;
}

export type ExcludedReason =
  /** WordPress's password protection — the body is not in the capture. */
  | "password-protected"
  /** Not `publish`: a draft, pending, private or trashed row. */
  | "not-published"
  /** A required field the source did not supply. */
  | "incomplete"
  /** A slug the content model cannot express. */
  | "unrepresentable-slug"
  /**
   * Two source rows claiming one slug.
   *
   * WordPress's `wp_unique_post_slug()` makes a page's `post_name` unique
   * among its SIBLINGS, not across the site: `/security/` and
   * `/about/security/` are two pages and both are named `security`. This
   * kit's page identity is the slug alone — the resolver keys the parent
   * chain on it — so it can hold one of them.
   *
   * Measured on ja.wordpress.org: four such pairs, and before this reason
   * existed the second row of each pair overwrote the first on the way to
   * disk. The transform reported 71 entries and 67 files were written, and
   * nothing compared the two numbers.
   */
  | "duplicate-slug";

/** One slug stored in a different spelling from the one the source served. */
export interface DecodedSlug {
  readonly kind: string;
  /** As WordPress stores it: `%e7%bf%bb%e8%a8%b3`. */
  readonly raw: string;
  /** As this kit stores it: `翻訳`. The same URL. */
  readonly slug: string;
}

export interface Excluded {
  readonly kind: string;
  readonly id: number;
  readonly slug: string;
  readonly reason: ExcludedReason;
  readonly detail: string;
}

export interface TransformedEntry {
  /** `posts/hello-world.md`, relative to the content root. */
  readonly file: string;
  readonly frontMatter: Record<string, unknown>;
  readonly body: string;
}

export interface TransformResult {
  readonly entries: readonly TransformedEntry[];
  readonly categories: readonly Record<string, unknown>[];
  readonly tags: readonly Record<string, unknown>[];
  readonly authors: readonly Record<string, unknown>[];
  /** Every row that produced no entry, with the reason. */
  readonly excluded: readonly Excluded[];
  /**
   * Every REGISTRY row — a term, an author — that produced no row, with the
   * reason. Separate from `excluded` because the registries are built from one
   * capture and this function runs once per post type, so the CLI must
   * de-duplicate these and must not de-duplicate those.
   *
   * This list used to not exist, and the rows in it were dropped by a bare
   * `continue`. On ja.wordpress.org that silently removed seven tags and left
   * nine posts pointing at them: the transform reported ten exclusions and had
   * made seventeen.
   */
  readonly registryExcluded: readonly Excluded[];
  /**
   * Slugs whose source spelling was percent-encoded and whose stored spelling
   * is not. Reported rather than performed quietly, because it is the one
   * place this transform changes how an identity is spelled.
   */
  readonly decodedSlugs: readonly DecodedSlug[];
  /** Problems a person must fix; the transform still returns what it could. */
  readonly issues: readonly ValidationIssue[];
}

/** `2026-01-15T09:30:00` → `2026-01-15`. Never invented. */
const isoDay = (value: string | undefined): string | undefined => {
  if (typeof value !== "string" || value === "") return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1];
};

/**
 * WordPress renders entities in `title.rendered`. They are decoded because a
 * title is TEXT in the content model — `&amp;` in a front-matter title would
 * be printed literally by every consumer that does not re-decode it.
 */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#039": "'",
  "#8217": "’",
  "#8216": "‘",
  "#8220": "“",
  "#8221": "”",
  "#8211": "–",
  "#8212": "—",
  "#8230": "…",
  nbsp: " ",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#?[a-z0-9]+);/gi, (whole, name: string) => {
    const direct = ENTITIES[name] ?? ENTITIES[name.toLowerCase()];
    if (direct !== undefined) return direct;
    const numeric = /^#(\d+)$/.exec(name);
    if (numeric !== null) return String.fromCodePoint(Number(numeric[1]));
    const hex = /^#x([0-9a-f]+)$/i.exec(name);
    if (hex !== null) return String.fromCodePoint(Number.parseInt(hex[1]!, 16));
    return whole;
  });
}

/** Plain text from a rendered HTML fragment — for an excerpt, never a body. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

export interface TransformInput {
  /** `post` or `page`. Custom types are refused — see `transform`. */
  readonly kind: "post" | "page";
  readonly rows: readonly CapturedRow[];
  readonly capturedAt: string;
  readonly categories: readonly CapturedTerm[];
  readonly tags: readonly CapturedTerm[];
  readonly authors: readonly CapturedAuthor[];
  readonly media: readonly CapturedMedia[];
  readonly locale: string;
}

/**
 * Turn one capture into content entries.
 *
 * Pure: it returns files to write rather than writing them, so the CLI owns
 * the filesystem and a test can state a whole migration in one object.
 */
export function transform(input: TransformInput): TransformResult {
  const entries: TransformedEntry[] = [];
  const excluded: Excluded[] = [];
  const issues: ValidationIssue[] = [];

  const decodedSlugs: DecodedSlug[] = [];
  const registryExcluded: Excluded[] = [];
  /** slug -> the row that claimed it first. One entry per file written. */
  const claimed = new Map<string, CapturedRow>();

  const set = input.kind === "post" ? "posts" : "pages";

  // Terms and authors are read ONCE, here, and every reference below resolves
  // through the result. Before this they were re-tested at each use with a
  // regex, in four places, and two of those places tested nothing at all — so
  // a term the registry had refused still reached a post's front matter.
  const categoryIndex = indexSlugs(input.categories, "categories");
  const tagIndex = indexSlugs(input.tags, "tags");
  const authorIndex = indexSlugs(input.authors, "authors");
  registryExcluded.push(
    ...categoryIndex.excluded,
    ...tagIndex.excluded,
    ...authorIndex.excluded,
  );
  decodedSlugs.push(
    ...categoryIndex.decoded,
    ...tagIndex.decoded,
    ...authorIndex.decoded,
  );

  const mediaBySourceId = new Map(input.media.map((m) => [m.id, m]));
  const pageBySourceId = new Map(input.rows.map((r) => [r.id, r]));

  for (const row of input.rows) {
    const where = `${set}/${row.slug || row.id}`;

    if (row.status !== undefined && row.status !== "publish") {
      excluded.push({
        kind: set,
        id: row.id,
        slug: row.slug,
        reason: "not-published",
        detail: `status "${row.status}" — only published rows become pages.`,
      });
      continue;
    }

    // WordPress withholds a protected body from REST entirely. There is no
    // content to migrate and inventing an empty page would publish a URL the
    // source answers with a password form.
    if (
      row.content?.protected === true ||
      (row.content?.rendered ?? "") === ""
    ) {
      excluded.push({
        kind: set,
        id: row.id,
        slug: row.slug,
        reason:
          row.content?.protected === true ? "password-protected" : "incomplete",
        detail:
          row.content?.protected === true
            ? "the source withholds the body behind a password; REST returns none, " +
              "and this kit does not model password-protected content."
            : "REST returned an empty body. A page builder keeps its document in " +
              "postmeta — capture the rendered page and transform that instead.",
      });
      continue;
    }

    const reading = readSourceSlug(row.slug);
    if (!reading.ok) {
      excluded.push({
        kind: set,
        id: row.id,
        slug: row.slug,
        reason: "unrepresentable-slug",
        detail: `${reading.detail} (${reading.reason})`,
      });
      continue;
    }
    const slug = reading.slug;
    if (reading.decoded) decodedSlugs.push({ kind: set, raw: row.slug, slug });

    const updatedAt = isoDay(row.modified) ?? isoDay(row.date);
    if (updatedAt === undefined) {
      excluded.push({
        kind: set,
        id: row.id,
        slug: row.slug,
        reason: "incomplete",
        detail: "no `modified` or `date`, so nothing can date the entry.",
      });
      continue;
    }

    const title = decodeEntities(row.title?.rendered ?? "").trim();
    if (title === "") {
      excluded.push({
        kind: set,
        id: row.id,
        slug: row.slug,
        reason: "incomplete",
        detail: "the source supplies no title.",
      });
      continue;
    }

    const frontMatter: Record<string, unknown> = {
      slug,
      title,
      locale: input.locale,
      cluster: `${set}/${slug}`,
      updatedAt,
    };

    const excerpt = textOf(row.excerpt?.rendered ?? "");
    if (excerpt !== "") frontMatter.excerpt = excerpt;

    if (input.kind === "post") {
      const publishedAt = isoDay(row.date);
      if (publishedAt === undefined) {
        excluded.push({
          kind: set,
          id: row.id,
          slug: row.slug,
          reason: "incomplete",
          detail:
            "a post with no publication date cannot be ordered or routed.",
        });
        continue;
      }
      frontMatter.publishedAt = publishedAt;

      const authorSlug = authorIndex.slugById.get(row.author ?? -1);
      if (authorSlug === undefined) {
        const refusal = authorIndex.refusedById.get(row.author ?? -1);
        excluded.push({
          kind: set,
          id: row.id,
          slug,
          reason: "incomplete",
          detail:
            refusal === undefined
              ? `author ${row.author} is not in the captured author set. The users ` +
                "route is often closed to anonymous readers; capture resolves " +
                "authors through `_embed` instead."
              : `author ${row.author} was captured but its slug cannot be ` +
                `represented: ${refusal.detail} (${refusal.reason})`,
        });
        continue;
      }
      frontMatter.author = authorSlug;

      // WordPress gives every post at least one category. A post whose
      // categories are all unknown is a broken reference, not a post with none.
      const categories = resolveTerms(
        row.categories,
        categoryIndex,
        "category",
        where,
        issues,
      );
      if (categories.length === 0) {
        excluded.push({
          kind: set,
          id: row.id,
          slug,
          reason: "incomplete",
          detail:
            `categories [${(row.categories ?? []).join(", ")}] resolved to none ` +
            "in the captured category registry.",
        });
        continue;
      }
      frontMatter.categories = categories;

      const tags = resolveTerms(row.tags, tagIndex, "tag", where, issues);
      if (tags.length > 0) frontMatter.tags = tags;

      const featured = mediaBySourceId.get(row.featured_media ?? -1);
      if (featured?.sourceUrl !== undefined)
        frontMatter.featuredImage = {
          url: featured.sourceUrl,
          ...(featured.alt !== undefined && featured.alt !== ""
            ? { alt: featured.alt }
            : {}),
        };
      else if ((row.featured_media ?? 0) > 0)
        issues.push({
          code: "post-tag-unregistered",
          message:
            `${where}: featured_media ${row.featured_media} was not resolved by ` +
            "the capture, so the entry has no featured image. Re-capture with " +
            "media enabled.",
        });
    } else {
      // A page's parent is a SLUG in the content model and an id in WordPress.
      const parent = pageBySourceId.get(row.parent ?? 0);
      const parentReading =
        parent === undefined ? undefined : readSourceSlug(parent.slug);
      if ((row.parent ?? 0) > 0) {
        if (parentReading === undefined || !parentReading.ok)
          issues.push({
            code: "page-parent-unknown",
            message:
              `${where}: parent ${row.parent} ` +
              (parentReading === undefined
                ? "is not in this capture"
                : `has a slug this kit cannot represent (${parentReading.reason})`) +
              ", so the hierarchy would be broken. Capture every page before " +
              "transforming.",
          });
        else frontMatter.parent = parentReading.slug;
      }
    }

    // Last, because a row that fails any check above never claimed a slug and
    // must not make the next row with that slug look like a collision.
    const firstClaim = claimed.get(slug);
    if (firstClaim !== undefined) {
      excluded.push({
        kind: set,
        id: row.id,
        slug,
        reason: "duplicate-slug",
        detail:
          `source id ${row.id} (${row.link ?? "no link captured"}) and source ` +
          `id ${firstClaim.id} (${firstClaim.link ?? "no link captured"}) both ` +
          `have the slug "${slug}". WordPress makes a page slug unique among ` +
          "its siblings; this content model makes it unique across the " +
          "collection. Give one of them a different slug and a redirect, or " +
          "keep the hierarchy and change the model.",
      });
      continue;
    }
    claimed.set(slug, row);

    frontMatter.source = {
      system: "wordpress",
      sourceId: String(row.id),
      capturedAt: input.capturedAt,
    };

    entries.push({
      file: `${set}/${slug}.md`,
      frontMatter,
      body: row.content?.rendered ?? "",
    });
  }

  return {
    entries,
    categories: termRows(
      input.categories,
      categoryIndex,
      input.locale,
      input.capturedAt,
    ),
    tags: termRows(input.tags, tagIndex, input.locale, input.capturedAt),
    authors: authorRows(input.authors, authorIndex, input.capturedAt),
    excluded,
    registryExcluded,
    decodedSlugs,
    issues,
  };
}

/**
 * Every term or author id that has a representable slug, and every one that
 * does not — with the reason it does not.
 *
 * One reading, reused. A slug tested at each point of use is a slug tested
 * differently at each point of use, and that is exactly what happened here:
 * the registry refused a term, the post's `tags` list did not, and the entry
 * kept a reference to a row nothing had written.
 */
interface SlugIndex {
  readonly slugById: ReadonlyMap<number, string>;
  readonly refusedById: ReadonlyMap<number, SlugRefused>;
  readonly excluded: readonly Excluded[];
  readonly decoded: readonly DecodedSlug[];
}

function indexSlugs(
  rows: readonly { readonly id: number; readonly slug: string }[],
  kind: string,
): SlugIndex {
  const slugById = new Map<number, string>();
  const refusedById = new Map<number, SlugRefused>();
  const excluded: Excluded[] = [];
  const decoded: DecodedSlug[] = [];
  for (const row of rows) {
    const reading = readSourceSlug(row.slug);
    if (reading.ok) {
      slugById.set(row.id, reading.slug);
      if (reading.decoded)
        decoded.push({ kind, raw: row.slug, slug: reading.slug });
      continue;
    }
    refusedById.set(row.id, reading);
    excluded.push({
      kind,
      id: row.id,
      slug: row.slug,
      reason: "unrepresentable-slug",
      detail: `${reading.detail} (${reading.reason})`,
    });
  }
  return { slugById, refusedById, excluded, decoded };
}

/**
 * A post's term references, resolved — and an issue for every one that does
 * not resolve, rather than a shorter list.
 *
 * A post that quietly keeps three of its four tags is the failure this whole
 * module is written against: nothing errors, the page renders, and the only
 * evidence that a tag was lost is on a site nobody is comparing against any
 * more.
 */
function resolveTerms(
  ids: readonly number[] | undefined,
  index: SlugIndex,
  label: string,
  where: string,
  issues: ValidationIssue[],
): string[] {
  const slugs: string[] = [];
  for (const id of ids ?? []) {
    const slug = index.slugById.get(id);
    if (slug !== undefined) {
      slugs.push(slug);
      continue;
    }
    const refusal = index.refusedById.get(id);
    issues.push({
      code: "post-tag-unregistered",
      message:
        `${where}: ${label} ${id} is referenced by this row but ` +
        (refusal === undefined
          ? "is not in the capture, so the membership is dropped. Re-capture " +
            "the taxonomy before transforming."
          : `its slug cannot be represented, so the membership is dropped: ${refusal.detail} (${refusal.reason})`),
    });
  }
  return slugs;
}

/**
 * A taxonomy registry, in the kit's shape.
 *
 * `parent` is resolved from WordPress's id to the slug the content model uses.
 * A term whose parent is not in the capture keeps NO parent rather than a
 * dangling one — the resolver would throw on it, and a registry that cannot
 * load takes the whole site with it.
 */
function termRows(
  terms: readonly CapturedTerm[],
  index: SlugIndex,
  locale: string,
  capturedAt: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const term of terms) {
    const slug = index.slugById.get(term.id);
    if (slug === undefined) continue; // already recorded, with its reason
    const name = decodeEntities(term.name ?? "").trim();
    const parentSlug = index.slugById.get(term.parent ?? 0);
    const description = textOf(term.description ?? "");
    rows.push({
      slug,
      ...(parentSlug === undefined ? {} : { parent: parentSlug }),
      name: { [locale]: name === "" ? slug : name },
      ...(description === "" ? {} : { description: { [locale]: description } }),
      source: {
        system: "wordpress",
        sourceId: String(term.id),
        capturedAt,
      },
    });
  }
  return rows.sort((left, right) =>
    String(left.slug).localeCompare(String(right.slug)),
  );
}

/**
 * The author registry.
 *
 * `nicename` is WordPress's `slug`, which is what `/author/<nicename>/` uses —
 * so the archive URL the source published is the archive URL this site
 * publishes. Both fields are set because the content model keeps them
 * separate: `slug` is this repository's key and `nicename` is the source's.
 */
function authorRows(
  authors: readonly CapturedAuthor[],
  index: SlugIndex,
  capturedAt: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const author of authors) {
    const slug = index.slugById.get(author.id);
    if (slug === undefined) continue; // already recorded, with its reason
    const bio = textOf(author.description ?? "");
    rows.push({
      slug,
      name: decodeEntities(author.name ?? "").trim() || slug,
      // `nicename` is the source's own key for the author, which is what
      // `/author/<nicename>/` uses. It is the DECODED spelling for the same
      // reason the slug is: the two encode to one URL.
      nicename: slug,
      ...(bio === "" ? {} : { bio }),
      source: {
        system: "wordpress",
        sourceId: String(author.id),
        capturedAt,
      },
    });
  }
  return rows.sort((left, right) =>
    String(left.slug).localeCompare(String(right.slug)),
  );
}

/** Front matter as YAML the kit's own reader parses. */
export function toFrontMatter(fields: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  /**
   * YAML would COERCE an unquoted scalar, and a string must stay a string.
   *
   * Caught by the collection schema on a real migration: `sourceId: "1250"`
   * was emitted unquoted, YAML read it back as a NUMBER, and the content model
   * refused the entry — correctly, because a WordPress id is an identifier and
   * not a quantity. The failure was loud and immediate, which is the schema
   * doing its job; the writer was wrong.
   *
   * So anything YAML has a type rule for is quoted: numbers (including the
   * leading-zero octal form), booleans in all six spellings YAML 1.1 accepts,
   * nulls, timestamps, and the sexagesimal form nobody remembers until one
   * turns up in a slug.
   */
  const YAML_TYPED =
    /^(?:[-+]?\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|0[xXoObB][0-9a-fA-F_]+|[-+]?\.(?:inf|nan)|true|True|TRUE|false|False|FALSE|null|Null|NULL|~|[yYnN]|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF|\d{4}-\d{2}-\d{2}.*|[-+]?\d+(?::\d+)+)$/;

  const scalar = (value: unknown): string => {
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    const text = String(value);
    // Plain only when YAML reads it back as the same string.
    return /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(text) && !YAML_TYPED.test(text)
      ? text
      : JSON.stringify(text);
  };
  const emit = (key: string, value: unknown, indent: string): void => {
    if (Array.isArray(value)) {
      lines.push(`${indent}${key}:`);
      for (const item of value) lines.push(`${indent}  - ${scalar(item)}`);
      return;
    }
    if (value !== null && typeof value === "object") {
      lines.push(`${indent}${key}:`);
      for (const [nested, inner] of Object.entries(
        value as Record<string, unknown>,
      ))
        emit(nested, inner, `${indent}  `);
      return;
    }
    lines.push(`${indent}${key}: ${scalar(value)}`);
  };
  for (const [key, value] of Object.entries(fields)) emit(key, value, "");
  lines.push("---", "");
  return lines.join("\n");
}
