/**
 * Phase F.1 — Minimal template inspector. Reads a .docx buffer and returns
 * the raw extracted HTML + a coarse outline (headings, table count, etc.) so
 * an admin can verify the template parses cleanly before we build the full
 * spec extractor in F.2.
 *
 * Intentionally low-resolution: this is "did mammoth even parse it?" not
 * "here's the proposal structure". F.2 will replace this with a real
 * extractor that emits placeholders + repeating-section descriptors.
 */
import mammoth from "mammoth";

export interface TemplatePreview {
  html: string;
  textOnly: string;
  outline: {
    headings: Array<{ level: number; text: string }>;
    paragraphCount: number;
    tableCount: number;
    bulletListCount: number;
    placeholderTags: string[];   // anything matching {{...}} or {#...} we already see
    images: number;
  };
  warnings: string[];
}

const PLACEHOLDER_RE = /\{\{?\s*[a-zA-Z0-9_.\-#\/]+\s*\}?\}/g;

export async function inspectTemplate(buffer: Buffer): Promise<TemplatePreview> {
  const warnings: string[] = [];
  let html = "";
  let textOnly = "";
  try {
    const htmlResult = await mammoth.convertToHtml({ buffer });
    html = htmlResult.value || "";
    for (const m of htmlResult.messages || []) warnings.push(`${m.type}: ${m.message}`);
  } catch (e: any) {
    warnings.push(`html conversion failed: ${e?.message || e}`);
  }
  try {
    const textResult = await mammoth.extractRawText({ buffer });
    textOnly = textResult.value || "";
  } catch (e: any) {
    warnings.push(`text extraction failed: ${e?.message || e}`);
  }

  const outline = buildOutline(html, textOnly);
  return { html, textOnly, outline, warnings };
}

function buildOutline(html: string, text: string): TemplatePreview["outline"] {
  // Headings (h1–h6) — mammoth emits them when the .docx uses Heading styles.
  const headings: Array<{ level: number; text: string }> = [];
  const hRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = hRe.exec(html)) !== null) {
    headings.push({ level: Number(m[1]), text: stripTags(m[2]).trim() });
  }
  const paragraphCount = (html.match(/<p[\s>]/gi) || []).length;
  const tableCount = (html.match(/<table[\s>]/gi) || []).length;
  const bulletListCount = (html.match(/<ul[\s>]/gi) || []).length;
  const images = (html.match(/<img[\s>]/gi) || []).length;
  const placeholderTags = Array.from(new Set((text.match(PLACEHOLDER_RE) || []).map(t => t.trim())));
  return { headings, paragraphCount, tableCount, bulletListCount, placeholderTags, images };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}
