# DDIA-RAG Development Tracker

This file tracks the ongoing work, architecture, and current state of the DDIA-RAG project.

## Project Overview

DDIA-RAG is a Retrieval-Augmented Generation study companion for the book *Designing Data-Intensive Applications* by Martin Kleppmann. The app provides a hierarchical Table of Contents sidebar, a structured content breakdown panel with LLM-generated summaries, and an AI chat panel for interactive Q&A — all powered by a RAG pipeline over the book's content.

### Tech Stack
- **Framework:** Next.js 16 (App Router, TypeScript)
- **Database:** Neon Serverless Postgres with `pgvector` extension
- **ORM:** Drizzle ORM + drizzle-kit
- **PDF Parsing:** LlamaParse (llama-cloud-services) for markdown extraction
- **Diagram Processing:** Together AI Vision (Llama 3.2 11B Vision Instruct Turbo) for image-to-text
- **LLM (Ingestion):** Together AI with Meta-Llama 3.3 70B Instruct Turbo for structural extraction and summarization
- **Embeddings:** Together AI with `intfloat/multilingual-e5-large-instruct` (1024 dimensions)
- **LLM (Chat):** LangGraph with Meta-Llama 3.3 70B Instruct Turbo via Together AI
- **Styling:** Tailwind CSS v4

### Database Schema (3 tables)
1. **`books`** — Book metadata (id, title, author, filePath)
2. **`structural_metadata`** — Hierarchical TOC sections (id, bookId, parentSectionId, title, level, orderIndex, summary). Self-referencing FK for tree structure.
3. **`text_chunks`** — Embedding-ready text chunks (id, sectionId, content, imageUrl, embedding[1024])

### Key Files
- `src/app/page.tsx` — Main 3-pane UI (TOC sidebar, content panel, AI chat)
- `src/app/api/toc/route.ts` — Fetches all TOC sections
- `src/app/api/toc/[id]/content/route.ts` — Fetches section content + children + chunks
- `src/app/api/toc/[id]/text/route.ts` — Fetches concatenated full text for a section
- `src/app/api/chat/route.ts` — LangGraph RAG chat endpoint
- `src/db/schema.ts` — Drizzle schema (books, structuralMetadata, textChunks)
- `src/db/index.ts` — Drizzle + pg Pool connection
- `scripts/ingest-multimodal.ts` — Primary ingestion script (LlamaParse + Together AI)
- `scripts/build-hierarchy.ts` — LLM-based hierarchy builder (post-ingestion)
- `scripts/fix-hierarchy.ts` — Rule-based hierarchy fixer (post-ingestion)

## Current Status (as of 2026-06-04 audit)

### What Works
- ✅ Next.js app scaffolded and running
- ✅ Neon Postgres connected with pgvector enabled
- ✅ Drizzle schema defined and migration applied
- ✅ PDF fully ingested via LlamaParse (491 page images extracted to `public/diagrams/`)
- ✅ 99 structural metadata sections created with LLM-generated titles and summaries
- ✅ 1,269 text chunks embedded with `intfloat/multilingual-e5-large-instruct` (1024-dim)
- ✅ 3-pane UI built (TOC sidebar, content panel, AI chat)
- ✅ LangGraph RAG chat working (vector similarity search + LLM response)
- ✅ "Ask AI about this" button on chunks and subsections
- ✅ Expand/collapse text chunks in content panel

### Critical Issues (from complete audit)

