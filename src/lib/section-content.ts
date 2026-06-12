import fs from "fs";
import path from "path";

/**
 * Authoritative per-section book content, extracted straight from the PDF by
 * scripts/extract-section-content.ts. The RAG chunks in the database only
 * cover text whose headings matched during LlamaParse ingestion, so reading
 * content (full text + figure placement) is served from this artifact
 * instead.
 */

export type SectionFigure = { label: string; caption: string; file: string };
export type SectionContent = { title: string; text: string; figures: SectionFigure[] };

let cache: Record<string, SectionContent> | null = null;

function loadAll(): Record<string, SectionContent> {
  if (cache === null) {
    const filePath = path.join(process.cwd(), "data", "section-content.json");
    cache = JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  return cache!;
}

export function getSectionContent(sectionId: string): SectionContent | null {
  return loadAll()[sectionId] ?? null;
}
