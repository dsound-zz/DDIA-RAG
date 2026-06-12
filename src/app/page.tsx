"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

// ─── Types ───────────────────────────────────────────────────────────
type Section = {
  id: string;
  parentSectionId: string | null;
  title: string;
  level: string;
  orderIndex: number;
  summary: string | null;
  hasContent?: boolean; // false = not in this early-release PDF edition
};

type Figure = { label: string; caption: string; file: string };

type ChildSection = Section & {
  chunkCount: number;
  figures: Figure[];
  hasText: boolean;
};

type ContentData = {
  section: Section;
  children: ChildSection[];
  figures: Figure[];
  hasText: boolean;
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

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

// Figure tokens in book text: ![Figure X-Y. caption](/figures/fig-X-Y.png)
const FIGURE_TOKEN_PATTERN = /^!\[([^\]]*)\]\(([^)]+)\)$/;

/** Short, period-less paragraphs in the book text are inline sub-headings. */
function looksLikeHeading(paragraph: string): boolean {
  return (
    paragraph.length < 60 &&
    !/[.:;,]$/.test(paragraph) &&
    /^[A-Z0-9“"]/.test(paragraph) &&
    paragraph.split(" ").length <= 8
  );
}

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

// ─── Figure display ──────────────────────────────────────────────────

function FigureCaption({ caption }: { caption: string }) {
  const labelMatch = /^(Figure \d+-\d+\.)\s*/.exec(caption);
  return (
    <figcaption className="text-[12.5px] text-gray-500 leading-snug mt-2.5 px-1">
      {labelMatch ? (
        <>
          <span className="font-semibold text-gray-700 not-italic">{labelMatch[1]}</span>{" "}
          <span className="italic">{caption.slice(labelMatch[0].length)}</span>
        </>
      ) : (
        <span className="italic">{caption}</span>
      )}
    </figcaption>
  );
}

function FigureCard({ figure, onZoom }: { figure: Figure; onZoom: (figure: Figure) => void }) {
  return (
    <figure className="rounded-xl border border-gray-200/80 bg-white p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={figure.file}
        alt={figure.caption}
        loading="lazy"
        onClick={() => onZoom(figure)}
        className="w-full h-auto max-h-96 object-contain cursor-zoom-in rounded-md"
      />
      <FigureCaption caption={figure.caption} />
    </figure>
  );
}

function FiguresPanel({ figures, onZoom }: { figures: Figure[]; onZoom: (figure: Figure) => void }) {
  if (figures.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-500 mb-3">
        Diagrams from the book
      </h3>
      <div className="flex flex-col gap-4">
        {figures.map(figure => <FigureCard key={figure.label} figure={figure} onZoom={onZoom} />)}
      </div>
    </div>
  );
}

function FigureLightbox({ figure, onClose }: { figure: Figure; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 bg-gray-950/80 backdrop-blur-sm flex items-center justify-center p-8 cursor-zoom-out"
      onClick={onClose}
    >
      <div className="max-w-5xl w-full">
        <div className="bg-white rounded-xl p-6 shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={figure.file} alt={figure.caption} className="w-full h-auto max-h-[75vh] object-contain" />
        </div>
        <p className="text-[13px] text-gray-200 text-center mt-4 leading-snug">{figure.caption}</p>
      </div>
    </div>
  );
}

// ─── Book text reader ────────────────────────────────────────────────

function BookText({ sectionId, onZoom }: { sectionId: string; onZoom: (figure: Figure) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/toc/${sectionId}/text`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (!cancelled) setText(d.text); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [sectionId]);

  if (error) return <p className="text-sm text-gray-400 py-3">The book text for this section isn’t available.</p>;
  if (text === null) {
    return (
      <div className="flex flex-col gap-2.5 py-3 animate-pulse">
        <div className="h-3 bg-gray-100 rounded w-full" />
        <div className="h-3 bg-gray-100 rounded w-11/12" />
        <div className="h-3 bg-gray-100 rounded w-4/5" />
      </div>
    );
  }

  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  return (
    <div className="prose-book pt-1 pb-2">
      {paragraphs.map((paragraph, index) => {
        const figureMatch = FIGURE_TOKEN_PATTERN.exec(paragraph.trim());
        if (figureMatch) {
          const figure: Figure = { label: "", caption: figureMatch[1], file: figureMatch[2] };
          return (
            <figure key={index} className="my-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={figure.file}
                alt={figure.caption}
                loading="lazy"
                onClick={() => onZoom(figure)}
                className="w-full h-auto max-h-96 object-contain cursor-zoom-in rounded-md border border-gray-100"
              />
              <FigureCaption caption={figure.caption} />
            </figure>
          );
        }
        if (looksLikeHeading(paragraph.trim())) {
          return (
            <h4 key={index} className="font-sans font-semibold text-gray-900 text-[14px] mt-6 mb-2">
              {paragraph.trim()}
            </h4>
          );
        }
        return <p key={index}>{paragraph}</p>;
      })}
    </div>
  );
}

function BookTextToggle({
  sectionId, isOpen, onToggle, onZoom,
}: { sectionId: string; isOpen: boolean; onToggle: () => void; onZoom: (figure: Figure) => void }) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="text-[11px] font-semibold text-gray-400 hover:text-indigo-600 transition flex items-center gap-1.5"
      >
        <svg className={`w-3 h-3 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
        {isOpen ? "Hide book text" : "Read the book text"}
      </button>
      {isOpen && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <BookText sectionId={sectionId} onZoom={onZoom} />
        </div>
      )}
    </div>
  );
}

