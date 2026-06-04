import { LlamaParseReader } from "llama-cloud-services";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: ".env" });

async function main() {
  console.log("Testing LlamaParse...");
  try {
    const reader = new LlamaParseReader({ resultType: "markdown" });
    const pdfPath = path.join(__dirname, "../Martin-Kleppmann---Designing-Data-Intensive-Applications_-O’Reilly-Media-(2017).pdf");
    
    // Test with JSON mode to see what it outputs
    const readerJson = new LlamaParseReader({ resultType: "json" });
    const jsonObjs = await readerJson.loadJson(pdfPath);
    console.log(`Loaded ${jsonObjs.length} JSON objects.`);
    
    // Extract images
    const imageNodes = await readerJson.getImages(jsonObjs, path.join(__dirname, "../public/diagrams"));
    console.log(`Extracted ${imageNodes.length} images.`);
    
  } catch (error) {
    console.error("LlamaParse error:", error);
  }
}

main();
