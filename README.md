# DDIA-RAG — AI Study Companion

An AI-powered study companion for **Designing Data-Intensive Applications** by Martin Kleppmann. Explore the book's concepts through a hierarchical Table of Contents, read LLM-generated summaries, and chat with an AI mentor powered by RAG.

## Features

- **Hierarchical TOC** — Parts → Chapters → Sections → Subsections with collapsible tree navigation
- **Key Concepts** — LLM-generated bullet-point summaries for each section
- **Full Text** — Expand any section to read the original book text
- **AI Mentor Chat** — Ask questions about any concept; the AI uses section-scoped RAG to give focused, contextual answers
- **Vector Search** — 1024-dim embeddings via `intfloat/multilingual-e5-large-instruct` stored in Neon Postgres with pgvector

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Database | Neon Serverless Postgres + pgvector |
| ORM | Drizzle |
| PDF Parsing | LlamaParse |
| LLM | Together AI (Meta-Llama 3.3 70B) |
| Embeddings | Together AI (multilingual-e5-large-instruct) |
| Chat Agent | LangGraph |
| Styling | Tailwind CSS v4 |

## Getting Started

### Prerequisites
- Node.js ≥ 20
- A [Neon](https://neon.tech) Postgres database with pgvector enabled
- API keys for Together AI and LlamaParse

### Setup

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Fill in: DATABASE_URL, TOGETHER_API_KEY, LLAMA_CLOUD_API_KEY

# Push the schema to your database
npm run db:push

# Seed the deterministic TOC structure
npm run db:seed-toc

# Run the full ingestion pipeline (LlamaParse → summaries → embeddings)
npm run db:ingest

# Start the dev server
npm run dev
```

### Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `TOGETHER_API_KEY` | Together AI API key |
| `LLAMA_CLOUD_API_KEY` | LlamaParse API key |

## Architecture

```
PDF → LlamaParse (markdown) → Heading-aware splitting → Fuzzy match to TOC
    → LLM bullet-point summaries → Update structural_metadata
    → Paragraph-boundary chunking → Embeddings → text_chunks
```

### Database (3 tables)
- **books** — Book metadata
- **structural_metadata** — Hierarchical TOC (self-referencing parent FK)
- **text_chunks** — Embedding-ready content chunks with pgvector

### UI (3-pane layout)
- Left: Collapsible TOC sidebar
- Center: Section content with concept cards and expandable text
- Right: AI Mentor chat (section-scoped RAG)

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run db:seed-toc` | Seed the deterministic DDIA table of contents |
| `npm run db:ingest` | Run the full ingestion pipeline |
| `npm run db:push` | Push schema changes to the database |
| `npm run db:generate` | Generate a new Drizzle migration |
| `npm run test:query` | Test vector similarity search |
