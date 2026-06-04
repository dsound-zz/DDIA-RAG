import { NextResponse } from "next/server";
import { db } from "@/db/index";
import { structuralMetadata, textChunks } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // 1. Fetch the selected section
    const [section] = await db
      .select()
      .from(structuralMetadata)
      .where(eq(structuralMetadata.id, id));

    if (!section) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    // 2. Fetch children (subsections)
    const children = await db
      .select({
        id: structuralMetadata.id,
        title: structuralMetadata.title,
        summary: structuralMetadata.summary,
      })
      .from(structuralMetadata)
      .where(eq(structuralMetadata.parentSectionId, id));

    // 3. Fetch text chunks and images for the selected section itself
    const chunks = await db
      .select({
        id: textChunks.id,
        content: textChunks.content,
        imageUrl: textChunks.imageUrl,
      })
      .from(textChunks)
      .where(eq(textChunks.sectionId, id));

    return NextResponse.json({
      section,
      children,
      chunks,
    });
  } catch (error) {
    console.error("Error fetching content:", error);
    return NextResponse.json(
      { error: "Failed to fetch content" },
      { status: 500 }
    );
  }
}
