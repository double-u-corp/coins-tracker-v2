import AlertBanner from "@/components/AlertBanner";
import { useNewsLogic } from "./useNewsLogic";
import type { NewsItemView } from "@/validators/newsSchema";

interface NewsSectionProps {
  refreshSignal?: unknown;
}

const SENTIMENT_STYLES: Record<NewsItemView["sentiment"], string> = {
  bullish: "bg-green-100 text-green-700",
  bearish: "bg-red-100 text-red-700",
  neutral: "bg-gray-100 text-gray-600",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function NewsSection({ refreshSignal }: NewsSectionProps) {
  const { items, loading, loadingMore, error, hasMore, loadMore } = useNewsLogic(refreshSignal);

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Market Signals</h2>
        <span className="text-xs text-gray-400">Auto-generated from price movement + real articles, not curated news</span>
      </div>

      {error && <AlertBanner variant="error" message={`Failed to load signals: ${error}`} />}
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">
          No signals yet — these show up after a cron run notices a notable price move (2%+), a new high/low, or a
          matching article from the RSS news feed.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, idx) => {
            const previous = items[idx - 1];
            const isNewRun = idx > 0 && previous.cronLogId !== item.cronLogId;
            return (
              <li key={item.id}>
                {isNewRun && <hr className="my-3 border-gray-200" />}
                <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SENTIMENT_STYLES[item.sentiment]}`}>
                      {item.sentiment === "bullish" ? "▲ Bullish" : item.sentiment === "bearish" ? "▼ Bearish" : "● Neutral"}
                    </span>
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-semibold text-gray-900 underline decoration-dotted hover:text-brand-700"
                      >
                        {item.headline}
                      </a>
                    ) : (
                      <span className="text-sm font-semibold text-gray-900">{item.headline}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-600">{item.summary}</p>
                  <div className="mt-1 text-xs text-gray-400">
                    {item.source} · {formatDateTime(item.publishedAt)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-3 w-full rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
