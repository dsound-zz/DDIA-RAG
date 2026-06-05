import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

import path from "path";
import { eq } from "drizzle-orm";
import { LlamaParseReader } from "llama-cloud-services";
import Together from "together-ai";
import { db } from "../src/db/index";
import { structuralMetadata, textChunks } from "../src/db/schema";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TOGETHER_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo";
const EMBEDDING_MODEL = "intfloat/multilingual-e5-large-instruct";
const EMBEDDING_BATCH_SIZE = 10; // Together AI limit
const JACCARD_MATCH_THRESHOLD = 0.3;
const MAX_PARAGRAPH_CHARS = 2000;

const PDF_FILENAME =
  "Martin-Kleppmann---Designing-Data-Intensive-Applications_-O\u2019Reilly-Media-(2017).pdf";

const SUMMARY_PROMPT = `Extract 3-5 key concepts from this section as bullet points. Each bullet should be a concise concept name followed by a brief explanation (1-2 sentences). Return ONLY the bullet points, no introduction or conclusion.`;

// ---------------------------------------------------------------------------
// Together AI client
// ---------------------------------------------------------------------------

const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StructuralMetadataRow {
  id: string;
  bookId: string;
  parentSectionId: string | null;
  title: string;
  level: string;
  orderIndex: number;
  summary: string | null;
  createdAt: Date;
}

interface ParsedMarkdownSection {
  headingLevel: number;
  headingText: string;
  bodyText: string;
}

// ---------------------------------------------------------------------------
// Jaccard similarity — tokenise titles to lowercase words, compute
// intersection / union. This tolerates minor differences between
// LlamaParse's heading text and the deterministic TOC titles.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Content quality helpers — strip PDF artifacts before processing
// ---------------------------------------------------------------------------

/** Remove dotted leader lines, page numbers, publishing boilerplate, etc. */
function stripPdfArtifacts(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmedLine = line.trim();
      // Skip empty lines (they'll be preserved as paragraph breaks)
      if (trimmedLine.length === 0) return true;
      // Dotted leader lines: "......................... 28"
      if (/^[\s.\u2026\u00b7\-_]+\d*\s*$/.test(trimmedLine)) return false;
      // Standalone page numbers
      if (/^\d{1,4}\s*$/.test(trimmedLine)) return false;
      // Publishing boilerplate
      if (/^(NO_CONTENT_HERE|FILL IN|Release Early|UNEDITED RAW)/i.test(trimmedLine)) return false;
      // Lines that are just "Table of Contents" or "Chapter N"
      if (/^(Table of Contents|Chapter \d+|Part [IVX]+)\s*$/i.test(trimmedLine)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

/** Check if text has enough real words (not just punctuation/numbers) */
function hasSubstantialContent(text: string): boolean {
  // Count alphabetic characters vs total length
  const alphaChars = (text.match(/[a-zA-Z]/g) || []).length;
  const ratio = alphaChars / Math.max(text.length, 1);
  // At least 30% of characters should be letters, and at least 50 alpha chars
  return ratio > 0.3 && alphaChars > 50;
}

function tokenizeToLowercaseWords(text: string): Set<string> {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter((word) => word.length > 0);
  return new Set(words);
}

function computeJaccardSimilarity(textA: string, textB: string): number {
  const tokensA = tokenizeToLowercaseWords(textA);
  const tokensB = tokenizeToLowercaseWords(textB);

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersectionSize++;
    }
  }

  const unionSize = new Set([...tokensA, ...tokensB]).size;
  return intersectionSize / unionSize;
}

