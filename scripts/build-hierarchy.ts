import { db } from "../src/db/index";
import { structuralMetadata } from "../src/db/schema";
import { asc, eq } from "drizzle-orm";
import Together from "together-ai";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

const together = new Together({
  apiKey: process.env.TOGETHER_API_KEY,
});

async function main() {
  console.log("Fetching current flat TOC...");
  const flatTOC = await db.select({
    id: structuralMetadata.id,
    title: structuralMetadata.title,
    level: structuralMetadata.level,
  }).from(structuralMetadata).orderBy(asc(structuralMetadata.orderIndex));

  console.log(`Found ${flatTOC.length} sections. Asking LLM to build hierarchy...`);

  const prompt = `You are a data structuring expert.
I have an array of 99 book sections extracted in chronological order. Currently, they are flat.
I need you to figure out the parent/child relationships based on the titles.
For example, a "Chapter" is a parent, and the subsequent "Sections" or concepts belong to that Chapter until a new Chapter begins.
If a title is clearly a root-level concept (like a Chapter, Part, or Book title), set its parentId to null.
If a title is a subsection or concept that belongs to the preceding Chapter, set its parentId to the id of that Chapter.

Here is the input array:
${JSON.stringify(flatTOC.map(item => ({ id: item.id, title: item.title })), null, 2)}

Return ONLY a JSON array of objects with "id", "parentId" (string or null), and "level" ("chapter", "section", or "subsection").
Make sure every ID from the input is included in the output!
Format:
[
  { "id": "uuid-here", "parentId": null, "level": "chapter" },
  { "id": "uuid-here", "parentId": "parent-uuid-here", "level": "section" }
]
`;

  try {
    const completion = await together.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      response_format: { type: "json_object" }, // Ensure JSON mode (will likely return an object with a root key)
      max_tokens: 4000,
      temperature: 0.1,
    });

    let responseText = completion.choices[0]?.message?.content || "[]";
    
    // Together AI JSON mode usually wraps arrays in an object if forced, or just returns the array.
    // Let's parse it safely.
    let parsedData = JSON.parse(responseText);
    
    // If it's an object with a single key holding the array, extract it
    if (!Array.isArray(parsedData)) {
      const keys = Object.keys(parsedData);
      if (keys.length === 1 && Array.isArray(parsedData[keys[0]])) {
        parsedData = parsedData[keys[0]];
      } else {
        throw new Error("LLM did not return a recognizable array format.");
      }
    }

    console.log(`LLM returned ${parsedData.length} items. Updating database...`);

    for (const item of parsedData) {
      if (!item.id) continue;
      
      await db.update(structuralMetadata)
        .set({
          parentSectionId: item.parentId || null,
          level: item.level || "section",
        })
        .where(eq(structuralMetadata.id, item.id));
    }

    console.log("Hierarchy successfully built in the database!");
    process.exit(0);
  } catch (error) {
    console.error("Error building hierarchy:", error);
    process.exit(1);
  }
}

main();
