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

  async function removeItem(id: number) {
    setError(null);
    const prev = items;
    // Optimistic — do not reload the whole list
    setItems((list) => list.filter((x) => x.id !== id));
    try {
      let res = await fetch(`/api/news?id=${encodeURIComponent(String(id))}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      // Some hosts block DELETE — fallback POST
      if (res.status === 405 || res.status === 404) {
        res = await fetch("/api/news", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id }),
        });
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
    } catch (err) {
      setItems(prev);
      setError((err as Error).message);
    }
  }

  return { items, loading, loadingMore, error, hasMore, loadMore, removeItem };
}
