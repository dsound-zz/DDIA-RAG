import { NextResponse } from "next/server";
import { db } from "@/db/index";
import { structuralMetadata, textChunks } from "@/db/schema";
import { eq, asc, sql } from "drizzle-orm";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const requestUrl = new URL(request.url);
    const shouldIncludeChildChunks = requestUrl.searchParams.get("includeChildChunks") === "true";
    
    // 1. Fetch the selected section
    const [section] = await db
      .select()
      .from(structuralMetadata)
      .where(eq(structuralMetadata.id, id));

    if (!section) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    // 2. Fetch children (subsections) ordered by their position in the book
    const childSections = await db
      .select({
        id: structuralMetadata.id,
        title: structuralMetadata.title,
        level: structuralMetadata.level,
        summary: structuralMetadata.summary,
        orderIndex: structuralMetadata.orderIndex,
      })
      .from(structuralMetadata)
      .where(eq(structuralMetadata.parentSectionId, id))
      .orderBy(asc(structuralMetadata.orderIndex));

    // 3. For each child, get chunk count (and optionally chunks)
    const childrenWithMetadata = await Promise.all(
      childSections.map(async (child) => {
        const [countResult] = await db
          .select({ count: sql<number>`count(*)` })
          .from(textChunks)
          .where(eq(textChunks.sectionId, child.id));
        
        const chunkCount = Number(countResult.count);

        let chunks: { id: string; content: string; orderIndex: number; imageUrl: string | null }[] = [];
        if (shouldIncludeChildChunks && chunkCount > 0) {
          chunks = await db
            .select({
              id: textChunks.id,
              content: textChunks.content,
              orderIndex: textChunks.orderIndex,
              imageUrl: textChunks.imageUrl,
            })
            .from(textChunks)
            .where(eq(textChunks.sectionId, child.id))
            .orderBy(asc(textChunks.orderIndex));
        }

        return {
          ...child,
          chunkCount,
          chunks,
        };
      })
    );

    // 4. Fetch text chunks for this section itself
    const sectionChunks = await db
      .select({
        id: textChunks.id,
        content: textChunks.content,
        orderIndex: textChunks.orderIndex,
        imageUrl: textChunks.imageUrl,
      })
      .from(textChunks)
      .where(eq(textChunks.sectionId, id))
      .orderBy(asc(textChunks.orderIndex));

    return NextResponse.json({
      section,
      children: childrenWithMetadata,
      chunks: sectionChunks,
    });
  } catch (error) {
    console.error("Error fetching content:", error);
    return NextResponse.json(
      { error: "Failed to fetch content" },
      { status: 500 }
    );
  }
}
