import { NextResponse } from "next/server";
import { db } from "@/db/index";
import { savedArtifacts } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [deleted] = await db
      .delete(savedArtifacts)
      .where(eq(savedArtifacts.id, id))
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
