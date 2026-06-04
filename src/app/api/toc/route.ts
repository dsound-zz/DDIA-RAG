import { NextResponse } from "next/server";
import { db } from "../../../db/index";
import { structuralMetadata } from "../../../db/schema";
import { asc } from "drizzle-orm";

export async function GET() {
  try {
    const sections = await db
      .select({
        id: structuralMetadata.id,
        title: structuralMetadata.title,
        level: structuralMetadata.level,
        orderIndex: structuralMetadata.orderIndex,
        summary: structuralMetadata.summary,
      })
      .from(structuralMetadata)
      .orderBy(asc(structuralMetadata.orderIndex));

    return NextResponse.json({ sections });
  } catch (error) {
    console.error("ToC Fetch Error:", error);
    return NextResponse.json({ error: "Failed to fetch table of contents." }, { status: 500 });
  }
}
