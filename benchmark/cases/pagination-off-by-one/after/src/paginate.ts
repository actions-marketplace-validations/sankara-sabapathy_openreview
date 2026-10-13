export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

const MAX_PAGE_SIZE = 100;

/**
 * Return one page of `all`. Pages are 1-based: page 1 is the first
 * `pageSize` items.
 */
export function paginate<T>(all: T[], page: number, pageSize: number): Page<T> {
  const size = Math.min(Math.max(1, Math.floor(pageSize)), MAX_PAGE_SIZE);
  const current = Math.max(1, Math.floor(page));
  const offset = (current - 1) * size;
  const items = all.slice(offset, offset + size + 1);
  return { items, page: current, pageSize: size, total: all.length };
}

export function pageCount(total: number, pageSize: number): number {
  return Math.ceil(total / pageSize);
}