/** Normalize a title for substring comparison */
function normalizeForSubstring(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function findBestMatchingSection(
  headingText: string,
  allSections: StructuralMetadataRow[],
  alreadyMatchedIds: Set<string>,
): { matchedSection: StructuralMetadataRow; similarity: number } | null {
  let bestMatch: StructuralMetadataRow | null = null;
  let bestSimilarity = 0;

  for (const section of allSections) {
    if (alreadyMatchedIds.has(section.id)) continue;

    const similarity = computeJaccardSimilarity(headingText, section.title);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = section;
    }
  }

  if (bestMatch && bestSimilarity >= JACCARD_MATCH_THRESHOLD) {
    return { matchedSection: bestMatch, similarity: bestSimilarity };
  }

  // Fallback: substring containment match
  const normalizedHeading = normalizeForSubstring(headingText);
  for (const section of allSections) {
    if (alreadyMatchedIds.has(section.id)) continue;
    const normalizedTitle = normalizeForSubstring(section.title);
    if (
      normalizedHeading.includes(normalizedTitle) ||
      normalizedTitle.includes(normalizedHeading)
    ) {
      return { matchedSection: section, similarity: 0.25 };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Markdown section splitter — splits LlamaParse output on heading boundaries
// (# through ####). Each section contains the heading text and everything
// until the next heading or end-of-document.
// ---------------------------------------------------------------------------

function splitMarkdownIntoSections(markdownContent: string): ParsedMarkdownSection[] {
  const lines = markdownContent.split("\n");
  const sections: ParsedMarkdownSection[] = [];
  let currentSection: ParsedMarkdownSection | null = null;
  const bodyLines: string[] = [];

  function flushCurrentSection() {
    if (currentSection) {
      currentSection.bodyText = bodyLines.join("\n").trim();
      if (currentSection.bodyText.length > 0 || currentSection.headingText.length > 0) {
        sections.push(currentSection);
      }
      bodyLines.length = 0;
    }
  }

  const headingRegex = /^(#{1,4})\s+(.+)$/;

  for (const line of lines) {
    const headingMatch = line.match(headingRegex);
    if (headingMatch) {
      flushCurrentSection();
      const hashCount = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      currentSection = {
        headingLevel: hashCount,
        headingText,
        bodyText: "",
      };
    } else {
      bodyLines.push(line);
    }
  }

  // Flush the last section
  flushCurrentSection();

  return sections;
}

// ---------------------------------------------------------------------------
// Smart chunking — split on paragraph boundaries (double newline).
// If a single paragraph exceeds MAX_PARAGRAPH_CHARS, split on sentence
// boundaries (period + space or period + newline).
// ---------------------------------------------------------------------------

function splitTextIntoParagraphChunks(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  // Strip PDF artifacts first
  const cleanedText = stripPdfArtifacts(text);
  if (cleanedText.length === 0) return [];

  // Split on double-newlines (paragraph boundaries)
  const rawParagraphs = cleanedText.split(/\n\n+/);
  const chunks: string[] = [];

  for (const paragraph of rawParagraphs) {
    const trimmedParagraph = paragraph.trim();
    // Skip empty paragraphs and short artifacts
    if (trimmedParagraph.length < 40) continue;
    // Skip paragraphs that are mostly non-alphabetic (page numbers, dotted lines, etc.)
    if (!hasSubstantialContent(trimmedParagraph)) continue;

    if (trimmedParagraph.length <= MAX_PARAGRAPH_CHARS) {
      chunks.push(trimmedParagraph);
    } else {
      // Paragraph is too long — split on sentence boundaries
      const sentenceChunks = splitLongParagraphOnSentences(trimmedParagraph);
      chunks.push(...sentenceChunks);
    }
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function splitLongParagraphOnSentences(paragraph: string): string[] {
  // Split on sentence-ending punctuation followed by a space or newline
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length + 1 > MAX_PARAGRAPH_CHARS && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk.length > 0 ? " " : "") + sentence;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// LLM summary generation via Together AI
// ---------------------------------------------------------------------------

async function generateSectionSummary(sectionText: string): Promise<string | null> {
  // Strip artifacts before sending to LLM
  const cleanedText = stripPdfArtifacts(sectionText);

  // Guard: if the cleaned text is too short or has no real content, skip summary
  if (cleanedText.length < 100 || !hasSubstantialContent(cleanedText)) {
    console.log(`           ⚠ Insufficient content after cleaning (${cleanedText.length} chars) — skipping summary`);
    return null;
  }

  // Truncate to avoid hitting token limits — use first ~6000 chars
  const truncatedText = cleanedText.slice(0, 6000);

  const completion = await together.chat.completions.create({
    messages: [
      {
        role: "system",
        content: SUMMARY_PROMPT,
      },
      {
        role: "user",
        content: truncatedText,
      },
    ],
    model: TOGETHER_MODEL,
    max_tokens: 512,
    temperature: 0.1,
  });

  const responseContent = completion.choices[0]?.message?.content;
  if (!responseContent) return null;

  // Post-validate: reject LLM meta-commentary about empty input
  const lowerResponse = responseContent.toLowerCase();
  if (
    lowerResponse.includes("no concepts provided") ||
    lowerResponse.includes("no text to extract") ||
    lowerResponse.includes("the input is empty") ||
    lowerResponse.includes("insufficient data") ||
    lowerResponse.includes("concept extraction")
  ) {
    console.log(`           ⚠ LLM generated meta-commentary instead of real summary — discarding`);
    return null;
  }

  return responseContent;
}

// ---------------------------------------------------------------------------
// Embedding generation — batched to respect Together AI's limit of 10 texts
// ---------------------------------------------------------------------------

async function generateEmbeddingsInBatches(
  textChunkContents: string[],
): Promise<number[][]> {
  const allEmbeddings: number[][] = [];

  for (let batchStart = 0; batchStart < textChunkContents.length; batchStart += EMBEDDING_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + EMBEDDING_BATCH_SIZE, textChunkContents.length);
    const batch = textChunkContents.slice(batchStart, batchEnd);

    const embeddingsResponse = await together.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });

    for (const embeddingData of embeddingsResponse.data) {
      allEmbeddings.push(embeddingData.embedding);
    }
  }

  return allEmbeddings;
}

// ---------------------------------------------------------------------------
// Main ingestion pipeline
// ---------------------------------------------------------------------------

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  DDIA Structured Ingestion                                 ║");
  console.log("║  LlamaParse → Heading Match → LLM Summary → Embeddings    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ── Step 1: Load existing structural metadata from the database ────────
  console.log("Step 1: Loading structural metadata from database...");
  const allSections = await db.select().from(structuralMetadata);

  if (allSections.length === 0) {
    console.error(
      "ERROR: No structural_metadata rows found. Run ddia-toc-seed.ts first.",
    );
    process.exit(1);
  }

  console.log(`  Found ${allSections.length} structural_metadata entries.\n`);

  // ── Step 2: Parse the PDF with LlamaParse ──────────────────────────────
  console.log("Step 2: Parsing PDF with LlamaParse (this may take a few minutes)...");
  const pdfPath = path.resolve(process.cwd(), PDF_FILENAME);

  const llamaParseReader = new LlamaParseReader({ resultType: "markdown" });
  const parsedDocuments = await llamaParseReader.loadData(pdfPath);
  console.log(`  LlamaParse returned ${parsedDocuments.length} document(s).\n`);

  // Combine all documents into a single markdown string
  const fullMarkdownContent = parsedDocuments.map((doc) => doc.text).join("\n\n");
  console.log(`  Total markdown length: ${fullMarkdownContent.length.toLocaleString()} chars.\n`);

  // ── Step 3: Split markdown into heading-delimited sections ─────────────
  console.log("Step 3: Splitting markdown by headings...");
  const markdownSections = splitMarkdownIntoSections(fullMarkdownContent);
  console.log(`  Found ${markdownSections.length} markdown sections.\n`);

  // ── Step 4: Match, summarize, chunk, and embed each section ────────────
  console.log("Step 4: Matching sections, generating summaries, and embedding chunks...\n");

  const alreadyMatchedSectionIds = new Set<string>();
  let totalChunksInserted = 0;
  let totalSectionsMatched = 0;
  let totalSectionsSkipped = 0;

  // First, delete any existing text_chunks (in case of re-run)
  // We do NOT delete structural_metadata — the seed script owns that.
  console.log("  Clearing existing text_chunks for a fresh ingestion...");
  await db.delete(textChunks);
  console.log("  ✓ text_chunks cleared.\n");

  for (let sectionIndex = 0; sectionIndex < markdownSections.length; sectionIndex++) {
    const markdownSection = markdownSections[sectionIndex];
    const sectionLabel = `[${sectionIndex + 1}/${markdownSections.length}]`;

    // Strip artifacts and validate content quality
    const cleanedBodyText = stripPdfArtifacts(markdownSection.bodyText);
    // Use a lower threshold (80 chars) to catch short subsections that are still meaningful
    const minimumContentLength = 80;
    if (cleanedBodyText.length < minimumContentLength || !hasSubstantialContent(cleanedBodyText)) {
      console.log(
        `  ${sectionLabel} SKIP (insufficient content after cleaning): "${markdownSection.headingText}" (${cleanedBodyText.length} clean chars)`,
      );
      totalSectionsSkipped++;
      continue;
    }

    // Attempt to match against structural_metadata entries
    const matchResult = findBestMatchingSection(
      markdownSection.headingText,
      allSections,
      alreadyMatchedSectionIds,
    );

    if (!matchResult) {
      console.log(
        `  ${sectionLabel} UNMATCHED: "${markdownSection.headingText}" — no TOC entry above threshold ${JACCARD_MATCH_THRESHOLD}`,
      );
      totalSectionsSkipped++;
      continue;
    }

    const { matchedSection, similarity } = matchResult;
    alreadyMatchedSectionIds.add(matchedSection.id);
    totalSectionsMatched++;

    console.log(
      `  ${sectionLabel} MATCHED: "${markdownSection.headingText}" → "${matchedSection.title}" (similarity: ${similarity.toFixed(2)})`,
    );

    try {
      // ── 4a: Generate LLM summary ──────────────────────────────────────
      console.log(`           Generating summary...`);
      const generatedSummary = await generateSectionSummary(markdownSection.bodyText);

      if (generatedSummary) {
        // Update the structural_metadata row's summary field
        await db
          .update(structuralMetadata)
          .set({ summary: generatedSummary })
          .where(eq(structuralMetadata.id, matchedSection.id));

        console.log(`           ✓ Summary saved (${generatedSummary.length} chars)`);
      }

      // ── 4b: Split body text into paragraph-based chunks ───────────────
      const paragraphChunks = splitTextIntoParagraphChunks(markdownSection.bodyText);

      if (paragraphChunks.length === 0) {
        console.log(`           ⚠ No chunks produced — skipping embedding.`);
        continue;
      }

      // ── 4c: Generate embeddings in batches of 10 ──────────────────────
      console.log(
        `           Embedding ${paragraphChunks.length} chunks (in batches of ${EMBEDDING_BATCH_SIZE})...`,
      );
      const chunkEmbeddings = await generateEmbeddingsInBatches(paragraphChunks);

      // ── 4d: Insert text_chunks rows with sectionId ────────────────────
      const chunkInsertValues = paragraphChunks.map((chunkContent, chunkIndex) => ({
        sectionId: matchedSection.id,
        content: chunkContent,
        orderIndex: chunkIndex,
        embedding: chunkEmbeddings[chunkIndex],
      }));

      await db.insert(textChunks).values(chunkInsertValues);
      totalChunksInserted += chunkInsertValues.length;

      console.log(
        `           ✓ Inserted ${chunkInsertValues.length} chunks (total: ${totalChunksInserted})`,
      );
    } catch (sectionError) {
      console.error(
        `           ✗ Error processing "${matchedSection.title}":`,
        sectionError instanceof Error ? sectionError.message : sectionError,
      );
      // Continue with the next section — don't abort the whole pipeline
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Ingestion Complete                                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  Sections matched:  ${totalSectionsMatched}`);
  console.log(`  Sections skipped:  ${totalSectionsSkipped}`);
  console.log(`  Total chunks:      ${totalChunksInserted}`);
  console.log(`  Unmatched TOC entries: ${allSections.length - alreadyMatchedSectionIds.size} of ${allSections.length}`);
  console.log("");

  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error during structured ingestion:", error);
  process.exit(1);
});
