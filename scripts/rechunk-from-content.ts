/**
 * Re-chunks the DDIA text from data/section-content.json and re-embeds
 * everything with Together AI, replacing the sparse LlamaParse-derived chunks.
 *
 * The old chunks covered ~30% of the book (322K of 1,068K chars) because
 * LlamaParse ingestion dropped sections whose headings didn't fuzzy-match.
 * This script produces paragraph-boundary chunks for all 175 matched sections,
 * bringing coverage to ~100% of the available PDF text.
 *
 * Usage:
 *   npm run db:rechunk
 *
 * What it does:
 *   1. Reads data/section-content.json
 *   2. Splits each section's text into ~800-char paragraph-boundary chunks
 *   3. Embeds in batches of 8 via Together AI
 *   4. Deletes old chunks for each section, inserts new ones
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

import fs from "fs";
import path from "path";
import Together from "together-ai";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index";
import { textChunks } from "../src/db/schema";

const EMBEDDING_MODEL = "intfloat/multilingual-e5-large-instruct";
const CHUNK_TARGET = 800;   // target chars per chunk
const EMBED_BATCH = 8;      // Together AI batch limit

const FIGURE_TOKEN = /^!\[/;  // skip inline figure markers in book text

const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });

function splitIntoChunks(text: string): string[] {
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0 && !FIGURE_TOKEN.test(p));
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length === 0) {
      current = para;
    } else if (current.length + para.length + 2 <= CHUNK_TARGET) {
      current += "\n\n" + para;
    } else {
      chunks.push(current);
      current = para;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await together.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return response.data.map(d => d.embedding);
}

async function main() {
  const contentPath = path.resolve("data/section-content.json");
  const allContent = JSON.parse(fs.readFileSync(contentPath, "utf8")) as Record<
    string,
    { title: string; text: string; figures: unknown[] }
  >;

  const sections = Object.entries(allContent).filter(([, v]) => v.text.length > 0);
  console.log(`Processing ${sections.length} sections with text...`);

  let totalChunks = 0;
  let totalSections = 0;
  let errors = 0;

  for (const [sectionId, { title, text }] of sections) {
    const rawChunks = splitIntoChunks(text);
    if (rawChunks.length === 0) continue;

    // Embed in batches
    const embeddings: number[][] = [];
    for (let i = 0; i < rawChunks.length; i += EMBED_BATCH) {
      const batch = rawChunks.slice(i, i + EMBED_BATCH);
      try {
        const vecs = await embedBatch(batch);
        embeddings.push(...vecs);
      } catch (err) {
        console.error(`  Error embedding batch for "${title}":`, err);
        errors++;
        continue;
      }
      // Respect Together AI rate limits (~1 req/s on free tier)
      if (i + EMBED_BATCH < rawChunks.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    if (embeddings.length !== rawChunks.length) {
      console.warn(`  Skipping "${title}": embedding count mismatch (${embeddings.length}/${rawChunks.length})`);
      continue;
    }

    // Replace old chunks atomically within a transaction
    try {
      await db.transaction(async (tx) => {
        await tx.delete(textChunks).where(eq(textChunks.sectionId, sectionId));
        await tx.insert(textChunks).values(
          rawChunks.map((content, i) => ({
            sectionId,
            content,
            orderIndex: i,
            embedding: embeddings[i],
          })),
        );
      });
      totalChunks += rawChunks.length;
      totalSections++;
    } catch (err) {
      console.error(`  Error inserting chunks for "${title}":`, err);
      errors++;
    }

    process.stdout.write(`\r  ${totalSections}/${sections.length} sections, ${totalChunks} chunks`);
  }

  console.log(`\n\nDone.`);
  console.log(`  ${totalSections} sections re-chunked`);
  console.log(`  ${totalChunks} total chunks (was ~948)`);
  if (errors > 0) console.log(`  ${errors} errors — re-run to retry`);
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
