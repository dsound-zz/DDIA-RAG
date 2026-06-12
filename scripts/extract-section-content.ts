import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

import fs from "fs";
import path from "path";
import { asc } from "drizzle-orm";
import { db } from "../src/db/index";
import { structuralMetadata } from "../src/db/schema";
import { loadPages, isBodyText, isFooter, getFigureLabel } from "./lib-pdf-layout.mjs";

/**
 * Extract the authoritative full reading text (and figure placement) for
 * every TOC section, straight from the PDF.
 *
 * The RAG chunks in Neon only cover text whose headings fuzzy-matched during
 * LlamaParse ingestion, so they can't serve as "read the book" content.
 * Instead this script locates each structural_metadata title as a heading in
 * the PDF layout (in TOC order), slices the book into per-section ranges,
 * and assembles clean paragraphs — skipping running footers and the inside
 * of figure regions (diagram labels), and replacing figure captions with
 * markdown image tokens that the UI renders inline.
 *
 * Run scripts/extract-figures.mjs first (it produces figures-manifest.json).
 *
 * Output: data/section-content.json
 *   { [sectionId]: { title, text, figures: [{ label, caption, file }] } }
 */

const MANIFEST_PATH = path.resolve("scripts/figures-manifest.json");
const OUTPUT_PATH = path.resolve("data/section-content.json");
const FRONT_MATTER_PAGES = 18; // skip cover + printed TOC when matching headings
const HEADING_LOOKAHEAD = 8;

