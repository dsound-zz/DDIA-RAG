import { LlamaParseReader } from "llama-cloud-services";
import Together from "together-ai";
import { db } from "../src/db/index";
import { books, structuralMetadata, textChunks } from "../src/db/schema";
import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: ".env" });

const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY,
});

function splitIntoEmbeddingChunks(text: string, chunkSize = 1500) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize).trim());
  }
  return chunks.filter(c => c.length > 0);
}

// Convert local image to base64 for Together Vision
function encodeImageToBase64(filePath: string) {
  const imageBuffer = fs.readFileSync(filePath);
  return imageBuffer.toString("base64");
}

async function summarizeImage(imagePath: string): Promise<string> {
  const base64Img = encodeImageToBase64(imagePath);
  try {
    const response = await together.chat.completions.create({
      model: "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this technical diagram or image in detail. Focus on the concepts, architecture, and data flow. Return ONLY the description, no conversational filler." },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Img}`,
              },
            },
          ],
        },
      ],
      max_tokens: 512,
    });
    return response.choices[0]?.message?.content || "An image showing technical concepts.";
  } catch (error) {
    console.error("Vision Error:", error);
    return "A technical diagram.";
  }
}

async function main() {
  console.log("Starting Multimodal Ingestion...");
  
  const pdfPath = path.join(__dirname, "../Martin-Kleppmann---Designing-Data-Intensive-Applications_-O’Reilly-Media-(2017).pdf");
  const diagramsDir = path.join(__dirname, "../public/diagrams");

  // 1. LlamaParse
  const reader = new LlamaParseReader({ resultType: "markdown" });
  console.log("Uploading and Parsing PDF with LlamaParse...");
  const docs = await reader.loadData(pdfPath);
  console.log(`Successfully extracted ${docs.length} pages of markdown text.`);

  // Clear existing data for fresh ingestion
  console.log("Clearing old database records...");
  await db.delete(books);

  const [book] = await db.insert(books).values({
    title: "Designing Data-Intensive Applications",
    author: "Martin Kleppmann",
    filePath: pdfPath,
  }).returning();

  let orderIndex = 0;

  // Process pages in batches to avoid overwhelming the LLM and to group them into chapters logically.
  // For this implementation, we will process 5 pages at a time as a "section".
  const batchSize = 5;
  for (let i = 0; i < docs.length; i += batchSize) {
    console.log(`Processing pages ${i} to ${Math.min(i + batchSize, docs.length)}...`);
    const batchDocs = docs.slice(i, i + batchSize);
    const combinedText = batchDocs.map(d => d.text).join("\n\n");
    
    if (combinedText.trim().length < 50) continue; // Skip empty sections

    // Extract section metadata
    const prompt = `You are an expert data engineering assistant. Analyze the following text excerpt from a technical book.
    Identify the main topic or chapter heading, and provide a brief summary of the concepts discussed.
    Output MUST be valid JSON with this structure:
    {
      "title": "String (the section or chapter title)",
      "level": "String (e.g., 'chapter', 'section')",
      "summary": "String (summary of the concepts)"
    }
    
    Text Excerpt:
    ${combinedText.slice(0, 6000)}... (truncated)
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

      // Insert Structural Metadata
      const [section] = await db.insert(structuralMetadata).values({
        bookId: book.id,
        title: parsedData.title || `Extracted Section ${orderIndex}`,
        level: parsedData.level || "section",
        orderIndex: orderIndex++,
        summary: parsedData.summary || "No summary generated.",
      }).returning();
      
      console.log(`Saved section: ${section.title}`);

      // Embed chunks
      const embedChunks = splitIntoEmbeddingChunks(combinedText);
      const embeddingsResponse = await together.embeddings.create({
        model: "intfloat/multilingual-e5-large-instruct",
        input: embedChunks,
      });
      const vectors = embeddingsResponse.data;

      const insertData = embedChunks.map((text, idx) => ({
        sectionId: section.id,
        content: text,
        embedding: vectors[idx].embedding,
      }));

      await db.insert(textChunks).values(insertData);

      // Now, let's see if any images were extracted for these pages (Assuming images are named page_X.jpg)
      // We will look in public/diagrams for images ending in page_X.jpg
      const files = fs.readdirSync(diagramsDir);
      for (let pageNum = i + 1; pageNum <= i + batchSize; pageNum++) {
        const imageFile = files.find(f => f.includes(`page_${pageNum}.jpg`) || f.includes(`page_${pageNum}.png`));
        if (imageFile) {
          console.log(`Found image for page ${pageNum}: ${imageFile}. Summarizing with Vision...`);
          const imgPath = path.join(diagramsDir, imageFile);
          const visionSummary = await summarizeImage(imgPath);
          
          // Embed the vision summary
          const visionEmbedResponse = await together.embeddings.create({
            model: "intfloat/multilingual-e5-large-instruct",
            input: `[DIAGRAM DESCRIPTION] ${visionSummary}`,
          });

          // Insert the image and description into textChunks
          await db.insert(textChunks).values({
            sectionId: section.id,
            content: `[DIAGRAM/IMAGE] ${visionSummary}`,
            imageUrl: `/diagrams/${imageFile}`,
            embedding: visionEmbedResponse.data[0].embedding,
          });
          console.log(`Saved diagram summary for page ${pageNum}`);
        }
      }
    } catch (err) {
      console.error(`Error processing batch starting at page ${i}:`, err);
    }
  }

  console.log("Multimodal Ingestion complete.");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
