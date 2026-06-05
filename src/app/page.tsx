"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────
type Section = {
  id: string;
  parentSectionId: string | null;
  title: string;
  level: string;
  orderIndex: number;
  summary: string | null;
};

type ChildSection = Section & {
  chunkCount: number;
  chunks: never[];
};

type ContentData = {
  section: Section;
  children: ChildSection[];
  chunks: never[];
};

type TreeNodeData = Section & { childNodes: TreeNodeData[] };
type ChatMessage = { role: "user" | "mentor"; content: string };
type SavedArtifact = {
  id: string;
  sectionId: string | null;
  title: string;
  content: string;
  artifactType: string;
  createdAt: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────

function parseSummaryIntoBullets(summaryText: string): string[] {
  if (!summaryText) return [];
  const bulletPattern = /(?:^|\n)\s*(?:\*|-|•)\s+/;
  const rawBullets = summaryText.split(bulletPattern).filter(b => b.trim().length > 0);
  if (rawBullets.length <= 1) {
    const numberedPattern = /(?:^|\n)\s*\d+[.)]\s+/;
    const numberedBullets = summaryText.split(numberedPattern).filter(b => b.trim().length > 0);
    if (numberedBullets.length > 1) return numberedBullets.map(b => b.trim());
  }
  return rawBullets.map(b => b.trim());
}

function isGarbageSummary(summaryText: string): boolean {
  const garbageIndicators = [
    "no concepts provided", "no text to extract", "empty input", "insufficient data",
    "there is no text", "the input is empty", "concept extraction", "knowledge distillation",
    "information retention", "no meaningful concepts", "cannot extract", "nothing to summarize",
  ];
  return garbageIndicators.some(ind => summaryText.toLowerCase().includes(ind));
}

// ─── Level styling ───────────────────────────────────────────────────
const levelStyles: Record<string, string> = {
  part: "font-bold text-gray-900 text-[13px] uppercase tracking-wider",
  chapter: "font-semibold text-gray-800 text-[13px]",
  section: "font-medium text-gray-600 text-[13px]",
  subsection: "font-normal text-gray-500 text-[12.5px]",
};
const levelIndent: Record<string, number> = { part: 0.5, chapter: 1, section: 1.5, subsection: 2 };

// ─── Bullet List ─────────────────────────────────────────────────────

