import { readFileSync } from "fs";
import path from "path";
const pdf = require("pdf-parse");
import Together from "together-ai";
import { db } from "../src/db/index";
import { books, structuralMetadata, textChunks } from "../src/db/schema";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY,
});

// A helper to chunk raw text roughly by characters
function splitTextIntoChunks(text: string, chunkSize = 8000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

function splitIntoEmbeddingChunks(text: string, chunkSize = 1500) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize).trim());
  }
  return chunks.filter(c => c.length > 0);
}

async function main() {
  console.log("Starting DDIA ingestion with Together AI...");
  
  // 1. Insert Book Record
  const pdfPath = path.join(__dirname, "../Martin-Kleppmann---Designing-Data-Intensive-Applications_-O’Reilly-Media-(2017).pdf");
  const [book] = await db.insert(books).values({
    title: "Designing Data-Intensive Applications",
    author: "Martin Kleppmann",
    filePath: pdfPath,
  }).returning();
  console.log(`Inserted book record with ID: ${book.id}`);

  // 2. Read PDF
  const dataBuffer = readFileSync(pdfPath);
  console.log("Parsing PDF...");
  const pdfData = await pdf(dataBuffer);
  console.log(`PDF Parsed. Total Pages: ${pdfData.numpages}`);
  
  // Clean up basic formatting
  const rawText = pdfData.text.replace(/\u0000/g, "");
  
  // Chunking the massive text into processable pieces for LLM
  const largeChunks = splitTextIntoChunks(rawText, 15000);
  
  // NOTE: For demonstration/MVP purposes, we will only process the first 3 chunks to avoid massive API bills/timeouts.
  // You can remove the slice() to process the whole book.
  const chunksToProcess = largeChunks.slice(0, 3);
  let orderIndex = 0;

  for (let i = 0; i < chunksToProcess.length; i++) {
    console.log(`Processing chunk ${i + 1}/${chunksToProcess.length}...`);
    const chunkText = chunksToProcess[i];
    
    // 3. Extract and Summarize using Meta-Llama-3.1-8B-Instruct
    const prompt = `You are an expert data engineering assistant. Analyze the following text excerpt from a technical book.
    Identify the main topic or chapter heading, and provide a brief summary of the concepts discussed.
    Output MUST be valid JSON with this structure:
    {
      "title": "String (the section or chapter title)",
      "level": "String (e.g., 'chapter', 'section')",
      "summary": "String (summary of the concepts)"
    }
    
    Text Excerpt:
    ${chunkText.slice(0, 8000)}... (truncated)
    `;

    try {
      const completion = await together.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        response_format: { type: "json_object" },
        max_tokens: 512,
        temperature: 0.1,
      });

      const responseText = completion.choices[0]?.message?.content || "{}";
      const parsedData = JSON.parse(responseText);

      // 4. Insert Structural Metadata
      const [section] = await db.insert(structuralMetadata).values({
        bookId: book.id,
        title: parsedData.title || `Extracted Section ${i}`,
        level: parsedData.level || "section",
        orderIndex: orderIndex++,
        summary: parsedData.summary || "No summary generated.",
      }).returning();
      
      console.log(`Saved section: ${section.title}`);

      // 5. Generate Embeddings for the chunk text
      // We break the large chunk into smaller 1000-char chunks for nomic-embed-text-v1.5
      const embedChunks = splitIntoEmbeddingChunks(chunkText);
      console.log(`Generating embeddings for ${embedChunks.length} text chunks...`);
      
      const embeddingsResponse = await together.embeddings.create({
        model: "intfloat/multilingual-e5-large-instruct",
        input: embedChunks,
      });

      const vectors = embeddingsResponse.data;

      // 6. Insert into Neon
      const insertData = embedChunks.map((text, idx) => ({
        sectionId: section.id,
        content: text,
        embedding: vectors[idx].embedding,
      }));

      await db.insert(textChunks).values(insertData);
      console.log(`Inserted ${insertData.length} vector chunks for section.`);

    } catch (err) {
      console.error(`Error processing chunk ${i + 1}:`, err);
    }
  }

  console.log("Ingestion complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
