import { db } from "../src/db/index";
import { textChunks } from "../src/db/schema";
import { cosineDistance, desc, sql } from "drizzle-orm";
import { embedTexts } from "../src/lib/embeddings";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const query = "What is the difference between synchronous and asynchronous replication?";
  const [vector] = await embedTexts([query]);

  const similarity = sql<number>`1 - (${cosineDistance(textChunks.embedding, vector)})`;
  const results = await db
    .select({
      id: textChunks.id,
      similarity,
    })
    .from(textChunks)
    .orderBy(desc(similarity))
    .limit(2);
    
  console.log(results);
  process.exit(0);
}
main();
