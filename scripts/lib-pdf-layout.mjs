/**
 * Shared PDF layout helpers for the DDIA extraction scripts.
 * Parses `pdftotext -bbox-layout` output into pages of text blocks with
 * geometry, and classifies blocks (body text vs. diagram labels vs. footers).
 */

import { execFileSync } from "child_process";

export const PDF_FILENAME =
  "Martin-Kleppmann---Designing-Data-Intensive-Applications_-O’Reilly-Media-(2017).pdf";

// Page geometry (points). Body text spans x 72..432 on 504pt-wide pages.
// The book uses running footers (y≈610), so content starts as high as y≈50.
export const COLUMN_LEFT = 72;
export const COLUMN_RIGHT = 432;
export const HEADER_BOTTOM = 40;
export const FOOTER_TOP = 605;

// Body paragraphs, headings, and captions are set at ≥12.5pt line height;
// text inside the diagrams themselves is 7.8–10.2pt. Rotated (vertical)
// labels inside diagrams report huge line heights but are very narrow, so a
// boundary block must also be reasonably wide.
const BODY_MIN_LINE_HEIGHT = 12.5;
const BODY_MAX_LINE_HEIGHT = 20;
const BODY_WIDE_WIDTH = 100;
const BODY_MIN_WIDTH = 50;

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function loadPages(pdfPath = PDF_FILENAME) {
  const bboxXml = execFileSync(
    "pdftotext",
    ["-bbox-layout", pdfPath, "-"],
    { maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
  );
  return parsePages(bboxXml);
}

export function parsePages(xml) {
  const pages = [];
  const pageRegex = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  let pageMatch;
  let pageNumber = 0;
  while ((pageMatch = pageRegex.exec(xml)) !== null) {
    pageNumber++;
    const [, width, height, body] = pageMatch;
    const blocks = [];
    const blockRegex =
      /<block xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/block>/g;
    let blockMatch;
    while ((blockMatch = blockRegex.exec(body)) !== null) {
      const [, xMin, yMin, xMax, yMax, blockBody] = blockMatch;
      const words = [...blockBody.matchAll(/<word[^>]*>([\s\S]*?)<\/word>/g)].map(
        (w) => decodeEntities(w[1]),
      );
      const lineHeights = [...blockBody.matchAll(
        /<line xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">/g,
      )].map((m) => parseFloat(m[2]) - parseFloat(m[1]));
      blocks.push({
        xMin: parseFloat(xMin),
        yMin: parseFloat(yMin),
        xMax: parseFloat(xMax),
        yMax: parseFloat(yMax),
        words,
        maxLineHeight: Math.max(0, ...lineHeights),
        text: words.join(" "),
      });
    }
    blocks.sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
    pages.push({ pageNumber, width: parseFloat(width), height: parseFloat(height), blocks });
  }
  return pages;
}

export function isBodyText(block) {
  if (block.maxLineHeight < BODY_MIN_LINE_HEIGHT) return false;
  const width = block.xMax - block.xMin;
  if (width >= BODY_WIDE_WIDTH) return true; // paragraphs, captions, titles
  return block.maxLineHeight <= BODY_MAX_LINE_HEIGHT && width >= BODY_MIN_WIDTH; // short headings
}

export function isFooter(block) {
  return block.yMin >= FOOTER_TOP;
}

/** Caption blocks: first word "Figure", second word like "3-1." */
export function getFigureLabel(block) {
  if (block.words[0] !== "Figure") return null;
  const labelMatch = /^(\d+-\d+)\.$/.exec(block.words[1] ?? "");
  return labelMatch ? labelMatch[1] : null;
}
