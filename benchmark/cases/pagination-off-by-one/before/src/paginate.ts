export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

export function paginate<T>(all: T[], page: number, pageSize: number): Page<T> {
  return { items: all, page: 1, pageSize: all.length, total: all.length };
}
