import { NextResponse } from "next/server";
import { db } from "../../../../../db/index";
import { textChunks } from "../../../../../db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sectionId = params.id;
    
    // Fetch all text chunks for this section
    const chunks = await db
      .select({
        content: textChunks.content,
        imageUrl: textChunks.imageUrl,
      })
      .from(textChunks)
      .where(eq(textChunks.sectionId, sectionId))
      .orderBy(asc(textChunks.createdAt)); // Assuming they were inserted in order

    if (chunks.length === 0) {
      return NextResponse.json({ error: "No text found for this section." }, { status: 404 });
    }

    // Combine the text chunks
    // For MVP, just concatenate with double newline
    const fullText = chunks.map(c => c.content).join("\n\n");
    
    return NextResponse.json({ text: fullText, chunks: chunks });
  } catch (error) {
    console.error("Full Text Fetch Error:", error);
    return NextResponse.json({ error: "Failed to fetch full text." }, { status: 500 });
  }
}
