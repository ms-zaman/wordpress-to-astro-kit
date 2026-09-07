// The WordPress REST API, read anonymously.
//
// ## Why anonymous, and why that is usually enough
//
// A migration is often planned around "we need admin credentials first", and
// that assumption is worth measuring before it costs anybody a week. On the
// site this kit came from, the blog had been recorded as blocked behind a
// credential. Measured: **251 of 278 posts returned their complete body to an
// anonymous reader.** Only 27 did not, and none of them needed a login either
// — their bodies were on their own rendered pages.
//
// So this reads `wp-json` with no credential and no `Authorization` header,
// and reports what that reaches. If your site genuinely needs one, you will
// see it here as a status rather than as an assumption.
//
// ## `_fields` is a contract, not an optimisation
//
// Every request names the fields it wants. That is what makes a capture
// checkable: a field that silently stops being returned shows up as
// `undefined` in one place instead of as a missing key three layers down.
//
// Nested selection (`_fields=content.rendered`) is deliberately NOT used —
// measured, it silently returns nothing on some versions, which is the worst
// possible failure for a capture: an empty body that looks like an empty post.
import { PoliteReader, requireLiveOrigin } from "../site-map-audit/fetch.ts";

/** One post type, as `wp/v2/types` describes it. */
export interface PostType {
  /** The type's key: `post`, `page`, `docs`, … */
  readonly name: string;
  /** Human label. */
  readonly label: string;
  /** The REST route segment, which is NOT always the type name. */
  readonly restBase: string;
  /** Taxonomies attached to it. */
  readonly taxonomies: readonly string[];
}

/** One taxonomy, as `wp/v2/taxonomies` describes it. */
export interface Taxonomy {
  readonly name: string;
  readonly label: string;
  readonly restBase: string;
  readonly types: readonly string[];
  /** True for a hierarchical taxonomy: a category rather than a tag. */
  readonly hierarchical: boolean;
}

/** What one collection holds, without downloading it. */
export interface CollectionCount {
  readonly restBase: string;
  /** `x-wp-total`, or `null` when the route did not answer with one. */
  readonly total: number | null;
  readonly status: number;
  /** Present when the route refused or failed. */
  readonly note?: string;
}

export class WordPressRest {
  readonly #reader: PoliteReader;
  readonly #origin: string;

  constructor(reader: PoliteReader, origin: string = requireLiveOrigin()) {
    this.#reader = reader;
    this.#origin = origin;
  }

  get requests(): number {
    return this.#reader.requests;
  }

  /** The site being read. */
  get origin(): string {
    return this.#origin;
  }

  url(route: string, query: Readonly<Record<string, string>> = {}): string {
    const parameters = new URLSearchParams(query);
    const search = parameters.toString();
    return `${this.#origin}/wp-json/wp/v2/${route}${search === "" ? "" : `?${search}`}`;
  }

