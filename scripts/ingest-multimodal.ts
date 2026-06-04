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

async function main() {
  console.log("Starting Multimodal Ingestion...");
  
  const pdfPath = path.join(__dirname, "../Martin-Kleppmann---Designing-Data-Intensive-Applications_-O’Reilly-Media-(2017).pdf");
  const diagramsDir = path.join(__dirname, "../public/diagrams");

  // Clear existing data for fresh ingestion
  await db.delete(books);

  const [book] = await db.insert(books).values({
    title: "Designing Data-Intensive Applications",
    author: "Martin Kleppmann",
    filePath: pdfPath,
  }).returning();

  // 1. LlamaParse
  const reader = new LlamaParseReader({ resultType: "json" });
  console.log("Uploading and Parsing PDF with LlamaParse (This will take a few minutes)...");
  
  const jsonObjs = await reader.loadJson(pdfPath);
  console.log(`Successfully extracted ${jsonObjs.length} JSON page objects.`);

  console.log("Extracting images...");
  const imageNodes = await reader.getImages(jsonObjs, diagramsDir);
  console.log(`Extracted ${imageNodes.length} images to ${diagramsDir}.`);

  // TODO: We need to parse the JSON output into structural chunks, extract the image URL refs, 
  // run the Llama 3.2 Vision summarization on the images, and embed the text into Neon!
  // This will be built in the next step.
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
