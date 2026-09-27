# Gemini Image Prompt — DDIA-RAG Architecture Diagram

Paste the block below into Gemini's image generator (or Nano Banana / Imagen) to get a system architecture diagram of this codebase.

---

Create a clean, modern technical architecture diagram (flat vector style, white background, labeled boxes and arrows, like a SaaS engineering blog illustration) for a RAG-powered study companion app called "DDIA Mentor." Lay it out in four horizontal swimlanes, top to bottom: Ingestion Pipeline, Database, Backend/API, and Frontend UI. Use arrows to show data flow between every component. Use a consistent color code: orange for offline/ingestion steps, blue for database tables, green for backend API logic, purple for frontend UI panes.

**Swimlane 1 — Ingestion Pipeline (orange, offline batch process, left to right):**
A PDF icon labeled "DDIA Book PDF" flows into a box labeled "LlamaParse (PDF → Markdown)". That flows into "Heading-Aware Splitter (splits markdown on # headings)". That branches into two paths: one path goes to "Fuzzy Match to TOC (Jaccard similarity on heading text)", which connects to a box labeled "Together AI LLM — Llama 3.3 70B (generates 3-5 bullet key-concept summaries)" writing into the database's structural_metadata table. The other path goes to "Paragraph-Boundary Chunker (max 2000 chars, sentence-split overflow)", which connects to "Together AI Embeddings — multilingual-e5-large-instruct (1024-dim vectors, batched x10)", writing into the database's text_chunks table.

**Swimlane 2 — Database (blue, labeled "Neon Serverless Postgres + pgvector", drawn as a cylinder/database icon with three connected table boxes inside it):**
- "books (id, title, author, file_path)"
- "structural_metadata (id, book_id, parent_section_id [self-referencing FK], title, level: part/chapter/section/subsection, order_index, summary)" — draw a small looping arrow on this box to show it self-references for hierarchy
- "text_chunks (id, section_id FK, content, order_index, embedding vector(1024), image_url)"
Also show smaller auxiliary boxes off to the side: "users / accounts / sessions (NextAuth)" and "saved_artifacts (user notes)".

**Swimlane 3 — Backend / API (green, Next.js App Router on Vercel):**
Show a box labeled "Next.js API Routes" containing four endpoint chips: "/api/toc", "/api/toc/[id]/content", "/api/toc/[id]/text", "/api/chat". The "/api/chat" chip expands into its own mini flowchart labeled "LangGraph Agent":
Step 1 box "retrieveNode: embed user query (Together AI) → cosine similarity search against text_chunks → if a sectionId is active, scope search to that section + its parent + its children, else search globally" with an arrow into Step 2 box "generateNode: inject retrieved chunks as context into a system prompt → Llama 3.3 70B via Together AI generates the mentor's answer". Draw the arrow from retrieveNode and generateNode back to a small "LangGraph StateGraph (START → retrieve → generate → END)" wrapper box around both. Show a dashed arrow from this Backend swimlane down to the Database swimlane labeled "Drizzle ORM queries", and a dashed arrow out to a cloud icon labeled "Together AI API" for embeddings and chat completions.

**Swimlane 4 — Frontend UI (purple, labeled "Next.js React Client, three-pane layout"):**
Draw a browser window frame divided into three vertical panes:
- Left pane: "TOC Sidebar — collapsible tree: Parts → Chapters → Sections → Subsections"
- Center pane: "Section Content — Key Concepts bullets, expandable book text, figure images, child topic cards"
- Right pane: "AI Mentor Chat — section-scoped chat thread, Ask AI buttons, Saved Notes panel (requires sign-in)"
Show an arrow from the left pane to the center pane labeled "click section → fetch /api/toc/[id]/content", and an arrow from the right pane chat box up to the Backend swimlane's "/api/chat" labeled "POST message + active sectionId". Show a small lock icon connecting to a box labeled "NextAuth + Resend (passwordless email sign-in)" near the Saved Notes panel.

Add a small legend in the bottom corner mapping the four colors to their swimlane names. Use a sans-serif font, rounded rectangle nodes, and subtle drop shadows. Keep the overall composition wide (landscape orientation) so all four lanes are readable left to right.

---

### Quick reference: what the system actually does

- **Ingestion (offline, run via `npm run db:ingest`):** the DDIA PDF is parsed by LlamaParse into markdown, split on headings, fuzzy-matched against a pre-seeded table of contents, summarized by an LLM into key-concept bullets, then chunked into paragraphs and embedded for vector search.
- **Storage:** Neon Postgres with pgvector. Three core tables: `books`, `structural_metadata` (a self-referencing tree for Parts/Chapters/Sections/Subsections), and `text_chunks` (1024-dim embeddings via Together AI's `multilingual-e5-large-instruct`).
- **Chat backend:** a two-node LangGraph (`retrieve` → `generate`). Retrieval scopes the vector search to the active section plus its parent and children when the user has a section selected, otherwise searches globally. Generation feeds retrieved chunks into a Llama 3.3 70B system prompt via Together AI.
- **Frontend:** a three-pane Next.js app, a collapsible TOC tree on the left, key concepts and book text in the center, and a section-scoped AI chat with savable notes (gated behind NextAuth passwordless email sign-in) on the right.