  /** One request, parsed as JSON. A non-200 or unparseable body is a null. */
  async #json<T>(
    url: string,
    retry = false,
  ): Promise<{
    value: T | null;
    status: number;
    headers: Readonly<Record<string, string>>;
  }> {
    const response = retry
      ? await this.#reader.getRetrying(url)
      : await this.#reader.get(url);
    if (response.status !== 200 || response.body === undefined)
      return {
        value: null,
        status: response.status,
        headers: response.headers,
      };
    try {
      return {
        value: JSON.parse(response.body) as T,
        status: response.status,
        headers: response.headers,
      };
    } catch {
      return {
        value: null,
        status: response.status,
        headers: response.headers,
      };
    }
  }

  /**
   * Every post type the site publishes.
   *
   * This is the content census's first question, and it is the one that most
   * often surprises: a site with "a blog" turns out to publish three custom
   * post types a plugin registered, each with its own archive and its own
   * URLs, and none of them in anybody's plan.
   */
  async postTypes(): Promise<PostType[]> {
    const { value } = await this.#json<
      Record<
        string,
        {
          name?: string;
          slug?: string;
          rest_base?: string;
          taxonomies?: string[];
        }
      >
    >(this.url("types"));
    if (value === null) return [];
    return Object.entries(value)
      .map(([key, type]) => ({
        name: type.slug ?? key,
        label: type.name ?? key,
        restBase: type.rest_base ?? key,
        taxonomies: type.taxonomies ?? [],
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Every taxonomy, with the types it applies to. */
  async taxonomies(): Promise<Taxonomy[]> {
    const { value } = await this.#json<
      Record<
        string,
        {
          name?: string;
          slug?: string;
          rest_base?: string;
          types?: string[];
          hierarchical?: boolean;
        }
      >
    >(this.url("taxonomies"));
    if (value === null) return [];
    return Object.entries(value)
      .map(([key, taxonomy]) => ({
        name: taxonomy.slug ?? key,
        label: taxonomy.name ?? key,
        restBase: taxonomy.rest_base ?? key,
        types: taxonomy.types ?? [],
        hierarchical: taxonomy.hierarchical ?? false,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * How many rows a collection holds, from one request.
   *
   * `per_page=1` and read `x-wp-total`. This is the cheapest question in the
   * whole census and it is the one that sizes the migration: a route that
   * answers 1 and a route that answers 4,000 need completely different plans.
   */
  async count(restBase: string): Promise<CollectionCount> {
    const { status, headers } = await this.#json<unknown[]>(
      this.url(restBase, { per_page: "1" }),
    );
    const raw = headers["x-wp-total"];
    if (status !== 200)
      return {
        restBase,
        total: null,
        status,
        note:
          status === 401 || status === 403
            ? "the route refused an anonymous reader — this is the one that may genuinely need a credential"
            : `the route answered ${status}`,
      };
    if (raw === undefined)
      return {
        restBase,
        total: null,
        status,
        note: "answered 200 with no x-wp-total header, so the size is unknown",
      };
    return { restBase, total: Number(raw), status };
  }

  /**
   * Every row of a collection, page by page.
   *
   * Follows `x-wp-totalpages` rather than guessing from a short page: a filter
   * that removes a row after the query runs makes a full page look short, and
   * a reader that stopped there would silently capture part of a site.
   */
  async collection<T>(
    restBase: string,
    fields: readonly string[],
    options: {
      limit?: number;
      perPage?: number;
      onPage?: (page: number, of: number) => void;
    } = {},
  ): Promise<{ items: T[]; declaredTotal: number | null; pages: number }> {
    const perPage = Math.min(options.perPage ?? 100, 100);
    const items: T[] = [];
    let declaredTotal: number | null = null;
    let totalPages = 1;

    for (let page = 1; page <= totalPages; page += 1) {
      const { value, headers, status } = await this.#json<T[]>(
        this.url(restBase, {
          per_page: String(perPage),
          page: String(page),
          _fields: fields.join(","),
        }),
        // A page of a collection is a request whose failure would silently
        // shorten the capture, so it is one of the two places a retry is
        // correct. See `PoliteReader.getRetrying`.
        true,
      );
      if (page === 1) {
        const total = headers["x-wp-total"];
        declaredTotal = total === undefined ? null : Number(total);
        totalPages = Number(headers["x-wp-totalpages"] ?? "1") || 1;
      }
      options.onPage?.(page, totalPages);
      if (value === null) {
        // Recorded by the caller through the totals disagreeing. Stopping here
        // rather than continuing keeps the capture from interleaving a hole.
        break;
      }
      items.push(...value);
      if (status !== 200) break;
      if (options.limit !== undefined && items.length >= options.limit) break;
    }

    return {
      items:
        options.limit === undefined ? items : items.slice(0, options.limit),
      declaredTotal,
      pages: totalPages,
    };
  }

  /** One media row, resolved by id. Retried, because a refusal here silently drops an image. */
  async media(
    id: number,
  ): Promise<{ id: number; sourceUrl?: string; alt?: string; status: number }> {
    const { value, status } = await this.#json<{
      source_url?: string;
      alt_text?: string;
    }>(this.url(`media/${id}`), true);
    if (value === null) return { id, status };
    return {
      id,
      status,
      ...(value.source_url === undefined
        ? {}
        : { sourceUrl: value.source_url }),
      ...(value.alt_text === undefined ? {} : { alt: value.alt_text }),
    };
  }
}