// ─── Auth modal ──────────────────────────────────────────────────────

function AuthModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    await signIn("resend", { email, redirect: false });
    setSent(true);
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-gray-950/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        {sent ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <h3 className="text-[16px] font-semibold text-gray-900 mb-1.5">Check your inbox</h3>
            <p className="text-[13px] text-gray-500 leading-relaxed">
              A sign-in link was sent to{" "}
              <span className="font-medium text-gray-700">{email}</span>.
              Click it to finish signing in and save your notes.
            </p>
            <button onClick={onClose} className="mt-5 text-[12px] text-gray-400 hover:text-gray-600 transition">Dismiss</button>
          </div>
        ) : (
          <>
            <div className="mb-5">
              <h3 className="text-[17px] font-semibold text-gray-900 mb-1.5">Save your notes</h3>
              <p className="text-[13px] text-gray-500 leading-relaxed">Enter your email to receive a sign-in link. No password needed.</p>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 bg-gray-50 placeholder-gray-400"
              />
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2.5 text-sm font-semibold transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
            <button onClick={onClose} className="mt-4 w-full text-[12px] text-gray-400 hover:text-gray-600 transition">Cancel</button>
          </>
        )}
      </div>
    </div>
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
  const [openTextSections, setOpenTextSections] = useState<Set<string>>(new Set());
  const [lightboxFigure, setLightboxFigure] = useState<Figure | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const { data: session, status: sessionStatus } = useSession();
  const isLoggedIn = sessionStatus === "authenticated";

  const chatEndRef = useRef<HTMLDivElement>(null);

  // ─── Build tree + lookup maps ──────────────────────────────────────
  const buildTree = useCallback((parentId: string | null): TreeNodeData[] => {
    return tableOfContents
      .filter(s => s.parentSectionId === parentId)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map(s => ({ ...s, childNodes: buildTree(s.id) }));
  }, [tableOfContents]);

  const rootNodes = useMemo(() => buildTree(null), [buildTree]);

  const parentById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const section of tableOfContents) map.set(section.id, section.parentSectionId);
    return map;
  }, [tableOfContents]);

  // Chapter numbers (1–12) and part numerals (I–III), by book order.
  const displayNumberById = useMemo(() => {
    const map = new Map<string, string>();
    tableOfContents
      .filter(s => s.level === "chapter")
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .forEach((chapter, index) => map.set(chapter.id, String(index + 1)));
    tableOfContents
      .filter(s => s.level === "part")
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .forEach((part, index) => map.set(part.id, ROMAN_NUMERALS[index] ?? String(index + 1)));
    return map;
  }, [tableOfContents]);

  // ─── Fetch TOC + artifacts on mount ────────────────────────────────
  useEffect(() => {
    fetch("/api/toc")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const sections: Section[] = d.sections || [];
        setTableOfContents(sections);
        // Start with chapters and sections collapsed: the 192-node tree is
        // unreadable fully expanded. Parts stay open so all chapters show.
        const childCounts = new Map<string | null, number>();
        for (const section of sections) {
          childCounts.set(section.parentSectionId, (childCounts.get(section.parentSectionId) ?? 0) + 1);
        }
        setCollapsedTocNodes(new Set(
          sections
            .filter(s => (s.level === "chapter" || s.level === "section") && (childCounts.get(s.id) ?? 0) > 0)
            .map(s => s.id),
        ));
      })
      .catch(() => {});
    fetch("/api/artifacts").then(r => r.ok ? r.json() : null).then(d => d && setSavedArtifacts(d.artifacts || [])).catch(() => {});
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, isChatLoading]);

  // ─── Section click ─────────────────────────────────────────────────
  const handleSectionClick = async (section: Section, options?: { expand?: boolean }) => {
    setActiveSectionId(section.id);
    setContentData(null);
    setOpenTextSections(new Set());
    setIsContentLoading(true);
    // Reveal the clicked node: expand it and every ancestor in the sidebar.
    setCollapsedTocNodes(prev => {
      const next = new Set(prev);
      if (options?.expand !== false) next.delete(section.id);
      let ancestorId = parentById.get(section.id) ?? null;
      while (ancestorId) {
        next.delete(ancestorId);
        ancestorId = parentById.get(ancestorId) ?? null;
      }
      return next;
    });
    try {
      const response = await fetch(`/api/toc/${section.id}/content`);
      if (response.ok) setContentData(await response.json());
    } catch (fetchError) { console.error("Failed to load content.", fetchError); }
    finally { setIsContentLoading(false); }
  };

  // ─── TOC collapse toggle ──────────────────────────────────────────
  const toggleTocCollapse = (nodeId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setCollapsedTocNodes(prev => { const s = new Set(prev); if (s.has(nodeId)) { s.delete(nodeId); } else { s.add(nodeId); } return s; });
  };

  const toggleTextSection = (sectionId: string) => {
    setOpenTextSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) { next.delete(sectionId); } else { next.add(sectionId); }
      return next;
    });
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
    if (!isLoggedIn) {
      setShowAuthModal(true);
      return;
    }
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
    const displayNumber = displayNumberById.get(node.id);

    const chevron = hasChildren && (
      <button
        onClick={(e) => toggleTocCollapse(node.id, e)}
        className="shrink-0 w-5 h-5 -ml-1 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200/70 transition"
        aria-label={isCollapsed ? "Expand" : "Collapse"}
      >
        <svg className={`w-3 h-3 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      </button>
    );

    // Parts are group headers: quiet, uppercase, with breathing room above.
    if (node.level === "part") {
      return (
        <div className="w-full">
          <div
            onClick={() => handleSectionClick(node)}
            className={`cursor-pointer flex items-center gap-1 px-3 pt-5 pb-1.5 group ${isSelected ? "text-indigo-600" : "text-gray-400 hover:text-gray-600"}`}
          >
            <span className="text-[10.5px] font-bold uppercase tracking-[0.14em]">
              Part {displayNumber} · {node.title}
            </span>
          </div>
          {hasChildren && !isCollapsed && (
            <div className="flex flex-col gap-px">{node.childNodes.map(c => <TreeNode key={c.id} node={c} />)}</div>
          )}
        </div>
      );
    }

    const noContent = node.hasContent === false;
    const rowStyles: Record<string, string> = {
      chapter: noContent ? "text-[13px] font-medium text-gray-400" : "text-[13px] font-medium text-gray-800",
      section: noContent ? "text-[12.5px] font-normal text-gray-400" : "text-[12.5px] font-normal text-gray-600",
      subsection: noContent ? "text-[12px] font-normal text-gray-400" : "text-[12px] font-normal text-gray-500",
    };

    return (
      <div className="w-full">
        <div
          onClick={() => handleSectionClick(node)}
          className={`cursor-pointer flex items-start gap-1 py-[5px] pl-3 pr-2 rounded-md transition-colors duration-100 ${
            isSelected
              ? "bg-indigo-100/70 text-indigo-900"
              : "hover:bg-gray-200/50"
          } ${rowStyles[node.level] ?? "text-[13px] text-gray-700"}`}
        >
          {node.level === "chapter" ? (
            <span className={`shrink-0 w-5 text-right tabular-nums font-semibold mt-px text-[11.5px] ${isSelected ? "text-indigo-500" : noContent ? "text-gray-300" : "text-indigo-400/80"}`}>
              {displayNumber}
            </span>
          ) : null}
          <span className={`flex-1 leading-snug ${isSelected ? "font-medium" : ""}`}>{node.title}</span>
          {noContent && !isSelected && (
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-gray-300 mt-1 mr-1">final ed.</span>
          )}
          {chevron}
        </div>
        {hasChildren && !isCollapsed && (
          <div className={`flex flex-col gap-px ml-[1.4rem] pl-2 border-l ${node.level === "chapter" ? "border-gray-200" : "border-gray-200/70"}`}>
            {node.childNodes.map(c => <TreeNode key={c.id} node={c} />)}
          </div>
        )}
      </div>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-white text-gray-900 font-sans overflow-hidden">

      {/* ── Pane 1: Table of Contents ── */}
      <aside className="w-[19rem] border-r border-gray-200 flex flex-col bg-gray-50/80 shrink-0">
        <div className="px-4 py-3.5 border-b border-gray-200">
          <h1 className="text-[13px] font-bold tracking-tight text-gray-900">Designing Data-Intensive Applications</h1>
          <p className="text-[11px] text-gray-400 mt-0.5">Martin Kleppmann · study companion</p>
        </div>
        <div className="flex-1 overflow-y-auto pb-6 px-2">
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
                  {contentData.hasText && (
                    <div className="mt-5 pt-4 border-t border-gray-200/60">
                      <BookTextToggle
                        sectionId={contentData.section.id}
                        isOpen={openTextSections.has(contentData.section.id)}
                        onToggle={() => toggleTextSection(contentData.section.id)}
                        onZoom={setLightboxFigure}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ── Diagrams for this section ── */}
              <FiguresPanel figures={contentData.figures} onZoom={setLightboxFigure} />

              {/* ── Child topic cards ── */}
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
                              {child.figures.length > 0 && (
                                <span className="text-[10px] font-semibold text-gray-400 flex items-center gap-0.5">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A1.5 1.5 0 0021.75 19.5V4.5A1.5 1.5 0 0020.25 3H3.75A1.5 1.5 0 002.25 4.5v15A1.5 1.5 0 003.75 21z" />
                                  </svg>
                                  {child.figures.length} {child.figures.length === 1 ? "diagram" : "diagrams"}
                                </span>
                              )}
                            </div>
                            <h4
                              className="text-[16px] font-semibold text-gray-900 hover:text-indigo-700 transition-colors cursor-pointer"
                              onClick={() => handleSectionClick(child)}
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

                        {/* Diagram thumbnails */}
                        {child.figures.length > 0 && (
                          <div className="mt-4 flex gap-2 flex-wrap">
                            {child.figures.map(figure => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={figure.label}
                                src={figure.file}
                                alt={figure.caption}
                                title={figure.caption}
                                loading="lazy"
                                onClick={() => setLightboxFigure(figure)}
                                className="h-20 w-auto max-w-40 object-contain border border-gray-200 rounded-md cursor-zoom-in bg-white hover:border-indigo-300 transition"
                              />
                            ))}
                          </div>
                        )}

                        {/* Footer: read text + drill down */}
                        <div className="mt-4 pt-3 border-t border-gray-100 flex flex-col gap-3">
                          <div className="flex items-center gap-5">
                            <button
                              onClick={() => handleSectionClick(child)}
                              className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700 transition flex items-center gap-1"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                              </svg>
                              Explore this topic
                            </button>
                            {child.hasText && (
                              <BookTextToggle
                                sectionId={child.id}
                                isOpen={openTextSections.has(child.id)}
                                onToggle={() => toggleTextSection(child.id)}
                                onZoom={setLightboxFigure}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Final-edition notice for Chapter 12 sections */}
              {contentData.section.hasContent === false && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-5 py-4 flex gap-3 items-start">
                  <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <p className="text-[13px] font-semibold text-amber-800">Final edition only</p>
                    <p className="text-[12px] text-amber-700 mt-0.5 leading-relaxed">
                      This section is from Chapter 12 and was not included in the early-release PDF used to build this companion.
                      The summary above is AI-generated and may not accurately reflect the final published text.
                    </p>
                  </div>
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
          <div className="px-4 py-2.5 flex items-center justify-between bg-white">
            <button
              onClick={() => setIsArtifactsPanelOpen(!isArtifactsPanelOpen)}
              className="flex items-center gap-2 text-sm hover:opacity-80 transition"
            >
              <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              <span className="font-semibold text-gray-700">Saved Notes</span>
              {savedArtifacts.length > 0 && (
                <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-bold">{savedArtifacts.length}</span>
              )}
              <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isArtifactsPanelOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            {isLoggedIn ? (
              <button
                onClick={() => signOut()}
                className="text-[10px] text-gray-300 hover:text-gray-500 transition"
                title={session?.user?.email ?? "Sign out"}
              >
                Sign out
              </button>
            ) : null}
          </div>
          {isArtifactsPanelOpen && (
            <div className="max-h-48 overflow-y-auto bg-white border-t border-gray-100">
              {!isLoggedIn ? (
                <div className="flex flex-col items-center gap-2 py-4 px-4 text-center">
                  <p className="text-xs text-gray-400">Sign in to save and view your notes.</p>
                  <button
                    onClick={() => setShowAuthModal(true)}
                    className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700 transition"
                  >
                    Get a sign-in link →
                  </button>
                </div>
              ) : savedArtifacts.length === 0 ? (
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

      {lightboxFigure && (
        <FigureLightbox figure={lightboxFigure} onClose={() => setLightboxFigure(null)} />
      )}

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} />
      )}
    </div>
  );
}
