"use client";

import { useState, useEffect } from "react";

type Section = {
  id: string;
  parentSectionId: string | null;
  title: string;
  level: string;
  orderIndex: number;
  summary: string;
};

type ContentData = {
  section: Section;
  children: Section[];
  chunks: { id: string; content: string; imageUrl: string | null }[];
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "mentor"; content: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toc, setToc] = useState<Section[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [contentData, setContentData] = useState<ContentData | null>(null);
  const [expandedTextIds, setExpandedTextIds] = useState<Set<string>>(new Set());

  type TreeNodeData = Section & { childNodes: TreeNodeData[] };

  // Recursively build tree
  const buildTree = (parentId: string | null): TreeNodeData[] => {
    return toc.filter(s => s.parentSectionId === parentId).map(s => ({
      ...s,
      childNodes: buildTree(s.id)
    }));
  };

  useEffect(() => {
    async function fetchToc() {
      try {
        const res = await fetch("/api/toc");
        if (res.ok) {
          const data = await res.json();
          setToc(data.sections || []);
        }
      } catch (err) {
        console.error("Failed to load ToC", err);
      }
    }
    fetchToc();
  }, []);

  const handleTocClick = async (section: Section) => {
    setActiveSectionId(section.id);
    setContentData(null); // loading state
    setExpandedTextIds(new Set()); // reset expansions

    try {
      const res = await fetch(`/api/toc/${section.id}/content`);
      if (res.ok) {
        const data = await res.json();
        setContentData(data);
      }
    } catch (err) {
      console.error("Failed to load content.", err);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedTextIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const askAiAbout = (concept: string) => {
    setQuery(`Can you explain: ${concept}`);
    // Focus the chat input? Let's just set the query text so they can press Enter or Ask.
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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

  // Render tree node recursive component
  const TreeNode = ({ node, depth = 0 }: { node: any, depth?: number }) => {
    const isSelected = activeSectionId === node.id;
    return (
      <div className="w-full">
        <div 
          onClick={() => handleTocClick(node)}
          className={`cursor-pointer px-3 py-1.5 text-sm hover:bg-gray-100 transition rounded-md border-l-2 ${isSelected ? "bg-indigo-50 border-indigo-500 font-semibold text-indigo-800" : "border-transparent text-gray-700 font-medium"}`}
          style={{ paddingLeft: `${Math.max(0.75, depth * 1.5)}rem` }}
        >
          {node.title}
        </div>
        {node.childNodes && node.childNodes.length > 0 && (
          <div className="flex flex-col gap-0.5 mt-0.5">
            {node.childNodes.map((child: any) => (
              <TreeNode key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const rootNodes = buildTree(null);

  // Fallback flat list if tree is broken
  const nodesToRender = rootNodes.length > 0 ? rootNodes : toc.filter(t => !t.parentSectionId);

  return (
    <div className="flex h-screen bg-white text-gray-900 font-sans overflow-hidden">
      
      {/* Pane 1: Table of Contents */}
      <aside className="w-64 border-r border-gray-200 flex flex-col bg-gray-50 shrink-0">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">Table of Contents</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {toc.length === 0 ? (
            <div className="text-gray-400 text-sm italic p-2 text-center">Loading contents...</div>
          ) : (
            <div className="flex flex-col gap-1">
              {nodesToRender.map((node) => (
                <TreeNode key={node.id} node={node} />
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Pane 2: Content Breakdown */}
      <main className="flex-1 border-r border-gray-200 overflow-y-auto bg-white relative">
        <header className="sticky top-0 bg-white/90 backdrop-blur-sm border-b border-gray-100 p-6 z-10">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            {contentData?.section?.title || "Welcome to DDIA Mentor"}
          </h1>
        </header>

        <div className="p-8 max-w-4xl">
          {!contentData ? (
            <div className="text-gray-400 text-center mt-20">Select a section from the sidebar to view concepts.</div>
          ) : (
            <div className="flex flex-col gap-8">
              
              {/* If section has children, render them as subtopics */}
              {contentData.children.length > 0 && (
                <div className="flex flex-col gap-6">
                  {contentData.children.map(child => (
                    <div key={child.id} className="p-5 border border-gray-200 rounded-xl shadow-sm bg-white hover:border-gray-300 transition">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <h3 className="text-lg font-bold text-gray-900 mb-2">{child.title}</h3>
                          <p className="text-gray-600 leading-relaxed text-sm">{child.summary}</p>
                        </div>
                      </div>
                      <div className="mt-4 flex gap-3">
                        <button 
                          onClick={() => {
                            // Actually, fetching full text for a child requires fetching its chunks.
                            // We can just set the active section to this child instead!
                            handleTocClick(child);
                          }}
                          className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100"
                        >
                          View complete breakdown
                        </button>
                        <button 
                          onClick={() => askAiAbout(child.title)}
                          className="text-xs font-semibold text-gray-600 bg-gray-100 px-3 py-1.5 rounded-lg hover:bg-gray-200 flex items-center gap-1"
                        >
                          Ask AI about this
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Text Chunks and Diagrams (Rendered if this is a leaf node or has chunks) */}
              {contentData.chunks.length > 0 && (
                <div className="flex flex-col gap-8 mt-4">
                  {contentData.chunks.map((chunk, idx) => (
                    <div key={chunk.id} className="flex flex-col gap-4">
                      {chunk.imageUrl && (
                        <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm max-w-2xl">
                          <img src={chunk.imageUrl} alt="Extracted diagram" className="w-full object-contain bg-gray-50" />
                        </div>
                      )}
                      
                      <div className="flex items-start gap-4">
                        <div className="flex-1 text-gray-700 leading-relaxed text-sm whitespace-pre-wrap">
                          {/* If expanded, show full chunk, else show first 150 chars as summary */}
                          {expandedTextIds.has(chunk.id) ? chunk.content : `${chunk.content.substring(0, 200).trim()}...`}
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <button 
                          onClick={() => toggleExpand(chunk.id)}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          {expandedTextIds.has(chunk.id) ? "Collapse text" : "Expand full text"}
                        </button>
                        <button 
                          onClick={() => askAiAbout(`the concept starting with "${chunk.content.substring(0, 30)}..."`)}
                          className="text-xs font-semibold text-gray-500 hover:text-gray-800"
                        >
                          Ask AI about this
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </div>
          )}
        </div>
      </main>

      {/* Pane 3: AI Chat */}
      <aside className="w-96 flex flex-col shrink-0 bg-gray-50">
        <header className="p-5 border-b border-gray-200 bg-white">
          <h2 className="text-lg font-bold tracking-tight text-indigo-600 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
            </svg>
            AI Chat
          </h2>
        </header>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-10 px-4 text-sm">
              I am your DDIA study companion. Click "Ask AI about this" on any concept, or just type a question below!
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[90%] rounded-2xl px-4 py-3 shadow-sm text-sm ${msg.role === "user" ? "bg-indigo-600 text-white rounded-tr-sm" : "bg-white border border-gray-200 text-gray-800 rounded-tl-sm"}`}>
                <div className="font-bold text-[10px] mb-1 opacity-60 uppercase tracking-wider">
                  {msg.role === "user" ? "You" : "Mentor"}
                </div>
                <div className="leading-relaxed whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 text-gray-500 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm text-sm flex items-center gap-2">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-indigo-600"></div>
                Thinking...
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-white border-t border-gray-200">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="Ask a question..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition shadow-sm disabled:opacity-50 text-sm"
            >
              Send
            </button>
          </form>
        </div>
      </aside>

    </div>
  );
}
