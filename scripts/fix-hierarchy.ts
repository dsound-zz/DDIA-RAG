import { db } from "../src/db/index";
import { structuralMetadata } from "../src/db/schema";
import { asc, eq } from "drizzle-orm";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

async function main() {
  console.log("Fetching current flat TOC...");
  const flatTOC = await db.select({
    id: structuralMetadata.id,
    title: structuralMetadata.title,
    level: structuralMetadata.level,
  }).from(structuralMetadata).orderBy(asc(structuralMetadata.orderIndex));

  console.log(`Found ${flatTOC.length} sections. Building hierarchy using string rules...`);

  let currentParentId: string | null = null;
  
  for (const item of flatTOC) {
    const isChapter = item.title.toLowerCase().includes("chapter") || item.level === "chapter";
    
    if (isChapter) {
      currentParentId = item.id;
      await db.update(structuralMetadata)
        .set({ parentSectionId: null, level: "chapter" })
        .where(eq(structuralMetadata.id, item.id));
      console.log(`Set ${item.title} as Root Chapter.`);
    } else {
      // It's a subsection
      await db.update(structuralMetadata)
        .set({ parentSectionId: currentParentId, level: "section" })
        .where(eq(structuralMetadata.id, item.id));
      console.log(`Set ${item.title} under parent ${currentParentId}`);
    }
  }

  console.log("Hierarchy successfully built in the database!");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
