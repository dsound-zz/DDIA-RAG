import { NextResponse } from "next/server";
import { db } from "@/db/index";
import { textChunks } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getSectionContent } from "@/lib/section-content";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Authoritative book text extracted from the PDF. Paragraphs are
    // separated by blank lines; figures appear inline as markdown image
    // tokens: ![Figure X-Y. caption](/figures/fig-X-Y.png)
    const sectionContent = getSectionContent(id);
    if (sectionContent && sectionContent.text.length > 0) {
      return NextResponse.json({
        text: sectionContent.text,
        figures: sectionContent.figures,
        source: "pdf",
      });
    }

    // Fallback: concatenated RAG chunks (partial coverage).
    const chunks = await db
      .select({
        content: textChunks.content,
        imageUrl: textChunks.imageUrl,
      })
      .from(textChunks)
      .where(eq(textChunks.sectionId, id))
      .orderBy(asc(textChunks.orderIndex));

    if (chunks.length === 0) {
      return NextResponse.json({ error: "No text found for this section." }, { status: 404 });
    }

    const fullText = chunks.map(c => c.content).join("\n\n");
    return NextResponse.json({ text: fullText, figures: [], source: "chunks" });
  } catch (error) {
    console.error("Full Text Fetch Error:", error);
    return NextResponse.json({ error: "Failed to fetch full text." }, { status: 500 });
  }
}
