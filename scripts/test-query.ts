import { db } from "../src/db/index";
import { textChunks } from "../src/db/schema";
import { cosineDistance, desc, sql } from "drizzle-orm";
import Together from "together-ai";
import * as dotenv from "dotenv";
dotenv.config();

const together = new Together();

async function main() {
  const query = "What is the difference between synchronous and asynchronous replication?";
  const embeddingsResponse = await together.embeddings.create({
    model: "intfloat/multilingual-e5-large-instruct",
    input: [query],
  });
  const vector = embeddingsResponse.data[0].embedding;

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
