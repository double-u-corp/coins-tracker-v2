import React from "react";

interface Props {
  text: string;
}

export default function FormattedAiResponse({ text }: Props) {
  // Split text into lines to preserve bullet lists and structure
  const lines = text.split("\n");

  return (
    <div className="space-y-2 text-xs text-gray-800 leading-relaxed font-sans">
      {lines.map((line, lineIdx) => {
        if (!line.trim()) return <div key={lineIdx} className="h-1" />;

        return (
          <p key={lineIdx} className={line.trim().startsWith("-") || line.trim().startsWith("*") ? "pl-3" : ""}>
            {renderFormattedLine(line)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Parses markdown bolding (**bold**) and citation brackets 【url】 or 【source】 into styled React elements
 */
function renderFormattedLine(line: string) {
  // Regex to match citation brackets: 【https://...】 or 【Source Name】
  const citationRegex = /【([^】]+)】/g;
  
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = citationRegex.exec(line)) !== null) {
    const textBefore = line.substring(lastIndex, match.index);
    if (textBefore) {
      parts.push(...parseBoldText(textBefore, `text-${lastIndex}`));
    }

    const content = match[1].trim();
    const isUrl = content.startsWith("http://") || content.startsWith("https://");

    if (isUrl) {
      // Extract domain for clean link badge display
      let domain = "Source";
      try {
        domain = new URL(content).hostname.replace("www.", "");
      } catch (_) {}

      parts.push(
        <a
          key={`link-${match.index}`}
          href={content}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 font-medium text-[11px] transition-colors"
        >
          <span>🌐 {domain}</span>
          <span>↗</span>
        </a>
      );
    } else {
      // Render source names as styled metadata tags
      parts.push(
        <span
          key={`tag-${match.index}`}
          className="inline-block mx-1 px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-medium text-[10px]"
        >
          {content}
        </span>
      );
    }

    lastIndex = citationRegex.lastIndex;
  }

  const remainingText = line.substring(lastIndex);
  if (remainingText) {
    parts.push(...parseBoldText(remainingText, `text-end`));
  }

  return parts;
}

/**
 * Parses bold text formatted as **text**
 */
function parseBoldText(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-bold-${index}`} className="font-bold text-gray-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}