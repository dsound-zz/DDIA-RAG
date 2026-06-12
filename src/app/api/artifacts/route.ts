import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/index";
import { savedArtifacts } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ artifacts: [] });
  }
  try {
    const artifacts = await db
      .select()
      .from(savedArtifacts)
      .where(eq(savedArtifacts.userId, session.user.id))
      .orderBy(desc(savedArtifacts.createdAt));

    return NextResponse.json({ artifacts });
  } catch (error) {
    console.error("Error fetching artifacts:", error);
    return NextResponse.json({ error: "Failed to fetch artifacts" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { sectionId, title, content, artifactType } = body;

    if (!title || !content) {
      return NextResponse.json({ error: "Title and content are required" }, { status: 400 });
    }

    const [inserted] = await db
      .insert(savedArtifacts)
      .values({
        userId: session.user.id,
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
