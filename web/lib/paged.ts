/**
 * PostgREST returns at most this many rows per request (Supabase's `max-rows`), whatever `.limit()`
 * asks for, and says nothing when it cuts a list short (#250). Every read that wants more than one
 * page goes through `readAll`; anything that stays capped on purpose asks for no more than this.
 */
export const ROW_CAP = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** One page of a query, rows `from`..`to` inclusive (PostgREST's `.range()`), in a stable order. */
export type PageQuery<T> = (from: number, to: number) => PromiseLike<PageResult<T>>;

/**
 * Every row of a query, page by page until a short page. The query must order by a unique key, or
 * rows can repeat or go missing between pages. A failed page throws rather than returning the rows
 * read so far: a silently short list is the bug this exists to prevent.
 */
export const readAll = async <T>(label: string, query: PageQuery<T>): Promise<T[]> => {
  const out: T[] = [];
  for (let from = 0; ; from += ROW_CAP) {
    const { data, error } = await query(from, from + ROW_CAP - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < ROW_CAP) return out;
  }
};