type Block = {
  xMin: number; yMin: number; xMax: number; yMax: number;
  words: string[]; maxLineHeight: number; text: string;
};
type Page = { pageNumber: number; width: number; height: number; blocks: Block[] };
type ManifestEntry = {
  label: string; caption: string; page: number; file: string;
  region: { yTop: number; yBottom: number };
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function jaccard(a: string, b: string): number {
  const tokensA = new Set(a.split(" "));
  const tokensB = new Set(b.split(" "));
  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection++;
  return intersection / (tokensA.size + tokensB.size - intersection);
}

/**
 * This early-release PDF stylizes some headings differently from the seeded
 * TOC ("Message passing data flow" vs "Message-Passing Dataflow", "Comparing
 * B-trees to LSM-trees" vs "...and LSM-Trees"), and some headings carry a
 * subtitle the seed omits ("Operability: Making Life Easy for Operations").
 */
function headingMatchesTitle(normalizedBlock: string, normalizedTitle: string): boolean {
  if (normalizedBlock === normalizedTitle) return true;
  if (normalizedBlock.replace(/ /g, "") === normalizedTitle.replace(/ /g, "")) return true;
  // Fuzzy rules need a reasonably long title — otherwise generic titles like
  // "Summary" prefix-match unrelated sub-headings ("Summary of serial execution").
  if (normalizedTitle.length < 10) return false;
  if (
    normalizedBlock.startsWith(normalizedTitle + " ") &&
    normalizedBlock.length <= normalizedTitle.length + 40
  ) return true;
  return jaccard(normalizedBlock, normalizedTitle) >= 0.6;
}

/** Position of a block in global reading order. */
function positionKey(pageNumber: number, yMin: number): number {
  return pageNumber * 10000 + yMin;
}

async function main() {
  const figures: ManifestEntry[] = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const figureByPage = new Map<number, ManifestEntry[]>();
  for (const figure of figures) {
    const list = figureByPage.get(figure.page) ?? [];
    list.push(figure);
    figureByPage.set(figure.page, list);
  }

  const sections = await db
    .select({
      id: structuralMetadata.id,
      title: structuralMetadata.title,
      level: structuralMetadata.level,
      orderIndex: structuralMetadata.orderIndex,
    })
    .from(structuralMetadata)
    .orderBy(asc(structuralMetadata.orderIndex));
  console.log(`Loaded ${sections.length} TOC sections.`);

  console.log("Parsing PDF layout (pdftotext)...");
  const pages: Page[] = loadPages();

  // ── Locate each TOC title as a heading, in order ─────────────────────────
  // Walk blocks in reading order; a block whose normalized text equals one of
  // the next few unmatched TOC titles marks that section's start. The
  // lookahead window tolerates titles we fail to find (they stay unmatched
  // rather than derailing the sequence).
  const headingPositions: (number | null)[] = new Array(sections.length).fill(null);
  const normalizedTitles = sections.map((section) => normalize(section.title));
  let cursor = 0;

  for (const page of pages) {
    if (page.pageNumber <= FRONT_MATTER_PAGES) continue;
    if (cursor >= sections.length) break;
    for (const block of page.blocks) {
      if (cursor >= sections.length) break;
      if (isFooter(block) || block.words.length === 0) continue;
      if (block.maxLineHeight < 12.5) continue; // headings are never small print
      if (block.text.length > 100) continue; // headings are short
      const normalizedBlock = normalize(block.text);
      if (normalizedBlock.length === 0) continue;
      const windowEnd = Math.min(cursor + HEADING_LOOKAHEAD, sections.length);
      for (let i = cursor; i < windowEnd; i++) {
        if (headingMatchesTitle(normalizedBlock, normalizedTitles[i])) {
          headingPositions[i] = positionKey(page.pageNumber, block.yMax);
          if (process.env.DEBUG_MATCH) {
            const skipped = i > cursor ? ` (skipped ${i - cursor})` : "";
            console.log(`  p${page.pageNumber} "${block.text.slice(0, 50)}" → [${i}] "${sections[i].title}"${skipped}`);
          }
          cursor = i + 1;
          break;
        }
      }
    }
  }

  const matchedCount = headingPositions.filter((p) => p !== null).length;
  console.log(`Matched ${matchedCount}/${sections.length} headings in the PDF.`);
  const unmatched = sections.filter((_, i) => headingPositions[i] === null);
  if (unmatched.length > 0) {
    console.log(`Unmatched: ${unmatched.map((s) => `"${s.title}" (${s.level})`).join(", ")}`);
  }

  // ── Slice into ranges: each section runs to the next matched heading ─────
  const ranges = sections.map((section, i) => {
    const start = headingPositions[i];
    if (start === null) return { section, start: null, end: null };
    let end = Number.MAX_SAFE_INTEGER;
    for (let j = i + 1; j < sections.length; j++) {
      if (headingPositions[j] !== null) {
        end = headingPositions[j]!;
        break;
      }
    }
    return { section, start, end };
  });

  // ── Assemble text + figures per section ──────────────────────────────────
  const output: Record<string, { title: string; text: string; figures: { label: string; caption: string; file: string }[] }> = {};

  for (const { section, start, end } of ranges) {
    if (start === null) {
      output[section.id] = { title: section.title, text: "", figures: [] };
      continue;
    }

    const paragraphs: string[] = [];
    const sectionFigures: { label: string; caption: string; file: string }[] = [];

    for (const page of pages) {
      const pageFigures = figureByPage.get(page.pageNumber) ?? [];
      for (const block of page.blocks) {
        const position = positionKey(page.pageNumber, block.yMax);
        if (position <= start || position > end!) continue;
        if (isFooter(block)) continue;

        const captionLabel = getFigureLabel(block);
        const enclosingFigure = pageFigures.find(
          (figure) => block.yMin >= figure.region.yTop - 2 && block.yMax <= figure.region.yBottom + 2,
        );

        if (captionLabel && enclosingFigure && enclosingFigure.label === captionLabel) {
          // Replace the caption with an image token the UI renders inline.
          paragraphs.push(`![${enclosingFigure.caption}](${enclosingFigure.file})`);
          sectionFigures.push({
            label: enclosingFigure.label,
            caption: enclosingFigure.caption,
            file: enclosingFigure.file,
          });
          continue;
        }
        if (enclosingFigure) continue; // text label inside a diagram
        if (!isBodyText(block) && block.maxLineHeight < 11 && block.words.length <= 4) {
          continue; // stray fragment (page artifacts)
        }
        paragraphs.push(block.text);
      }
    }

    output[section.id] = {
      title: section.title,
      text: paragraphs.join("\n\n"),
      figures: sectionFigures,
    };
  }

  const totalChars = Object.values(output).reduce((sum, s) => sum + s.text.length, 0);
  const totalFigures = Object.values(output).reduce((sum, s) => sum + s.figures.length, 0);
  const emptySections = Object.values(output).filter((s) => s.text.length === 0).length;

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 1));
  console.log(`\nWrote ${OUTPUT_PATH}`);
  console.log(`  ${Object.keys(output).length} sections, ${(totalChars / 1000).toFixed(0)}k chars of text`);
  console.log(`  ${totalFigures} figures placed, ${emptySections} sections with no text`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error extracting section content:", error);
  process.exit(1);
});
