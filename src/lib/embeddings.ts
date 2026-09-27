import OpenAI from "openai";

/**
 * Together AI discontinued every embedding model it offered (e5-large-instruct,
 * bge-large, bge-base, gte-modernbert, m2-bert) — as of 2026-09-27 their docs
 * state serverless has no embedding models at all. Switched to OpenAI.
 *
 * `dimensions: 1024` asks text-embedding-3-small for a truncated (Matryoshka)
 * output so it matches the existing `vector(1024)` column in
 * src/db/schema.ts — no schema migration needed. Existing rows were embedded
 * with the old model though, so anything ingested before this change must be
 * re-embedded (npm run db:rechunk or db:ingest) before similarity search
 * against it will make sense again.
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1024;

export async function embedTexts(input: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data.map((d) => d.embedding);
}
