import { useCatalystsLogic } from "./useCatalystsLogic";

export default function CatalystsView() {
  const {
    selectedCategory,
    setSelectedCategory,
    filteredPrompts,
    copiedId,
    handleCopy,
  } = useCatalystsLogic();

  return (
    <div className="mx-auto max-w-4xl flex flex-col gap-6 py-6 px-4">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900 mb-1">⚡ Crypto Catalyst Tracker &amp; Prompt Library</h1>
        <p className="text-xs text-gray-500 mb-6">
          Click the copy button on any prompt to quickly pull manual updates for macro, exchange news, token unlocks, and batch analysis.
        </p>

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
            filteredPrompts.map((item) => (
              <div
                key={item.id}
                className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50/50 p-4 transition hover:border-purple-200 hover:bg-white"
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-gray-200 text-gray-700 text-[10px] font-bold uppercase px-2 py-0.5">
                      {item.category}
                    </span>
                    <h3 className="font-semibold text-gray-900 text-sm">{item.title}</h3>
                  </div>
                  <p className="text-xs text-gray-600 font-mono bg-white p-2.5 rounded border border-gray-200 mt-2">
                    &ldquo;{item.prompt}&rdquo;
                  </p>
                </div>

                <button
                  onClick={() => handleCopy(item.id, item.prompt)}
                  className={`w-full sm:w-auto px-4 py-2 rounded-md text-xs font-semibold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                    copiedId === item.id
                      ? "bg-green-600 text-white"
                      : "bg-purple-600 text-white hover:bg-purple-700"
                  }`}
                >
                  {copiedId === item.id ? (
                    <>
                      <span>✓</span>
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <span>📋</span>
                      <span>Copy Prompt</span>
                    </>
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}