#### DATA LAYER (Root Cause)
1. **Broken TOC hierarchy:** Ingestion chunks PDF in arbitrary 5-page batches with no chapter/section boundary awareness. LLM extracts titles per batch, producing duplicates (e.g., "Stream Processing" 5x, "The Trouble with Distributed Systems" 4x, "Data Models and Query Languages" 3x).
2. **76 of 99 sections classified as "chapter":** The hierarchy repair scripts (`build-hierarchy.ts`, `fix-hierarchy.ts`) produced a nearly flat tree — only 23 sections are children.
3. **Garbage TOC entries:** "Table of Contents" is a chapter, the book title "Designing Data-Intensive Applications" is a section, and "References" appears 3 times as separate root sections.
4. **Character-sliced chunks:** `splitIntoEmbeddingChunks(text, 1500)` cuts on character count, not sentence/paragraph boundaries, producing fragments that start and end mid-sentence.
5. **3 empty sections:** "Graph Databases", "Column-Oriented Storage", and "MapReduce" have zero text chunks.
6. **Schema drift:** Migration has `vector(768)` but schema.ts says `vector(1024)`. Migration also missing `image_url` column. Database was likely manually altered.

#### UI/UX LAYER
7. **Content panel shows raw text, not structured summaries:** Chunks are displayed as `content.substring(0, 200)` — truncated character-sliced fragments — instead of bullet-point key concepts with LLM summaries (as intended by the wireframe design).
8. **No visual level differentiation in TOC:** Parts, chapters, sections all look identical except for indentation.
9. **Chat is globally scoped:** Vector search covers all chunks, not scoped to the currently-viewed section.
10. **No section-scoped chat context:** Clicking "Ask AI about this" doesn't constrain the RAG search to the relevant section.

#### BACKEND LAYER
11. **No chunk ordering in content API:** `GET /api/toc/[id]/content` fetches chunks without `ORDER BY`, potentially returning them out of order.
12. **Import path inconsistencies:** Mix of `@/db/` (alias) and relative paths (`../../../db/`) across API routes.
13. **Boilerplate metadata:** `layout.tsx` has `title: "Create Next App"` and `description: "Generated by create next app"`.

#### INFRASTRUCTURE
14. **Package name is `tmp-app`:** Should be `ddia-rag`.
15. **README is boilerplate:** Stock Create Next App README.
16. **No npm scripts for ingestion/utility tasks.**
17. **Dead scripts:** `ingest.ts` (superseded), `test-llamaparse.ts`, `inspect-llamaparse.ts`, `test-query.ts` should be cleaned up.
18. **491 page images (~170MB) in `public/diagrams/`:** Many are blank pages. Should not be in git.

## Update (2026-06-12): Figures, full text, and layout overhaul

### New content pipeline (PDF-derived, no API costs)
The Neon RAG chunks only cover text whose headings fuzzy-matched during
LlamaParse ingestion (e.g. "fencing tokens" appears in zero chunks), so
reading content is now extracted deterministically from the PDF:

- `npm run extract:figures` (`scripts/extract-figures.mjs`) — crops all 88
  vector figures via `pdftotext -bbox-layout` caption detection +
  `pdftoppm` region rendering → `public/figures/fig-X-Y.png` +
  `scripts/figures-manifest.json`. Requires poppler (`brew install poppler`).
- `npm run extract:content` (`scripts/extract-section-content.ts`) — locates
  every TOC title as a PDF heading (fuzzy sequence matching), slices the book
  into per-section ranges, and writes `data/section-content.json`
  (sectionId → full reading text with inline figure tokens + figure list).
  175/192 sections matched; the 17 unmatched are chapter 12 + its children,
  which do not exist in this early-release PDF (it ends at chapter 11).
- `src/lib/section-content.ts` serves that artifact to the API routes.
  Neon keeps RAG/chat duties; reading content is file-based.

### API changes
- `GET /api/toc/[id]/content` now returns `figures` + `hasText` for the
  section and each child.
- `GET /api/toc/[id]/text` serves the PDF-extracted text (fallback to chunks).

### UI changes (`src/app/page.tsx`)
- Sidebar: parts as group headers (Part I/II/III), numbered chapters,
  indent rails, chapters/sections collapsed by default, auto-expand of the
  active path, wrapping titles.
- Content pane: "Diagrams from the book" panel below Key Concepts; figure
  thumbnails + diagram-count badges on child cards; click-to-zoom lightbox
  (Escape closes); "Read the book text" expander on the section and each
  child card — serif reading view with figures rendered inline.
