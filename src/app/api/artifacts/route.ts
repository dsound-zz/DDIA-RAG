import { NextResponse } from "next/server";
import { db } from "@/db/index";
import { savedArtifacts } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const artifacts = await db
      .select()
      .from(savedArtifacts)
      .orderBy(desc(savedArtifacts.createdAt));

    return NextResponse.json({ artifacts });
  } catch (error) {
    console.error("Error fetching artifacts:", error);
    return NextResponse.json({ error: "Failed to fetch artifacts" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sectionId, title, content, artifactType } = body;

    if (!title || !content) {
      return NextResponse.json({ error: "Title and content are required" }, { status: 400 });
    }

    const [inserted] = await db
      .insert(savedArtifacts)
      .values({
        sectionId: sectionId || null,
        title,
        content,
        artifactType: artifactType || "chat_response",
      })
      .returning();

    return NextResponse.json({ artifact: inserted }, { status: 201 });
  } catch (error) {
    console.error("Error saving artifact:", error);
    return NextResponse.json({ error: "Failed to save artifact" }, { status: 500 });
  }
}
