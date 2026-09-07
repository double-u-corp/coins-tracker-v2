import { useState } from "react";
import { useCatalystsLogic, AVAILABLE_TOKENS } from "./useCatalystsLogic";
import JournalSidebar from "@/features/chart/JournalSidebar";
import FormattedAiResponse from "@/components/FormattedAiResponse";

export default function CatalystsView() {
  const {
    activeTab,
    setActiveTab,
    selectedCoin,
    setSelectedCoin,
    runCoinDeepDiveScan,
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

  const [activeCoinAction, setActiveCoinAction] = useState<"why_moving" | "catalysts" | "risks">("why_moving");

  const currentCoinPromptId = `coin-deepdive-${selectedCoin.toLowerCase()}-${activeCoinAction}`;
  const currentCoinLog = aiCache[currentCoinPromptId];

  return (
    <div className="flex flex-col gap-6">
      {/* Top Main Navigation Tabs */}
      <div className="flex border-b border-gray-200 bg-white px-4 pt-3 rounded-t-lg">
        <button
          onClick={() => setActiveTab("batch")}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition ${
            activeTab === "batch"
              ? "border-purple-600 text-purple-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          ⚡ Batch Catalyst Tracker
        </button>
        <button
          onClick={() => setActiveTab("coin")}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition ${
            activeTab === "coin"
              ? "border-purple-600 text-purple-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          🪙 Single Coin Deep-Dive
        </button>
      </div>

      {/* TAB 1: BATCH SCANNER */}
      {activeTab === "batch" && (
        <div className="rounded-b-lg border border-gray-200 bg-white p-6 shadow-sm -mt-6">
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
            {filteredPrompts.map((item) => {
              const statusInfo = getPromptStatus(item.id, item.category);
              const cachedData = aiCache[item.id];
              const isCurrent = statusInfo.status === "current";

              return (
                <div key={item.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded bg-gray-200 text-gray-700 text-[10px] font-bold uppercase px-2 py-0.5">
                          {item.category}
                        </span>
                        <h3 className="font-semibold text-gray-900 text-sm">{item.title}</h3>
                      </div>
                      <p className="text-xs text-gray-600 font-mono bg-white p-2 rounded border border-gray-200 mt-1">
                        &ldquo;{item.prompt}&rdquo;
                      </p>
                    </div>

                    <button
                      onClick={() => runAiSearch(item.id, item.prompt, item.category, isCurrent)}
                      disabled={aiLoading[item.id]}
                      className="px-3.5 py-2 rounded-md text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                    >
                      {aiLoading[item.id] ? "Searching..." : "Run Scan"}
                    </button>
                  </div>

                  {cachedData?.response && (
                    <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-4 mt-2">
                      <FormattedAiResponse text={cachedData.response} />
                      <div className="pt-2 mt-2 border-t border-purple-100 flex justify-end">
                        <button
                          onClick={() => saveAiResponseToJournal(item.id, item.title, cachedData.response)}
                          className="px-3 py-1 rounded bg-purple-600 text-white text-xs font-medium"
                        >
                          Add to Journal
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: SINGLE COIN DEEP DIVE */}
      {activeTab === "coin" && (
        <div className="rounded-b-lg border border-gray-200 bg-white p-6 shadow-sm -mt-6 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900">🔍 Single Coin Catalyst Scanner</h2>
            <p className="text-xs text-gray-500">Select a specific coin to check why it is moving or discover upcoming catalysts.</p>
          </div>

          {/* Token Pills */}
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_TOKENS.map((token) => (
              <button
                key={token}
                onClick={() => setSelectedCoin(token)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  selectedCoin === token
                    ? "bg-purple-600 text-white shadow"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {token}
              </button>
            ))}
          </div>

          {/* Action Modes */}
          <div className="flex gap-2 border-b border-gray-100 pb-3">
            {[
              { id: "why_moving", label: "📈 Why is it Up/Down Today?" },
              { id: "catalysts", label: "🚀 Bullish Catalysts & News" },
              { id: "risks", label: "⚠️ Risks & Unlocks" },
            ].map((action) => (
              <button
                key={action.id}
                onClick={() => setActiveCoinAction(action.id as any)}
                className={`px-3 py-1.5 rounded text-xs font-semibold ${
                  activeCoinAction === action.id ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>

          {/* Trigger Scan Button */}
          <div className="flex items-center justify-between bg-purple-50 p-4 rounded-lg border border-purple-100">
            <div>
              <span className="text-xs font-bold text-purple-900">Target Coin: {selectedCoin}</span>
              <p className="text-xs text-purple-700 mt-0.5">Scans Tavily for real-time news &amp; market drivers.</p>
            </div>
            <button
              onClick={() => runCoinDeepDiveScan(selectedCoin, activeCoinAction)}
              disabled={aiLoading[currentCoinPromptId]}
              className="px-4 py-2 bg-purple-600 text-white rounded-md text-xs font-semibold hover:bg-purple-700 disabled:opacity-50"
            >
              {aiLoading[currentCoinPromptId] ? "Scanning Web..." : `Scan ${selectedCoin} Now`}
            </button>
          </div>

          {/* AI Output Card */}
          {currentCoinLog?.response && (
            <div className="rounded-lg border border-purple-200 bg-purple-50/30 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-purple-100 pb-2">
                <span className="font-bold text-purple-900 text-xs">🤖 Live Analysis: {selectedCoin}</span>
              </div>
              <FormattedAiResponse text={currentCoinLog.response} />
              <div className="pt-2 border-t border-purple-100 flex justify-end">
                <button
                  onClick={() => saveAiResponseToJournal(currentCoinPromptId, `${selectedCoin} Deep Dive`, currentCoinLog.response)}
                  className="px-3 py-1 rounded bg-purple-600 text-white text-xs font-medium"
                >
                  Add to Journal
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Journal Section */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-4 border-b border-gray-100 pb-2">
          🌍 General Market Journal &amp; Notes
        </h3>
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