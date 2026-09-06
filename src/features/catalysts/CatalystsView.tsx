import { useCatalystsLogic } from "./useCatalystsLogic";
import JournalSidebar from "@/features/chart/JournalSidebar";
import FormattedAiResponse from "@/components/FormattedAiResponse";

export default function CatalystsView() {
  const {
    selectedCategory,
    setSelectedCategory,
    filteredPrompts,
    copiedId,
    handleCopy,
    generalEntries,
    journalLoading,
    journalError,
    authenticated,
    addJournalEntry,
    deleteJournalEntry,
    updateJournalEntry,
    aiCache,
    aiLoading,
    aiErrors,
    savedStatus,
    runAiSearch,
    getPromptStatus,
    saveAiResponseToJournal,
  } = useCatalystsLogic();

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">⚡ Crypto Catalyst Tracker &amp; Live AI Scanner</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Run live web search scans budgeted by Daily, Weekly, and Monthly cycles.
            </p>
          </div>
        </div>

        <div className="flex gap-2 mb-6 border-b border-gray-100 pb-4">
          {["All", "Daily", "Weekly", "Monthly"].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                selectedCategory === cat
                  ? "bg-purple-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {filteredPrompts.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">No prompts found for this category.</p>
          ) : (
            filteredPrompts.map((item) => {
              const statusInfo = getPromptStatus(item.id, item.category);
              const cachedData = aiCache[item.id];
              const isCurrent = statusInfo.status === "current";

              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50/50 p-4 transition hover:border-purple-200 hover:bg-white"
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded bg-gray-200 text-gray-700 text-[10px] font-bold uppercase px-2 py-0.5">
                          {item.category}
                        </span>

                        <span
                          className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                            statusInfo.status === "current"
                              ? "bg-green-100 text-green-700 border border-green-200"
                              : statusInfo.status === "expired"
                              ? "bg-amber-100 text-amber-700 border border-amber-200"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {statusInfo.status === "current" && "✓ "}
                          {statusInfo.label}
                        </span>

                        <h3 className="font-semibold text-gray-900 text-sm">{item.title}</h3>
                      </div>

                      <p className="text-xs text-gray-600 font-mono bg-white p-2.5 rounded border border-gray-200 mt-2">
                        &ldquo;{item.prompt}&rdquo;
                      </p>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <button
                        onClick={() => runAiSearch(item.id, item.prompt, item.category, isCurrent)}
                        disabled={aiLoading[item.id]}
                        className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-md text-xs font-semibold transition disabled:opacity-50 flex items-center justify-center gap-1.5 whitespace-nowrap ${
                          isCurrent
                            ? "bg-gray-200 text-gray-700 hover:bg-gray-300"
                            : "bg-purple-600 text-white hover:bg-purple-700"
                        }`}
                        title={isCurrent ? "Click to force refresh API call" : "Run AI news scan"}
                      >
                        {aiLoading[item.id] ? (
                          <>
                            <span className="animate-spin">⏳</span>
                            <span>Searching...</span>
                          </>
                        ) : isCurrent ? (
                          <>
                            <span>🔄</span>
                            <span>Re-run Scan</span>
                          </>
                        ) : (
                          <>
                            <span>🌐</span>
                            <span>Run AI News</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => handleCopy(item.id, item.prompt)}
                        className="px-3 py-2 rounded-md text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
                        title="Copy Prompt text"
                      >
                        {copiedId === item.id ? "✓" : "📋"}
                      </button>
                    </div>
                  </div>

                  {aiErrors[item.id] && (
                    <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700 mt-2">
                      {aiErrors[item.id]}
                    </div>
                  )}

                  {cachedData?.response && (
                    <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-4 mt-2 space-y-3">
                      <div className="flex items-center justify-between border-b border-purple-100 pb-2">
                        <span className="font-bold text-purple-900 flex items-center gap-1.5 text-xs">
                          <span>🤖</span> Live AI Market Search Response
                        </span>
                        <span className="text-[10px] text-purple-600 font-medium">
                          {statusInfo.label}
                        </span>
                      </div>

                      <FormattedAiResponse text={cachedData.response} />

                      <div className="pt-2 border-t border-purple-100 flex justify-end">
                        <button
                          onClick={() =>
                            saveAiResponseToJournal(item.id, item.title, cachedData.response)
                          }
                          disabled={savedStatus[item.id]}
                          className="px-3 py-1.5 rounded bg-purple-600 text-white hover:bg-purple-700 text-xs font-medium transition flex items-center gap-1.5 shadow-sm disabled:bg-green-600"
                        >
                          {savedStatus[item.id] ? (
                            <>
                              <span>✓</span>
                              <span>Saved to Journal</span>
                            </>
                          ) : (
                            <>
                              <span>📓</span>
                              <span>Add to Journal</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">🌍 General Market Journal &amp; Notes</h3>
            <p className="text-xs text-gray-500 mt-0.5">Track macro updates, general market observations, and macro news notes.</p>
          </div>
        </div>

        <JournalSidebar
          entries={generalEntries}
          loading={journalLoading}
          error={journalError}
          defaultSymbol=""
          authenticated={authenticated}
          onAdd={addJournalEntry}
          onDelete={deleteJournalEntry}
          onUpdate={updateJournalEntry}
        />
      </div>
    </div>
  );
}