// Pagination. Two decisions recorded here rather than left to each caller:
// page 1 keeps the archive's URL (`/blog/`, not `/blog/page/1/` — two URLs
// for one page of results is a duplicate-content defect), and an out-of-range
// page THROWS, because a route asks which pages exist and renders each one,
// so a number outside that set is a routing bug.
import { paginatedPath, permalinks } from "../routing/permalink.ts";

/** WordPress `posts_per_page`, from `migration.config.ts`. */
export const DEFAULT_PAGE_SIZE = permalinks.postsPerPage;

export interface PageOf<Item> {
  readonly items: readonly Item[];
  /** 1-based, as it appears in a URL. */
  readonly page: number;
  readonly pageSize: number;
  /** Always at least 1: an empty listing is one empty page, not zero pages. */
  readonly pageCount: number;
  readonly total: number;
  readonly first: number;
  readonly last: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly previousPage?: number;
  readonly nextPage?: number;
}

export function pageCountOf(total: number, pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1)
    throw new RangeError(
      `Pagination: pageSize must be a positive integer, got ${pageSize}.`,
    );
  return Math.max(1, Math.ceil(total / pageSize));
}

export function paginate<Item>(
  items: readonly Item[],
  options: { readonly page?: number; readonly pageSize?: number } = {},
): PageOf<Item> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = options.page ?? 1;
  const pageCount = pageCountOf(items.length, pageSize);

  if (!Number.isInteger(page) || page < 1 || page > pageCount)
    throw new RangeError(
      `Pagination: page ${page} does not exist — this listing has ${pageCount} ` +
        `page(s) of ${pageSize}.`,
    );

  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    items: pageItems,
    page,
    pageSize,
    pageCount,
    total: items.length,
    first: pageItems.length === 0 ? 0 : start + 1,
    last: pageItems.length === 0 ? 0 : start + pageItems.length,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
    previousPage: page > 1 ? page - 1 : undefined,
    nextPage: page < pageCount ? page + 1 : undefined,
  };
}

/** Every page number a listing has, in order. */
export function pageNumbers(total: number, pageSize: number): number[] {
  return Array.from({ length: pageCountOf(total, pageSize) }, (_, i) => i + 1);
}

/** The URL of one page of an archive. Throws outside the listing. */
export function pageHref(base: string, page: number, pageCount = page): string {
  if (!Number.isInteger(page) || page < 1 || page > pageCount)
    throw new RangeError(
      `Pagination: no URL for page ${page} of a ${pageCount}-page listing.`,
    );
  return paginatedPath(base, page);
}