- `globals.css`: body was rendering in Arial (Geist was loaded but
  overridden) — fixed; removed the half-implemented dark-mode override;
  added `.prose-book` reading typography.

### Known data caveats
- Chapter 12 + Glossary have TOC entries and LLM summaries but no source
  text in this PDF (early release). Their summaries are hallucination-prone.
  The UI dims these 17 sections in the sidebar ("final ed." badge) and
  shows an amber warning banner in the content pane.
- RAG chunk coverage was thin (948 chunks, 322K chars). Run
  `npm run db:rechunk` (script: `scripts/rechunk-from-content.ts`) to
  replace the LlamaParse-derived chunks with paragraph-boundary chunks
  from `data/section-content.json`, bringing coverage to ~100%.

## Architecture

### Data Pipeline
```
PDF → LlamaParse (markdown extraction) → 5-page batches → Together AI LLM (title + summary extraction) → structural_metadata table
                                        → 1500-char splits → Together AI embeddings (1024-dim) → text_chunks table
```

### UI Layout (3-pane)
```
┌──────────────┬────────────────────────────┬────────────────┐
│  Table of    │    Content Breakdown       │    AI Chat     │
│  Contents    │    (main reading area)     │    Panel       │
│  (sidebar)   │                            │                │
│  w=264px     │    flex-1                  │    w=384px     │
└──────────────┴────────────────────────────┴────────────────┘
```

### RAG Chat Pipeline (LangGraph)
```
User Question → Embed (multilingual-e5-large-instruct) → pgvector cosine similarity search (top 5 chunks) → Meta-Llama 3.3 70B → Response
```

## Next Steps (Prioritized)

### Phase A: Fix the Data (Highest Priority)
1. **Deterministic TOC:** Hardcode DDIA's known chapter hierarchy as a seed file instead of LLM-discovering it from raw text batches.
2. **Smart chunking:** Replace 5-page-batch approach with markdown heading-aware chunking that maps to the deterministic TOC.
3. **Proper summaries:** Generate LLM bullet-point summaries per section (key concepts), not per arbitrary batch.
4. **Regenerate migration:** Run `drizzle-kit generate` to sync migration with schema (1024-dim, imageUrl).

### Phase B: Fix the UI
5. **Content panel:** Render key concepts as bullet points with summaries (matching wireframe), not raw chunks.
6. **TOC:** With deterministic data, the tree component works correctly. Add collapsible sections and level styling.
7. **Section-scoped chat:** Pass `sectionId` to `/api/chat` to filter vector search to relevant chunks.

### Phase C: Polish
8. Fix metadata, import paths, package name.
9. Clean up dead scripts, add npm scripts.
10. Update README with actual project documentation.

## Troubleshooting

### Running the Ingestion Pipeline
```bash
npx tsx scripts/ingest-multimodal.ts   # Full ingestion (LlamaParse + embeddings)
npx tsx scripts/build-hierarchy.ts     # LLM-based hierarchy repair (unreliable)
npx tsx scripts/fix-hierarchy.ts       # Rule-based hierarchy repair (oversimplified)
```

### Testing Vector Search
```bash
npx tsx scripts/test-query.ts
```

### Environment Variables Required (.env)
- `DATABASE_URL` — Neon Postgres connection string
- `TOGETHER_API_KEY` — Together AI API key
- `LLAMA_CLOUD_API_KEY` — LlamaParse API key
- `AUTH_SECRET` — Random secret for NextAuth sessions (run `npx auth secret` to generate)
- `AUTH_RESEND_KEY` — Resend API key for magic-link emails (free at resend.com)

### First-time auth setup
1. Add `AUTH_SECRET` and `AUTH_RESEND_KEY` to `.env`
2. Run `npm run db:push` to create the auth tables (user, account, session, verificationToken)
   and add the `user_id` column to `saved_artifacts`
3. In production, update `AUTH_RESEND_KEY`'s sender domain from `onboarding@resend.dev`
   to a verified domain in `src/auth.ts`
