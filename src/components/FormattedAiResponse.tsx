import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface FormattedAiResponseProps {
  text: string;
}

export default function FormattedAiResponse({ text }: FormattedAiResponseProps) {
  // Pre-process text to clean bracket citations and prevent UI breaks on truncated text
  const cleanMarkdownText = (rawText: string) => {
    if (!rawText) return "";
    return rawText
      // Convert 【domain.com (Title)】 into *(Source: domain.com)*
      .replace(/【([^】]+)】/g, (_, match) => ` *(${match})*`)
      // Remove orphaned/truncated brackets at the end of cut-off responses
      .replace(/【[^】]*$/g, "");
  };

  return (
    <div className="prose prose-purple max-w-none text-xs text-gray-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Styled External Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-600 hover:text-purple-800 underline font-medium"
            >
              {children}
            </a>
          ),

          // Styled Markdown Tables
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-purple-200 shadow-sm">
              <table className="w-full border-collapse bg-white text-left text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-purple-100/70 border-b border-purple-200 text-purple-900 font-bold">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-3.5 py-2.5 text-[11px] font-bold tracking-wider text-purple-950 uppercase">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3.5 py-2 border-t border-purple-100 text-gray-700 leading-relaxed">
              {children}
            </td>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-purple-50/50 transition-colors">{children}</tr>
          ),

          // Headings & Text Formatting
          h1: ({ children }) => (
            <h1 className="text-sm font-bold text-gray-900 mt-3 mb-1">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xs font-bold text-purple-900 uppercase tracking-wide mt-3 mb-1.5 border-b border-purple-100 pb-1">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs font-semibold text-gray-900 mt-2 mb-1">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="text-xs leading-relaxed text-gray-700 my-1.5">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-gray-900">{children}</strong>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="list-disc list-inside space-y-1 my-2 text-xs text-gray-700">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside space-y-1 my-2 text-xs text-gray-700">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,

          // Quotes & Notes
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-purple-400 bg-purple-50/60 pl-3 py-1.5 my-2 text-xs italic text-gray-700 rounded-r">
              {children}
            </blockquote>
          ),
        }}
      >
        {cleanMarkdownText(text)}
      </ReactMarkdown>
    </div>
  );
}