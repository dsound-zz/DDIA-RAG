import { LlamaParseReader } from "llama-cloud-services";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: ".env" });

async function main() {
  try {
    const reader = new LlamaParseReader({ resultType: "markdown" });
    const pdfPath = path.join(__dirname, "../Martin-Kleppmann---Designing-Data-Intensive-Applications_-O’Reilly-Media-(2017).pdf");
    
    // Load as Markdown Documents
    const docs = await reader.loadData(pdfPath);
    console.log(`Loaded ${docs.length} documents.`);
    if (docs.length > 0) {
      const text = docs[0].text;
      console.log("Total text length:", text.length);
      // Find all image references in the markdown
      const imageRefs = text.match(/!\[.*?\]\(.*?\)/g);
      console.log(`Found ${imageRefs?.length || 0} image references in markdown.`);
      if (imageRefs && imageRefs.length > 0) {
        console.log("Sample image refs:", imageRefs.slice(0, 5));
      }
    }
  } catch (err) {
    console.error(err);
  }
}
main();
