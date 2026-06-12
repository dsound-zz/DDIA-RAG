import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/db/index";
import { structuralMetadata } from "@/db/schema";
import { asc } from "drizzle-orm";

// Load the section-content index once per cold start to identify which
// sections have PDF-extracted text. Ch.12 and the Glossary don't exist in
// this early-release edition, so they'll have no text and should be visually
// dimmed in the sidebar to signal that the content is from the final edition.
function loadContentIndex(): Set<string> {
  try {
    const filePath = path.join(process.cwd(), "data", "section-content.json");
    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, { text: string }>;
    return new Set(
      Object.entries(data)
        .filter(([, v]) => v.text.length > 0)
        .map(([k]) => k),
    );
  } catch {
    return new Set();
  }
}

let contentIndex: Set<string> | null = null;

export async function GET() {
  if (!contentIndex) contentIndex = loadContentIndex();
  try {
    const sections = await db
      .select({
        id: structuralMetadata.id,
        parentSectionId: structuralMetadata.parentSectionId,
        title: structuralMetadata.title,
        level: structuralMetadata.level,
        orderIndex: structuralMetadata.orderIndex,
        summary: structuralMetadata.summary,
      })
      .from(structuralMetadata)
      .orderBy(asc(structuralMetadata.orderIndex));

    const sectionsWithContent = sections.map(s => ({
      ...s,
      hasContent: contentIndex!.has(s.id),
    }));

    return NextResponse.json({ sections: sectionsWithContent });
  } catch (error) {
    console.error("ToC Fetch Error:", error);
    return NextResponse.json({ error: "Failed to fetch table of contents." }, { status: 500 });
  }
}
