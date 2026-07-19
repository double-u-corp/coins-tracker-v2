import { useCallback, useEffect, useState } from "react";
import type { NewsItemView } from "@/validators/newsSchema";

const PAGE_SIZE = 15;

/**
 * `refreshSignal` is any value that changes when the caller wants the feed
 * reset to page 1 and reloaded — e.g. a counter bumped after a successful
 * manual cron run, since that's what generates new signals/articles.
 */
export function useNewsLogic(refreshSignal?: unknown) {
  const [items, setItems] = useState<NewsItemView[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/news?limit=${PAGE_SIZE}`);
      if (!res.ok) throw new Error(`Failed to load news (${res.status})`);
      const data = (await res.json()) as { items: NewsItemView[]; nextCursor: number | null };
      setItems(data.items);
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFirstPage();
    // Intentionally re-runs whenever refreshSignal changes, not just on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFirstPage, refreshSignal]);

  async function loadMore() {
    if (!hasMore || cursor === null || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await fetch(`/api/news?limit=${PAGE_SIZE}&cursor=${cursor}`);
      if (!res.ok) throw new Error(`Failed to load more news (${res.status})`);
      const data = (await res.json()) as { items: NewsItemView[]; nextCursor: number | null };
      setItems((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  return { items, loading, loadingMore, error, hasMore, loadMore };
}
