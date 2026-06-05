import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { eq, sql, asc } from "drizzle-orm";
import Together from "together-ai";
import { db } from "../src/db/index";
import { structuralMetadata, textChunks } from "../src/db/schema";

// ---------------------------------------------------------------------------
// Backfill v3 — For sections not found in the markdown, generate summaries
// directly from the LLM using the section title + parent context. Also
// truncates chunks to stay within embedding model's 512-token limit.
// ---------------------------------------------------------------------------

const TOGETHER_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo";
const EMBEDDING_MODEL = "intfloat/multilingual-e5-large-instruct";
const MAX_CHUNK_CHARS = 1500; // ~375 tokens, safely under 512 limit

const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });

async function generateSummaryFromTitle(sectionTitle: string, parentTitle: string | null): Promise<string | null> {
  const contextHint = parentTitle ? ` (part of "${parentTitle}")` : "";
  const prompt = `You are an expert on "Designing Data-Intensive Applications" by Martin Kleppmann. 
Extract 3-5 key concepts from the section titled "${sectionTitle}"${contextHint} as bullet points. 
Each bullet should be a concise concept name followed by a brief explanation (1-2 sentences). 
Return ONLY the bullet points, no introduction or conclusion.
Base your answer strictly on the actual content of this book section.`;

  try {
    const completion = await together.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: TOGETHER_MODEL,
      max_tokens: 512,
      temperature: 0.2,
    });
    const result = completion.choices[0]?.message?.content || null;
    if (result && (result.toLowerCase().includes("no concepts") || result.toLowerCase().includes("i don't have"))) return null;
    return result;
  } catch { return null; }
}

async function generateEmbedding(text: string): Promise<number[]> {
  // Truncate to stay within 512 token limit
  const truncated = text.length > MAX_CHUNK_CHARS ? text.substring(0, MAX_CHUNK_CHARS) : text;
  const response = await together.embeddings.create({ model: EMBEDDING_MODEL, input: [truncated] });
  return response.data[0].embedding;
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Backfill v3 — LLM-generated summaries for missing content ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const allSections = await db.select().from(structuralMetadata).orderBy(asc(structuralMetadata.orderIndex));

  // Build a lookup for parent titles
  const sectionMap = new Map(allSections.map(s => [s.id, s]));

  const emptySections: typeof allSections = [];
  for (const section of allSections) {
    const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(textChunks).where(eq(textChunks.sectionId, section.id));
    const hasChunks = Number(countResult.count) > 0;
    const hasSummary = section.summary && section.summary.trim().length > 10;
    if (!hasChunks && !hasSummary) emptySections.push(section);
  }

  console.log(`Found ${emptySections.length} empty sections:\n`);
  emptySections.forEach(s => console.log(`  - ${s.title} (${s.level})`));

  if (emptySections.length === 0) { console.log("\nAll done!"); process.exit(0); }

  let backfilledCount = 0;

  for (const section of emptySections) {
    const parentSection = section.parentSectionId ? sectionMap.get(section.parentSectionId) : null;
    const parentTitle = parentSection?.title || null;

    console.log(`\n  Processing: "${section.title}"${parentTitle ? ` (under "${parentTitle}")` : ""}...`);

    // Generate summary from the LLM based on title + context
    const summary = await generateSummaryFromTitle(section.title, parentTitle);
    if (!summary) {
      console.log(`    ✗ LLM couldn't generate a summary`);
      continue;
    }

    // Save summary
    await db.update(structuralMetadata).set({ summary }).where(eq(structuralMetadata.id, section.id));
    console.log(`    ✓ Summary saved (${summary.length} chars)`);

    // Also create a single text chunk from the summary so vector search works
    try {
      const embedding = await generateEmbedding(summary);
      await db.insert(textChunks).values({
        sectionId: section.id,
        content: summary,
        orderIndex: 0,
        embedding,
      });
      console.log(`    ✓ Embedded and stored as searchable chunk`);
    } catch (embeddingError) {
      console.log(`    ⚠ Embedding failed: ${embeddingError instanceof Error ? embeddingError.message : embeddingError}`);
    }

    backfilledCount++;
  }

  console.log(`\n✓ Backfilled ${backfilledCount} of ${emptySections.length} empty sections.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
