/**
 * Extract figure diagrams from the DDIA PDF as cropped PNGs.
 *
 * The book's figures are vector graphics, so they can't be pulled out with
 * pdfimages. Instead we locate each "Figure X-Y." caption block via
 * `pdftotext -bbox-layout`, infer the figure region as the vertical span
 * between the nearest body-text paragraph above and the caption, and render
 * that region with `pdftoppm`.
 *
 * Outputs:
 *   public/figures/fig-<X>-<Y>.png
 *   scripts/figures-manifest.json ({ label, caption, page, file, region })
 *
 * Requires poppler (pdftotext, pdftoppm) on PATH.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  PDF_FILENAME,
  COLUMN_LEFT,
  COLUMN_RIGHT,
  HEADER_BOTTOM,
  loadPages,
  isBodyText,
  getFigureLabel,
} from "./lib-pdf-layout.mjs";

const OUTPUT_DIR = path.resolve("public/figures");
const MANIFEST_PATH = path.resolve("scripts/figures-manifest.json");
const RENDER_DPI = 150;
const PT_TO_PX = RENDER_DPI / 72;
const MIN_FIGURE_HEIGHT = 40; // discard "figures" shorter than this (false captions)
const CROP_PADDING = 6;

function findCaptions(page) {
  const captions = [];
  for (const block of page.blocks) {
    const label = getFigureLabel(block);
    if (label) captions.push({ block, label });
  }
  // Top-to-bottom so each figure's region can stop at the previous caption.
  return captions.sort((a, b) => a.block.yMin - b.block.yMin);
}

function main() {
  console.log("Generating bbox layout (pdftotext)...");
  const pages = loadPages();
  console.log(`Parsed ${pages.length} pages.`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const manifest = [];
  const seenLabels = new Set();
  let skipped = 0;

  for (const page of pages) {
    const captions = findCaptions(page);
    let previousCaptionBottom = null;

    for (const { block: captionBlock, label } of captions) {
      // The figure sits between the caption and whatever real paragraph
      // (or earlier figure caption, or top margin) is above it. Narrow
      // blocks in between are text labels inside the diagram — skip those.
      let regionTop = HEADER_BOTTOM;
      for (const other of page.blocks) {
        if (other === captionBlock) continue;
        if (other.yMax > captionBlock.yMin) continue; // not above the caption
        if (!isBodyText(other)) continue;
        if (other.yMax > regionTop) regionTop = other.yMax;
      }
      if (previousCaptionBottom !== null && previousCaptionBottom > regionTop) {
        regionTop = previousCaptionBottom;
      }
      previousCaptionBottom = captionBlock.yMax;

      const regionBottom = captionBlock.yMin;
      const regionHeight = regionBottom - regionTop;
      if (regionHeight < MIN_FIGURE_HEIGHT) {
        skipped++;
        continue; // likely an in-text reference, not a real caption
      }
      if (seenLabels.has(label)) {
        skipped++;
        continue;
      }
      seenLabels.add(label);

      const x = Math.max(0, Math.round((COLUMN_LEFT - CROP_PADDING) * PT_TO_PX));
      const y = Math.max(0, Math.round((regionTop + 2) * PT_TO_PX));
      const w = Math.round((COLUMN_RIGHT - COLUMN_LEFT + CROP_PADDING * 2) * PT_TO_PX);
      const h = Math.round((regionHeight - 4) * PT_TO_PX);

      const fileName = `fig-${label}.png`;
      const outputPrefix = path.join(OUTPUT_DIR, `fig-${label}`);
      execFileSync("pdftoppm", [
        "-png",
        "-r", String(RENDER_DPI),
        "-f", String(page.pageNumber),
        "-l", String(page.pageNumber),
        "-x", String(x),
        "-y", String(y),
        "-W", String(w),
        "-H", String(h),
        "-singlefile",
        PDF_FILENAME,
        outputPrefix,
      ]);

      manifest.push({
        label,
        caption: captionBlock.text,
        page: page.pageNumber,
        file: `/figures/${fileName}`,
        // Vertical span of figure + caption in PDF points, used by
        // extract-section-content.ts to exclude diagram-internal text from
        // the reading text and to place the figure within a section.
        region: { yTop: regionTop, yBottom: captionBlock.yMax },
      });
      console.log(`  fig-${label} (p.${page.pageNumber}, ${Math.round(regionHeight)}pt tall) — ${captionBlock.text.slice(0, 70)}`);
    }
  }

  manifest.sort((a, b) => {
    const [ac, an] = a.label.split("-").map(Number);
    const [bc, bn] = b.label.split("-").map(Number);
    return ac - bc || an - bn;
  });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nExtracted ${manifest.length} figures (${skipped} candidates skipped).`);
  console.log(`Manifest written to ${MANIFEST_PATH}`);
}

main();
