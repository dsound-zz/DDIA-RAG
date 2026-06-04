"use client";

import { useState, useEffect } from "react";

type Section = {
  id: string;
  title: string;
  level: string;
  orderIndex: number;
  summary: string;
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "mentor"; content: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toc, setToc] = useState<Section[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isReaderOpen, setIsReaderOpen] = useState(false);
  const [readerContent, setReaderContent] = useState<{ title: string, text: string, isLoading: boolean } | null>(null);

  useEffect(() => {
    async function fetchToc() {
      try {
        const res = await fetch("/api/toc");
        if (res.ok) {
          const data = await res.json();
          // Filter to avoid duplicating rows if ingestion was run multiple times for testing
          // Group by title to remove exact duplicates for a cleaner UI
          const uniqueSections = data.sections.reduce((acc: Section[], current: Section) => {
            const x = acc.find(item => item.title === current.title);
            if (!x) {
              return acc.concat([current]);
            } else {
              return acc;
            }
          }, []);
          setToc(uniqueSections);
        }
      } catch (err) {
        console.error("Failed to load ToC", err);
      }
    }
    fetchToc();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    const userMessage = { role: "user" as const, content: query };
    setMessages((prev) => [...prev, userMessage]);
    setQuery("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage.content }),
      });

      const data = await res.json();
      
      if (res.ok) {
        setMessages((prev) => [...prev, { role: "mentor", content: data.reply }]);
      } else {
        setMessages((prev) => [...prev, { role: "mentor", content: `Error: ${data.error}` }]);
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: "mentor", content: "Failed to fetch response." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTocClick = async (section: Section) => {
    // 1. Drop summary in chat
    setMessages((prev) => [
      ...prev,
      { role: "mentor", content: `**${section.title} (Summary):**\n\n${section.summary}` }
    ]);

    // 2. Open Reader and fetch full text
    setIsReaderOpen(true);
    setReaderContent({ title: section.title, text: "", isLoading: true });

    try {
      const res = await fetch(`/api/toc/${section.id}/text`);
      if (res.ok) {
        const data = await res.json();
        setReaderContent({ title: section.title, text: data.text, isLoading: false });
      } else {
        setReaderContent({ title: section.title, text: "No text found for this section yet. The ingestion script may still be running.", isLoading: false });
      }
    } catch (err) {
      setReaderContent({ title: section.title, text: "Failed to load full text.", isLoading: false });
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans overflow-hidden">
      
      {/* Sidebar (Table of Contents) */}
      <aside className={`${isSidebarOpen ? "w-80" : "w-0"} transition-all duration-300 ease-in-out bg-white border-r border-gray-200 flex flex-col overflow-hidden`}>
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Table of Contents</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {toc.length === 0 ? (
            <div className="text-gray-400 text-sm italic p-4 text-center">Loading contents...</div>
          ) : (
            <ul className="space-y-3">
              {toc.map((section) => (
                <li key={section.id} className="group cursor-pointer">
                  <div 
                    onClick={() => handleTocClick(section)}
                    className="p-3 rounded-lg hover:bg-indigo-50 border border-transparent hover:border-indigo-100 transition"
                  >
                    <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wide mb-1">
                      {section.level}
                    </div>
                    <div className="text-sm font-medium text-gray-800 group-hover:text-indigo-700 leading-snug">
                      {section.title}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="py-5 bg-white shadow-sm px-6 flex justify-between items-center z-10">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
              title="Toggle Sidebar"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-indigo-600">DDIA Mentor</h1>
              <p className="text-xs sm:text-sm text-gray-500">Powered by Llama 3.3 70B & pgvector</p>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8 w-full bg-gray-50">
          <div className="flex flex-col gap-6 max-w-4xl mx-auto">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 mt-20 px-4">
                <p className="text-lg sm:text-xl text-gray-500 font-medium">Ask me anything about Designing Data-Intensive Applications!</p>
                <p className="text-sm mt-3 bg-white border border-gray-200 inline-block px-4 py-2 rounded-full shadow-sm">
                  Try: "What is the difference between synchronous and asynchronous replication?"
                </p>
                <p className="text-sm mt-3 bg-white border border-gray-200 inline-block px-4 py-2 rounded-full shadow-sm ml-2">
                  Or click any section in the sidebar for a summary.
                </p>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-5 py-4 shadow-sm ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-tr-sm"
                      : "bg-white border border-gray-200 text-gray-800 rounded-tl-sm"
                  }`}
                >
                  <div className="font-semibold text-[10px] sm:text-xs mb-1 opacity-70 uppercase tracking-wider">
                    {msg.role === "user" ? "You" : "Mentor"}
                  </div>
                  <div className="text-sm sm:text-base leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 text-gray-500 rounded-2xl rounded-tl-sm px-6 py-4 shadow-sm text-sm flex items-center gap-3">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                  Thinking and searching DDIA...
                </div>
              </div>
            )}
          </div>
        </main>

        <footer className="p-4 sm:p-6 bg-white border-t border-gray-200 z-10">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex gap-3">
            <input
              type="text"
              className="flex-1 rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm sm:text-base shadow-sm"
              placeholder="Ask a data engineering question..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="bg-indigo-600 text-white px-6 sm:px-8 py-3 rounded-xl font-medium hover:bg-indigo-700 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
            >
              Ask
            </button>
          </form>
        </footer>
      </div>

      {/* Right Slide-out Reader Panel */}
      <aside className={`${isReaderOpen ? "w-96 border-l" : "w-0"} transition-all duration-300 ease-in-out bg-white border-gray-200 flex flex-col overflow-hidden`}>
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h2 className="text-sm font-bold text-gray-800 line-clamp-1 pr-4">{readerContent?.title || "Reading View"}</h2>
          <button 
            onClick={() => setIsReaderOpen(false)}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          {readerContent?.isLoading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
            </div>
          ) : (
            <div className="prose prose-sm prose-indigo max-w-none whitespace-pre-wrap text-gray-700 leading-relaxed">
              {readerContent?.text}
            </div>
          )}
        </div>
      </aside>

    </div>
  );
}
