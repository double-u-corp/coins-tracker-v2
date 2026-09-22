import { useState } from "react";
import {
  useCatalystsLogic,
  buildPortablePrompt,
  type CatalystPrompt,
} from "./useCatalystsLogic";
import Dropdown from "@/components/Dropdown";
import JournalSidebar from "@/features/chart/JournalSidebar";
import FormattedAiResponse from "@/components/FormattedAiResponse";
import { extractJsonArray, attachManilaFields, sortEventsChronologically } from "../../lib/macroEvents";

function MacroEventsList({ rawResponse }: { rawResponse: string }) {
  let events;
  try {
    events = sortEventsChronologically(attachManilaFields(extractJsonArray(rawResponse)));
  } catch {
    return (
      <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-200">
        ⚠️ Couldn&apos;t parse event data — try Re-Scan.
      </div>
    );
  }

  if (events.length === 0) {
    return <p className="text-xs text-gray-500">No scheduled events found.</p>;
  }

  return (
    <div className="space-y-2">
      {events.map((evt: any, idx: number) => (
        <div
          key={idx}
          className={`flex items-center justify-between gap-3 p-2.5 rounded border text-xs ${
            evt.severity === "high" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"
          }`}
        >
          <div className="flex-1">
            <span className="font-bold text-gray-900">{evt.title}</span>
            <span className="ml-2 uppercase text-[10px] font-semibold text-gray-500">{evt.type}</span>
          </div>
          <div className="text-right">
            <div className="font-semibold text-gray-800">{evt.manilaDateKey || evt.date}</div>
            <div className="text-gray-500">{evt.manilaTimeLabel || (evt.approximateTime ? "time TBD" : "")}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

type PromptCardProps = {
  item: CatalystPrompt;
  selectedCoin: string;
  statusInfo: { status: string; label: string };
  cachedData?: { response: string; timestamp: number };
  isLoading: boolean;
  errorMsg?: string;
  copiedId: string | null;
  savedStatus: Record<string, boolean>;
  onCopyPortable: (id: string, text: string) => void;
  onGoogle: (q: string) => void;
  onRun: (item: CatalystPrompt, force: boolean) => void;
  onSaveJournal: (id: string, title: string, text: string) => void;
};

function PromptCard({
  item,
  selectedCoin,
  statusInfo,
  cachedData,
  isLoading,
  errorMsg,
  copiedId,
  savedStatus,
  onCopyPortable,
  onGoogle,
  onRun,
  onSaveJournal,
}: PromptCardProps) {
  const isCurrent = statusInfo.status === "current";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="rounded bg-gray-200 text-gray-700 text-[10px] font-bold uppercase px-2 py-0.5">
            {item.category}
          </span>
          <span
            className={`rounded text-[10px] font-bold uppercase px-2 py-0.5 ${
              item.scope === "global" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
            }`}
          >
            {item.scope === "global" ? "🌐 Market-wide" : `🎯 ${selectedCoin || "Coin"}`}
          </span>
          {item.tier === "deepDive" && (
            <span className="rounded text-[10px] font-bold uppercase px-2 py-0.5 bg-orange-100 text-orange-700">
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
            type="button"
            onClick={() => onCopyPortable(`${item.id}-portable`, buildPortablePrompt(item.prompt))}
            className="px-3.5 py-2 rounded-md text-xs font-semibold bg-gray-700 text-white hover:bg-gray-800 whitespace-nowrap shadow-sm"
          >
            {copiedId === `${item.id}-portable` ? "✅ Copied!" : "🤝 Copy for AI"}
          </button>
          <button
            type="button"
            onClick={() => onGoogle(item.searchQuery)}
            className="px-3.5 py-2 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap shadow-sm"
          >
            🔍 Google
          </button>
          <button
            type="button"
            onClick={() => onRun(item, true)}
            disabled={isLoading}
            className="px-3.5 py-2 rounded-md text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap shadow-sm"
          >
            {isLoading ? "Searching..." : cachedData ? "Re-Scan" : "Run Scan"}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-200">⚠️ {errorMsg}</div>
      )}

      {cachedData?.response && !isLoading && (
        <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-4 mt-2 space-y-3">
          {item.responseFormat === "json" ? (
            <MacroEventsList rawResponse={cachedData.response} />
          ) : (
            <FormattedAiResponse text={cachedData.response} />
          )}
          <div className="pt-2 border-t border-purple-100 flex items-center justify-between">
            <span className="text-[11px] text-gray-400 font-medium">
              Last Updated:{" "}
              {new Date(cachedData.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <button
              type="button"
              onClick={() => onSaveJournal(item.id, item.title, cachedData.response)}
              className="px-3 py-1 rounded bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 transition"
            >
              {savedStatus[item.id] ? "Saved!" : "Add to Journal"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CatalystsView() {
  const {
    selectedCoin,
    setSelectedCoin,
    selectedCategory,
    setSelectedCategory,
    selectedScope,
    setSelectedScope,
    coinOptions,
    coinsLoading,
    coinPrompts,
    globalPrompts,
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

  const [activeTab, setActiveTab] = useState<"scanner" | "library">("scanner");

  const openGoogleSearch = (query: string) => {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
  };

  const renderPromptList = (items: CatalystPrompt[]) =>
    items.map((item) => (
      <PromptCard
        key={item.id}
        item={item}
        selectedCoin={selectedCoin}
        statusInfo={getPromptStatus(item.id, item.category)}
        cachedData={aiCache[item.id]}
        isLoading={!!aiLoading[item.id]}
        errorMsg={aiErrors[item.id]}
        copiedId={copiedId}
        savedStatus={savedStatus}
        onCopyPortable={handleCopy}
        onGoogle={openGoogleSearch}
        onRun={(item) => runAiSearch(item, true)}
        onSaveJournal={saveAiResponseToJournal}
      />
    ));

  return (
    <div className="flex flex-col gap-6">
      {/* Primary mode: Coin vs Market-wide */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSelectedScope("coin")}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
            selectedScope === "coin"
              ? "bg-purple-600 text-white shadow-sm"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          🎯 Coin catalysts
        </button>
        <button
          type="button"
          onClick={() => setSelectedScope("global")}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
            selectedScope === "global"
              ? "bg-blue-600 text-white shadow-sm"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          🌐 Market-wide
        </button>
        <div className="flex gap-1 ml-auto">
          <button
            type="button"
            onClick={() => setActiveTab("scanner")}
            className={`px-3 py-2 rounded-md text-xs font-semibold transition ${
              activeTab === "scanner" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            AI Scanner
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("library")}
            className={`px-3 py-2 rounded-md text-xs font-semibold transition ${
              activeTab === "library" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Prompt library
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">
            {selectedScope === "coin" ? "🎯 Coin catalysts" : "🌐 Market-wide catalysts"}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {selectedScope === "coin"
              ? "News, listings, unlocks, and upcoming events for one tracked coin (from your coins API)."
              : "Fed/CPI, risk-off stress, alt flows, regulation, Coins.ph — same for every asset. No coin required."}
          </p>
        </div>

        {/* Coin picker only in coin mode */}
        {selectedScope === "coin" && (
          <div className="flex flex-wrap items-end gap-4 border-t border-gray-100 pt-4">
            <div className="min-w-[220px] flex-1 max-w-md">
              {coinsLoading ? (
                <p className="text-xs text-gray-400">Loading coins…</p>
              ) : coinOptions.length === 0 ? (
                <p className="text-xs text-amber-700">No coins from API. Add coins on the manage page first.</p>
              ) : (
                <Dropdown
                  label="Coin"
                  placeholder="Select a coin"
                  value={selectedCoin}
                  onChange={setSelectedCoin}
                  options={coinOptions}
                />
              )}
            </div>
            <div className="flex items-center gap-3 pb-1">
              <div>
                <span className="text-xs font-semibold text-gray-700">Deep Dive</span>
                <p className="text-[10px] text-gray-500">Social & competitive (opt-in)</p>
              </div>
              <button
                type="button"
                onClick={() => selectedCoin && toggleDeepDive(selectedCoin)}
                disabled={!selectedCoin}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition whitespace-nowrap disabled:opacity-40 ${
                  isDeepDiveOn
                    ? "bg-orange-500 text-white hover:bg-orange-600"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {isDeepDiveOn ? "ON" : "OFF"}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2 border-t border-gray-100 pt-4 overflow-x-auto">
          {["All", "Live", "Weekly", "Monthly", "Macro"].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition whitespace-nowrap ${
                selectedCategory === cat
                  ? selectedScope === "coin"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "bg-blue-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-gray-400">
          {filteredPrompts.length} prompt{filteredPrompts.length === 1 ? "" : "s"}
          {selectedScope === "coin" && selectedCoin ? ` · ${selectedCoin}` : ""}
        </p>
      </div>

      {activeTab === "scanner" && (
        <>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
            {selectedScope === "coin" && !selectedCoin && (
              <p className="text-sm text-gray-500">Select a coin to load catalysts.</p>
            )}
            {selectedScope === "coin" && selectedCoin && coinPrompts.length === 0 && (
              <p className="text-sm text-gray-500">No prompts for this category.</p>
            )}
            {selectedScope === "global" && globalPrompts.length === 0 && (
              <p className="text-sm text-gray-500">No market-wide prompts for this category.</p>
            )}
            <div className="space-y-4">
              {selectedScope === "coin" && selectedCoin ? renderPromptList(coinPrompts) : null}
              {selectedScope === "global" ? renderPromptList(globalPrompts) : null}
            </div>
          </div>

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
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <p className="text-xs text-gray-500">
            Copy self-contained prompts into Gemini / Copilot / other AIs. Same filters as the scanner.
          </p>
          {(selectedScope === "coin" ? coinPrompts : globalPrompts).map((item) => {
            const libraryId = `${item.id}-library`;
            return (
              <div key={item.id} className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-2">
                <h3 className="font-semibold text-gray-900 text-sm">{item.title}</h3>
                <p className="text-xs text-gray-600 font-mono bg-white p-2 rounded border border-gray-200 whitespace-pre-wrap">
                  {buildPortablePrompt(item.prompt)}
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleCopy(libraryId, buildPortablePrompt(item.prompt))}
                    className="px-3.5 py-2 rounded-md text-xs font-semibold bg-gray-700 text-white hover:bg-gray-800"
                  >
                    {copiedId === libraryId ? "✅ Copied!" : "📋 Copy Prompt"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
