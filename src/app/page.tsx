"use client";

import { useState } from "react";

export default function Home() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "mentor"; content: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      <header className="py-6 bg-white shadow-sm px-8 flex flex-col justify-center items-center">
        <h1 className="text-3xl font-bold tracking-tight text-indigo-600">DDIA Data Engineering Mentor</h1>
        <p className="text-gray-500 mt-2">Powered by Llama 3.3 70B, Together AI, and Neon pgvector</p>
      </header>

      <main className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full">
        <div className="flex flex-col gap-6">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <p className="text-xl">Ask me anything about Designing Data-Intensive Applications!</p>
              <p className="text-sm mt-2">Try: "What is the difference between synchronous and asynchronous replication?"</p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-6 py-4 shadow-sm ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-gray-200 text-gray-800"
                }`}
              >
                <div className="font-semibold text-xs mb-1 opacity-70 uppercase tracking-wider">
                  {msg.role === "user" ? "You" : "Mentor"}
                </div>
                <div className="leading-relaxed whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 text-gray-500 rounded-2xl px-6 py-4 shadow-sm">
                Thinking and searching DDIA...
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="p-6 bg-white border-t border-gray-200">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex gap-4">
          <input
            type="text"
            className="flex-1 rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Ask a data engineering question..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-medium hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Ask
          </button>
        </form>
      </footer>
    </div>
  );
}
