# DDIA-RAG Development Tracker

This file tracks the ongoing work, architecture, and current state of the DDIA-RAG project.

## Project Overview
DDIA-RAG is a Retrieval-Augmented Generation pipeline built on the book "Designing Data-Intensive Applications". It leverages:
- **Framework:** Next.js (App Router, TypeScript)
- **Database:** Neon Serverless Postgres with `pgvector`
- **ORM:** Drizzle
- **Ingestion:** Together AI with Meta-Llama 3.3 70B Instruct for structural extraction and summarization
- **Embeddings:** Together AI with intfloat/multilingual-e5-large-instruct (1024 dimensions)
- **Retrieval & Chat:** LangGraph with Meta-Llama 3.3 70B Instruct via Together AI

## Current Status
- **Initialization:** Next.js project scaffolded.
- **Database:** Drizzle schema created for books, structural metadata, and text chunks.
- **Dependencies:** Setting up Drizzle, pgvector, Together AI, and LangChain community SDKs.

## Next Steps
1. Configure Neon connection and Drizzle `drizzle.config.ts`.
2. Generate and apply the database migrations.
3. Write the PDF ingestion script `scripts/ingest.ts`.
4. Implement the embedding script `scripts/embed.ts`.
5. Build the LangGraph query router API `src/app/api/chat/route.ts`.
