import { useState } from "react";
import { useCatalystsLogic, AVAILABLE_TOKENS, buildPortablePrompt } from "./useCatalystsLogic";
import JournalSidebar from "@/features/chart/JournalSidebar";
import FormattedAiResponse from "@/components/FormattedAiResponse";
import { extractJsonArray, attachManilaFields, sortEventsChronologically } from "../../lib/macroEvents";

function MacroEventsList({ rawResponse }: { rawResponse: string }) {
  let events;
  try {
    events = sortEventsChronologically(attachManilaFields(extractJsonArray(rawResponse)));
  } catch (e) {
    return (
      <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-200">
        ⚠️ Couldn't parse event data — try Re-Scan.
      </div>
    );
  }

  if (events.length === 0) {
    return <p className="text-xs text-gray-500">No scheduled events found.</p>;
  }

  return (
    <div className="space-y-2">
      {events.map((evt, idx) => (
        <div
          key={idx}
          className={`flex items-center justify-between gap-3 p-2.5 rounded border text-xs ${
            evt.severity === "high"
              ? "bg-red-50 border-red-200"
              : "bg-amber-50 border-amber-200"
          }`}
        >
          <div className="flex-1">
            <span className="font-bold text-gray-900">{evt.title}</span>
            <span className="ml-2 uppercase text-[10px] font-semibold text-gray-500">{evt.type}</span>
          </div>
          <div className="text-right">
            <div className="font-semibold text-gray-800">
              {evt.manilaDateKey || evt.date}
            </div>
            <div className="text-gray-500">
              {evt.manilaTimeLabel || (evt.approximateTime ? "time TBD" : "")}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CatalystsView() {
  const {
    selectedCoin,
    setSelectedCoin,
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
    isDeepDiveOn,
    toggleDeepDive,
  } = useCatalystsLogic();

  // Top-level view switch: the normal AI-scanner UI, or the Prompt Library
  // — a plain list of the same prompts (wrapped to be self-contained) meant
  // purely for copy-pasting into other AI platforms (Gemini, Copilot, a
  // Groq chat UI, etc.), so research isn't dependent on a single model.
  const [activeTab, setActiveTab] = useState<"scanner" | "library">("scanner");

  // Local, UI-only state for the "search on Google instead" escape hatch —
  // deliberately NOT routed through the AI pipeline at all: zero API cost,
  // zero hallucination risk, and gives the raw unfiltered result set for
  // exactly the moment the AI summary isn't trusted or isn't finding it.
  const openGoogleSearch = (query: string) => {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Tab Switcher */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab("scanner")}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
            activeTab === "scanner"
              ? "bg-purple-600 text-white shadow-sm"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          ⚡ AI Scanner
        </button>
        <button
          onClick={() => setActiveTab("library")}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
            activeTab === "library"
              ? "bg-gray-700 text-white shadow-sm"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          📚 Prompt Library
        </button>
      </div>

      {/* Shared controls — visible on both tabs so filter/selection state is
          never invisible depending on which tab you're looking at */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>⚡</span> Single Coin Catalyst Intelligence
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Select an asset to scan breaking news, derivatives, on-chain movements, and market catalysts.
          </p>
        </div>

        {/* Token Pill Selection */}
        <div className="flex flex-wrap gap-2 pt-1">
          {AVAILABLE_TOKENS.map((token) => (
            <button
              key={token}
              onClick={() => setSelectedCoin(token)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                selectedCoin === token
                  ? "bg-purple-600 text-white shadow-sm scale-105"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {token}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <div>
            <span className="text-xs font-semibold text-gray-700">🔬 Deep Dive for {selectedCoin}</span>
            <p className="text-[10px] text-gray-500">
              Adds Social Sentiment & Competitive Positioning scans — more speculative, so off by default.
            </p>
          </div>
          <button
            onClick={() => toggleDeepDive(selectedCoin)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition whitespace-nowrap ${
              isDeepDiveOn
                ? "bg-orange-500 text-white hover:bg-orange-600"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {isDeepDiveOn ? "Deep Dive: ON" : "Deep Dive: OFF"}
          </button>
        </div>

        {/* Category Filters — also shared, so both tabs always show what's
            actually being filtered on, instead of one tab hiding the state
            the other tab set. */}
        <div className="flex gap-2 border-t border-gray-100 pt-4 overflow-x-auto">
          {["All", "Live", "Weekly", "Monthly", "Macro"].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition whitespace-nowrap ${
                selectedCategory === cat
                  ? "bg-purple-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-gray-400">
          Showing <strong>{filteredPrompts.length}</strong> prompt{filteredPrompts.length === 1 ? "" : "s"} for{" "}
          {selectedCategory === "All" ? "all categories" : `"${selectedCategory}"`} — this applies to both tabs.
        </p>
      </div>

      {activeTab === "scanner" && (
        <>
      {/* Main Scanner Section */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-6">
        {(selectedCategory === "Macro" || selectedCategory === "All") && (
          <div className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-md p-2.5">
            🌐 Items marked <strong>All Coins</strong> are market-wide (Fed calendar, DXY, geopolitics,
            Coins.ph listings) — they don't change when you switch the selected coin above. Only items
            marked with the coin's own badge are specific to it.
          </div>
        )}

        {/* Active Prompts Grid */}
        <div className="space-y-4">
          {filteredPrompts.map((item) => {
            const statusInfo = getPromptStatus(item.id, item.category);
            const cachedData = aiCache[item.id];
            const isCurrent = statusInfo.status === "current";
            const isLoading = aiLoading[item.id];
            const errorMsg = aiErrors[item.id];

            return (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50/50 p-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded bg-gray-200 text-gray-700 text-[10px] font-bold uppercase px-2 py-0.5">
                      {item.category}
                    </span>
                    <span
                      className={`rounded text-[10px] font-bold uppercase px-2 py-0.5 ${
                        item.scope === "global"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-purple-100 text-purple-700"
                      }`}
                      title={
                        item.scope === "global"
                          ? "Same result regardless of which coin is selected"
                          : `Specific to ${selectedCoin}`
                      }
                    >
                      {item.scope === "global" ? "🌐 All Coins" : `🎯 ${selectedCoin}`}
                    </span>
                    {item.tier === "deepDive" && (
                      <span
                        className="rounded text-[10px] font-bold uppercase px-2 py-0.5 bg-orange-100 text-orange-700"
                        title="More speculative — only shown because Deep Dive is enabled"
                      >
                        🔬 Deep Dive
                      </span>
                    )}
                    <h3 className="font-semibold text-gray-900 text-sm">{item.title}</h3>
                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded border ${
                        statusInfo.status === "current"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : statusInfo.status === "expired"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-gray-100 text-gray-500 border-gray-200"
                      }`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>

                  <p className="text-xs text-gray-600 font-mono bg-white p-2 rounded border border-gray-200 mt-1">
                    &ldquo;{item.prompt}&rdquo;
                  </p>

                  <div className="flex justify-end gap-2 pt-1 flex-wrap">
                    <button
                      onClick={() => handleCopy(`${item.id}-portable`, buildPortablePrompt(item.prompt))}
                      title="Copy a self-contained version of this prompt to paste into Gemini, Copilot, or another AI"
                      className="px-3.5 py-2 rounded-md text-xs font-semibold bg-gray-700 text-white hover:bg-gray-800 whitespace-nowrap shadow-sm"
                    >
                      {copiedId === `${item.id}-portable` ? "✅ Copied!" : "🤝 Copy for AI"}
                    </button>
                    <button
                      onClick={() => openGoogleSearch(item.searchQuery)}
                      title={`Search Google for: ${item.searchQuery}`}
                      className="px-3.5 py-2 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap shadow-sm"
                    >
                      🔍 Google
                    </button>
                    <button
                      onClick={() => runAiSearch(item, !isCurrent)}
                      disabled={isLoading}
                      className="px-3.5 py-2 rounded-md text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap shadow-sm"
                    >
                      {isLoading ? "Searching..." : cachedData ? "Re-Scan" : "Run Scan"}
                    </button>
                  </div>
                </div>

                {errorMsg && (
                  <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-200">
                    ⚠️ {errorMsg}
                  </div>
                )}

                {/* AI Analysis Result */}
                {cachedData?.response && !isLoading && (
                  <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-4 mt-2 space-y-3">
                    {item.responseFormat === "json" ? (
                      <MacroEventsList rawResponse={cachedData.response} />
                    ) : (
                      <FormattedAiResponse text={cachedData.response} />
                    )}
                    <div className="pt-2 border-t border-purple-100 flex items-center justify-between">
                      <span className="text-[11px] text-gray-400 font-medium">
                        Last Updated: {new Date(cachedData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <button
                        onClick={() => saveAiResponseToJournal(item.id, item.title, cachedData.response)}
                        className="px-3 py-1 rounded bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 transition"
                      >
                        {savedStatus[item.id] ? "Saved!" : "Add to Journal"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

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
        </>
      )}

      {activeTab === "library" && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <span>📚</span> Prompt Library — Cross-Check on Other AI Platforms
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Each prompt below is self-contained (includes a web-search instruction and today's date) so you
              can paste it directly into Gemini, Copilot, a Groq chat, or any other AI — widening your research
              beyond a single model. Use the coin selector and category filters above to change which prompts
              appear here.
            </p>
          </div>

          <div className="space-y-3">
            {filteredPrompts.map((item) => {
              const libraryId = `${item.id}-library`;
              return (
                <div key={item.id} className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded bg-gray-200 text-gray-700 text-[10px] font-bold uppercase px-2 py-0.5">
                      {item.category}
                    </span>
                    <span
                      className={`rounded text-[10px] font-bold uppercase px-2 py-0.5 ${
                        item.scope === "global" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                      }`}
                    >
                      {item.scope === "global" ? "🌐 All Coins" : `🎯 ${selectedCoin}`}
                    </span>
                    {item.tier === "deepDive" && (
                      <span className="rounded text-[10px] font-bold uppercase px-2 py-0.5 bg-orange-100 text-orange-700">
                        🔬 Deep Dive
                      </span>
                    )}
                    <h3 className="font-semibold text-gray-900 text-sm">{item.title}</h3>
                  </div>

                  <p className="text-xs text-gray-600 font-mono bg-white p-2 rounded border border-gray-200 whitespace-pre-wrap">
                    {buildPortablePrompt(item.prompt)}
                  </p>

                  <div className="flex justify-end">
                    <button
                      onClick={() => handleCopy(libraryId, buildPortablePrompt(item.prompt))}
                      className="px-3.5 py-2 rounded-md text-xs font-semibold bg-gray-700 text-white hover:bg-gray-800 whitespace-nowrap shadow-sm"
                    >
                      {copiedId === libraryId ? "✅ Copied!" : "📋 Copy Prompt"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}