function BulletList({ summaryText, onAskAi }: { summaryText: string; onAskAi?: (concept: string) => void }) {
  if (isGarbageSummary(summaryText)) return null;
  const bullets = parseSummaryIntoBullets(summaryText);
  if (bullets.length === 0) return null;
  return (
    <ul className="flex flex-col gap-4">
      {bullets.map((bullet, bulletIndex) => {
        const colonIndex = bullet.indexOf(":");
        const hasLabel = colonIndex > 0 && colonIndex < 60;
        const conceptName = hasLabel ? bullet.substring(0, colonIndex).trim() : bullet.substring(0, 50).trim();
        return (
          <li key={bulletIndex} className="group flex gap-3 items-start">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2.5 shrink-0" />
            <div className="flex-1">
              <div className="text-[14px] text-gray-700 leading-relaxed">
                {hasLabel ? (
                  <>
                    <span className="font-semibold text-gray-900">{bullet.substring(0, colonIndex)}</span>
                    <span className="text-gray-600">{bullet.substring(colonIndex)}</span>
                  </>
                ) : (
                  <span>{bullet}</span>
                )}
              </div>
              {onAskAi && (
                <button
                  onClick={() => onAskAi(conceptName)}
                  className="mt-1.5 text-[11px] font-semibold text-gray-400 hover:text-indigo-600 transition flex items-center gap-1 opacity-0 group-hover:opacity-100"
                >
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  Ask AI about this
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Main Component ──────────────────────────────────────────────────
export default function Home() {
  const [query, setQuery] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [tableOfContents, setTableOfContents] = useState<Section[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [contentData, setContentData] = useState<ContentData | null>(null);
  const [isContentLoading, setIsContentLoading] = useState(false);
  const [collapsedTocNodes, setCollapsedTocNodes] = useState<Set<string>>(new Set());
  const [savedArtifacts, setSavedArtifacts] = useState<SavedArtifact[]>([]);
  const [isArtifactsPanelOpen, setIsArtifactsPanelOpen] = useState(false);
  const [savingMessageIndex, setSavingMessageIndex] = useState<number | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const tocActiveRef = useRef<HTMLDivElement>(null);

  // ─── Build tree ────────────────────────────────────────────────────
  const buildTree = useCallback((parentId: string | null): TreeNodeData[] => {
    return tableOfContents
      .filter(s => s.parentSectionId === parentId)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map(s => ({ ...s, childNodes: buildTree(s.id) }));
  }, [tableOfContents]);

  const rootNodes = useMemo(() => buildTree(null), [buildTree]);

  // ─── Fetch TOC + artifacts on mount ────────────────────────────────
  useEffect(() => {
    fetch("/api/toc").then(r => r.ok ? r.json() : null).then(d => d && setTableOfContents(d.sections || [])).catch(() => {});
    fetch("/api/artifacts").then(r => r.ok ? r.json() : null).then(d => d && setSavedArtifacts(d.artifacts || [])).catch(() => {});
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, isChatLoading]);

  // ─── Section click ─────────────────────────────────────────────────
  const handleSectionClick = async (section: Section) => {
    setActiveSectionId(section.id);
    setContentData(null);
    setIsContentLoading(true);
    try {
      const response = await fetch(`/api/toc/${section.id}/content`);
      if (response.ok) setContentData(await response.json());
    } catch (fetchError) { console.error("Failed to load content.", fetchError); }
    finally { setIsContentLoading(false); }
  };

  // ─── TOC collapse toggle ──────────────────────────────────────────
  const toggleTocCollapse = (nodeId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setCollapsedTocNodes(prev => { const s = new Set(prev); s.has(nodeId) ? s.delete(nodeId) : s.add(nodeId); return s; });
  };

  // ─── Ask AI ────────────────────────────────────────────────────────
  const askAiAboutConcept = (conceptText: string) => { setQuery(`Explain: ${conceptText}`); };

  // ─── Chat submit ───────────────────────────────────────────────────
  const handleChatSubmit = async (formEvent?: React.FormEvent) => {
    if (formEvent) formEvent.preventDefault();
    if (!query.trim()) return;
    const userMessage: ChatMessage = { role: "user", content: query };
    setChatMessages(prev => [...prev, userMessage]);
    setQuery("");
    setIsChatLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage.content, sectionId: activeSectionId }),
      });
      const data = await response.json();
      setChatMessages(prev => [...prev, { role: "mentor", content: response.ok ? data.reply : `Error: ${data.error}` }]);
    } catch { setChatMessages(prev => [...prev, { role: "mentor", content: "Failed to fetch response." }]); }
    finally { setIsChatLoading(false); }
  };

  // ─── Save / delete artifact ────────────────────────────────────────
  const saveArtifact = async (messageIndex: number) => {
    const message = chatMessages[messageIndex];
    if (!message || message.role !== "mentor") return;
    setSavingMessageIndex(messageIndex);
    try {
      const response = await fetch("/api/artifacts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: activeSectionId,
          title: contentData?.section?.title || "General Q&A",
          content: message.content,
          artifactType: "chat_response",
        }),
      });
      if (response.ok) {
        const data = await response.json();
        setSavedArtifacts(prev => [data.artifact, ...prev]);
      }
    } catch { /* silently fail */ }
    finally { setSavingMessageIndex(null); }
  };

  const deleteArtifact = async (artifactId: string) => {
    try {
      const response = await fetch(`/api/artifacts/${artifactId}`, { method: "DELETE" });
      if (response.ok) setSavedArtifacts(prev => prev.filter(a => a.id !== artifactId));
    } catch { /* silently fail */ }
  };

  // ─── TOC Tree Node ─────────────────────────────────────────────────
  const TreeNode = ({ node }: { node: TreeNodeData }) => {
    const isSelected = activeSectionId === node.id;
    const hasChildren = node.childNodes.length > 0;
    const isCollapsed = collapsedTocNodes.has(node.id);
    const indent = levelIndent[node.level] ?? 1;
    return (
      <div className="w-full">
        <div
          ref={isSelected ? tocActiveRef : undefined}
          onClick={() => handleSectionClick(node)}
          className={`cursor-pointer flex items-center gap-1 py-[5px] pr-2 transition-all duration-150 rounded-md border-l-[3px] ${isSelected ? "bg-indigo-50 border-indigo-500 text-indigo-900" : "border-transparent hover:bg-gray-100 hover:border-gray-300"} ${levelStyles[node.level] || "text-sm text-gray-700"}`}
          style={{ paddingLeft: `${indent}rem` }}
        >
          <div className="shrink-0 w-4 h-4 flex items-center justify-center">
            {hasChildren ? (
              <button onClick={(e) => toggleTocCollapse(node.id, e)} className="text-gray-400 hover:text-gray-600 transition" aria-label={isCollapsed ? "Expand" : "Collapse"}>
                <svg className={`w-3 h-3 transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            ) : <span />}
          </div>
          <span className="truncate">{node.title}</span>
        </div>
        {hasChildren && !isCollapsed && (
          <div className="flex flex-col">{node.childNodes.map(c => <TreeNode key={c.id} node={c} />)}</div>
        )}
      </div>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-white text-gray-900 font-sans overflow-hidden">

      {/* ── Pane 1: Table of Contents ── */}
      <aside className="w-72 border-r border-gray-200 flex flex-col bg-gray-50/80 shrink-0">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Table of Contents</h2>
        </div>
        <div className="flex-1 overflow-y-auto py-1.5 px-1">
          {tableOfContents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-indigo-500 border-t-transparent" />
              <span className="text-gray-400 text-xs">Loading contents…</span>
            </div>
          ) : (
            <div className="flex flex-col">{rootNodes.map(node => <TreeNode key={node.id} node={node} />)}</div>
          )}
        </div>
      </aside>

      {/* ── Pane 2: Key Concepts ── */}
      <main className="flex-1 border-r border-gray-200 overflow-y-auto bg-white relative">
        <header className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-8 py-5 z-10">
          <div className="flex items-baseline gap-3">
            {contentData?.section?.level && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">
                {contentData.section.level}
              </span>
            )}
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {contentData?.section?.title || "DDIA Mentor"}
            </h1>
          </div>
        </header>

        <div className="px-8 py-6 max-w-4xl">
          {/* Welcome state */}
          {!contentData && !isContentLoading && (
            <div className="flex flex-col items-center justify-center mt-20 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Welcome to DDIA Mentor</h2>
                <p className="text-sm text-gray-400 mt-1">Select a section from the sidebar to explore concepts.</p>
              </div>
            </div>
          )}

          {/* Loading skeleton */}
          {isContentLoading && (
            <div className="flex flex-col gap-4 mt-4 animate-pulse">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-xl border border-gray-100 p-5">
                  <div className="h-5 bg-gray-100 rounded w-1/3 mb-3" />
                  <div className="h-3 bg-gray-50 rounded w-full mb-2" />
                  <div className="h-3 bg-gray-50 rounded w-4/5" />
                </div>
              ))}
            </div>
          )}

          {contentData && (
            <div className="flex flex-col gap-8">

              {/* ── This section's key concepts ── */}
              {contentData.section.summary && !isGarbageSummary(contentData.section.summary) && (
                <div className="bg-gradient-to-br from-slate-50 to-indigo-50/30 rounded-xl border border-gray-200/60 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-500">Key Concepts</h3>
                    <button onClick={() => askAiAboutConcept(contentData.section.title)} className="text-[11px] font-semibold text-gray-400 hover:text-indigo-600 transition flex items-center gap-1">
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
                      Ask AI about this section
                    </button>
                  </div>
                  <BulletList summaryText={contentData.section.summary} onAskAi={askAiAboutConcept} />
                </div>
              )}

              {/* ── Child topic cards — concepts only ── */}
              {contentData.children.length > 0 && (
                <div className="flex flex-col gap-4">
                  {contentData.children.map(child => {
                    const hasSummary = child.summary && !isGarbageSummary(child.summary);
                    return (
                      <div
                        key={child.id}
                        className="border border-gray-200/80 rounded-xl bg-white p-5 hover:border-indigo-200 hover:shadow-sm transition-all duration-200"
                      >
                        {/* Title row */}
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{child.level}</span>
                            </div>
                            <h4
                              className="text-[16px] font-semibold text-gray-900 hover:text-indigo-700 transition-colors cursor-pointer"
                              onClick={() => handleSectionClick(child as Section)}
                            >
                              {child.title}
                            </h4>
                          </div>
                          <button
                            onClick={() => askAiAboutConcept(child.title)}
                            className="shrink-0 text-[11px] font-semibold text-gray-400 hover:text-indigo-600 transition flex items-center gap-1 mt-1"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                            </svg>
                            Ask AI
                          </button>
                        </div>

                        {/* Concept bullets */}
                        {hasSummary && (
                          <BulletList summaryText={child.summary!} onAskAi={askAiAboutConcept} />
                        )}

                        {/* Drill-down hint */}
                        <div className="mt-4 pt-3 border-t border-gray-100">
                          <button
                            onClick={() => handleSectionClick(child as Section)}
                            className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700 transition flex items-center gap-1"
                          >
                            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                            </svg>
                            Explore this topic
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Empty state — only if no summary AND no children */}
              {contentData.children.length === 0 && !contentData.section.summary && (
                <div className="text-center text-gray-400 mt-12">
                  <p className="text-sm">No content available for this section yet.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── Pane 3: AI Chat + Saved Notes ── */}
      <aside className="w-96 flex flex-col shrink-0 bg-gray-50/80">
        <header className="px-5 py-3.5 border-b border-gray-200 bg-white">
          <h2 className="text-sm font-bold tracking-tight text-gray-900 flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </div>
            AI Mentor
          </h2>
          {activeSectionId && contentData?.section?.title && (
            <p className="text-[11px] text-gray-400 mt-1 truncate">
              Focused on: <span className="text-indigo-500 font-medium">{contentData.section.title}</span>
            </p>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {chatMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Your DDIA study companion</p>
                <p className="text-xs text-gray-400 mt-1">Click &quot;Ask AI&quot; on any concept, or type a question below.</p>
              </div>
            </div>
          )}

          {chatMessages.map((message, messageIndex) => (
            <div key={messageIndex} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-[13px] ${message.role === "user" ? "bg-indigo-600 text-white rounded-tr-sm shadow-sm" : "bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-[9px] opacity-50 uppercase tracking-widest">
                    {message.role === "user" ? "You" : "Mentor"}
                  </div>
                  {message.role === "mentor" && (
                    <button
                      onClick={() => saveArtifact(messageIndex)}
                      disabled={savingMessageIndex === messageIndex}
                      className={`text-gray-300 hover:text-indigo-500 transition ${savingMessageIndex === messageIndex ? "animate-pulse text-indigo-500" : ""}`}
                      title="Save to notes"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                      </svg>
                    </button>
                  )}
                </div>
                <div className="leading-relaxed whitespace-pre-wrap mt-1">{message.content}</div>
              </div>
            </div>
          ))}

          {isChatLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 text-gray-500 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm text-sm flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span className="text-xs text-gray-400">Thinking…</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* ── Saved Notes Panel ── */}
        <div className="border-t border-gray-200">
          <button
            onClick={() => setIsArtifactsPanelOpen(!isArtifactsPanelOpen)}
            className="w-full px-4 py-2.5 flex items-center justify-between bg-white hover:bg-gray-50 transition text-sm"
          >
            <span className="font-semibold text-gray-700 flex items-center gap-2">
              <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              Saved Notes
              {savedArtifacts.length > 0 && (
                <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-bold">{savedArtifacts.length}</span>
              )}
            </span>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${isArtifactsPanelOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {isArtifactsPanelOpen && (
            <div className="max-h-48 overflow-y-auto bg-white border-t border-gray-100">
              {savedArtifacts.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No saved notes yet. Click the bookmark icon on any AI response to save it.</p>
              ) : (
                <div className="flex flex-col">
                  {savedArtifacts.map(artifact => (
                    <div key={artifact.id} className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition group">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-indigo-600 truncate">{artifact.title}</p>
                          <p className="text-[12px] text-gray-600 line-clamp-2 mt-0.5 leading-relaxed">{artifact.content}</p>
                          <p className="text-[10px] text-gray-300 mt-1">{new Date(artifact.createdAt).toLocaleDateString()}</p>
                        </div>
                        <button
                          onClick={() => deleteArtifact(artifact.id)}
                          className="text-gray-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100 shrink-0 mt-1"
                          title="Delete note"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat input */}
        <div className="p-3 bg-white border-t border-gray-200">
          <form onSubmit={handleChatSubmit} className="flex gap-2">
            <input
              type="text"
              className="flex-1 rounded-xl border border-gray-200 px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 text-sm bg-gray-50 placeholder-gray-400 transition"
              placeholder={activeSectionId ? "Ask about this section…" : "Ask a question…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isChatLoading}
            />
            <button
              type="submit"
              disabled={isChatLoading || !query.trim()}
              className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed text-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}
