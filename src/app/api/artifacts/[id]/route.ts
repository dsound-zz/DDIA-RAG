import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db/index";
import { savedArtifacts } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  try {
    const { id } = await params;

    const [deleted] = await db
      .delete(savedArtifacts)
      .where(and(eq(savedArtifacts.id, id), eq(savedArtifacts.userId, session.user.id)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting artifact:", error);
    return NextResponse.json({ error: "Failed to delete artifact" }, { status: 500 });
  }
}
