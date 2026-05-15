/**
 * Phase 22.2 — Markdown → HTML renderer for BRD export (lightweight version).
 *
 * Converts a BRD Markdown document into a single self-contained HTML string
 * that Google Drive's import endpoint can convert into a proper Google Doc.
 *
 * Mermaid handling (no Puppeteer):
 *   - Extract all ```mermaid fenced blocks
 *   - Render each one to SVG using the `mermaid` library running inside a
 *     JSDOM-provided fake DOM
 *   - Inline the SVG directly into the HTML
 *   - Drive's HTML importer handles inline SVG well — diagrams come through
 *     as embedded images in the resulting Google Doc
 *   - If Mermaid rendering fails, the diagram source stays in the doc as a
 *     styled <pre> code block so nothing is lost
 *
 * Why this approach (vs Puppeteer):
 *   - No 170MB Chromium download — Firebase build stays fast
 *   - No browser cold-start latency on every export
 *   - SVG renders crisper than PNG in Google Docs
 *   - Trade-off: very advanced Mermaid features that require a real browser
 *     (custom icons, certain layouts) may not work. For BRD use cases —
 *     sequenceDiagrams, flowcharts, ER diagrams — this is plenty.
 */

import { marked } from "marked";

const MERMAID_FENCE_RE = /```mermaid\s*\n([\s\S]*?)\n```/g;

export interface RenderResult {
  html: string;
  diagnostics: {
    totalLength: number;
    mermaidBlocks: number;
    mermaidRendered: number;
    mermaidFailed: Array<{ index: number; error: string }>;
  };
}

export async function renderBrdMarkdownToHtml(markdown: string): Promise<RenderResult> {
  // Step 1: extract Mermaid blocks and render each to SVG (or fallback).
  const mermaidBlocks: Array<{ code: string; placeholder: string; renderedSvg?: string; error?: string }> = [];
  let blockIdx = 0;

  const mdWithPlaceholders = markdown.replace(MERMAID_FENCE_RE, (_full, code) => {
    const placeholder = `\n\n<!--MERMAID_BLOCK_${blockIdx}-->\n\n`;
    // The AI sometimes emits Mermaid blocks with collapsed whitespace —
    // e.g. "sequenceDiagram    participant F as Field    participant A as Admin"
    // all on one line, which mermaid rejects. Normalize so each statement
    // sits on its own line.
    const normalized = normalizeMermaidSource(String(code));
    mermaidBlocks.push({ code: normalized, placeholder });
    blockIdx++;
    return placeholder;
  });

  // Render each Mermaid block sequentially (the mermaid lib isn't safe under
  // concurrent renders inside one JSDOM)
  for (let i = 0; i < mermaidBlocks.length; i++) {
    try {
      const svg = await renderMermaidToSvg(mermaidBlocks[i].code, i);
      mermaidBlocks[i].renderedSvg = svg;
    } catch (e: any) {
      mermaidBlocks[i].error = e?.message || String(e);
    }
  }

  // Step 2: render the rest of the Markdown to HTML.
  marked.setOptions({
    gfm: true,        // tables, fenced code, strikethrough, autolinks
    breaks: false,
    pedantic: false,
  });

  let html = await marked.parse(mdWithPlaceholders, { async: true });

  // Step 3: replace the Mermaid placeholders with rendered SVGs (or fallback code).
  for (let i = 0; i < mermaidBlocks.length; i++) {
    const block = mermaidBlocks[i];
    const replacementHtml = block.renderedSvg
      ? `<div style="margin: 16px 0; text-align: center;">${block.renderedSvg}</div>`
      : `<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:6px;padding:12px;margin:16px 0;font-size:10pt;">
           <p style="margin:0 0 8px;font-weight:bold;color:#9a3412;">⚠ Diagram couldn't be rendered automatically</p>
           ${block.error ? `<p style="margin:0 0 8px;color:#78350f;font-size:9pt;">Reason: ${escapeHtml(block.error.slice(0, 200))}</p>` : ""}
           <pre style="background:#fff;padding:8px;border:1px solid #fed7aa;border-radius:4px;font-family:'Courier New',monospace;font-size:9pt;white-space:pre-wrap;margin:0;">${escapeHtml(block.code)}</pre>
         </div>`;
    const commentRe = new RegExp(`<p>\\s*<!--MERMAID_BLOCK_${i}-->\\s*</p>`, "g");
    const bareCommentRe = new RegExp(`<!--MERMAID_BLOCK_${i}-->`, "g");
    html = html.replace(commentRe, replacementHtml).replace(bareCommentRe, replacementHtml);
  }

  // Step 4: wrap in a full HTML document with inline styles.
  const wrapped = wrapHtmlForDriveImport(html);

  return {
    html: wrapped,
    diagnostics: {
      totalLength: wrapped.length,
      mermaidBlocks: mermaidBlocks.length,
      mermaidRendered: mermaidBlocks.filter(b => !!b.renderedSvg).length,
      mermaidFailed: mermaidBlocks
        .map((b, i) => b.error ? { index: i, error: b.error.slice(0, 200) } : null)
        .filter((x): x is { index: number; error: string } => !!x),
    },
  };
}

/**
 * Render a single Mermaid block to SVG using the `mermaid` library inside a
 * JSDOM-provided fake DOM. Lazy-imports both libraries so the cold start
 * doesn't pay the cost when no export is happening.
 */
async function renderMermaidToSvg(code: string, blockIndex: number): Promise<string> {
  // Lazy imports
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head></head><body><div id="render-target"></div></body></html>`,
    { pretendToBeVisual: true, runScripts: "outside-only" }
  );

  // Mermaid checks for window/document/navigator — wire up JSDOM as the globals
  // for this render.
  const prevWindow = (globalThis as any).window;
  const prevDocument = (globalThis as any).document;
  const prevNavigator = (globalThis as any).navigator;

  (globalThis as any).window = dom.window as any;
  (globalThis as any).document = dom.window.document as any;
  (globalThis as any).navigator = dom.window.navigator as any;
  (globalThis as any).HTMLElement = dom.window.HTMLElement as any;
  (globalThis as any).SVGElement = (dom.window as any).SVGElement;
  (globalThis as any).Element = dom.window.Element as any;
  (globalThis as any).Node = dom.window.Node as any;

  try {
    const mermaidMod: any = await import("mermaid");
    const mermaid = mermaidMod.default || mermaidMod;

    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "loose",
      flowchart: { useMaxWidth: false, htmlLabels: true },
      sequence: { useMaxWidth: false, mirrorActors: false },
    });

    const id = `mermaid-export-${blockIndex}-${Date.now()}`;
    const result = await mermaid.render(id, code);
    // mermaid.render returns { svg, ... } on v10+, or just the svg string on older versions
    const svg = typeof result === "string" ? result : result?.svg;
    if (!svg) throw new Error("Mermaid render returned no SVG");

    // Strip the explicit width/height so Drive sizes the image responsively.
    // Also strip any <foreignObject> elements — Drive's HTML importer strips
    // them anyway and they cause rendering noise in the doc.
    let cleaned = String(svg)
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, "")
      .replace(/\swidth="[^"]+"/i, ' width="600"')
      .replace(/\sheight="[^"]+"/i, "");

    // Ensure xmlns is present (some Mermaid versions omit it on the root)
    if (!/<svg[^>]*xmlns=/.test(cleaned)) {
      cleaned = cleaned.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    return cleaned;
  } finally {
    // Restore prior globals so we don't leak JSDOM into other code paths
    (globalThis as any).window = prevWindow;
    (globalThis as any).document = prevDocument;
    (globalThis as any).navigator = prevNavigator;
  }
}

function wrapHtmlForDriveImport(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #202124; }
h1 { font-size: 22pt; font-weight: 700; margin: 24pt 0 12pt; color: #1a1a1a; }
h2 { font-size: 16pt; font-weight: 700; margin: 20pt 0 8pt; color: #1a1a1a; }
h3 { font-size: 13pt; font-weight: 700; margin: 16pt 0 6pt; color: #1a1a1a; }
h4 { font-size: 11pt; font-weight: 700; margin: 12pt 0 6pt; color: #333; }
p { margin: 8pt 0; }
ul, ol { margin: 8pt 0; padding-left: 24pt; }
li { margin: 4pt 0; }
table { border-collapse: collapse; width: 100%; margin: 12pt 0; }
th, td { border: 1px solid #ccc; padding: 6pt 8pt; text-align: left; vertical-align: top; font-size: 10.5pt; }
th { background-color: #f1f3f4; font-weight: 700; }
code { font-family: 'Courier New', monospace; background-color: #f1f3f4; padding: 1pt 4pt; border-radius: 3px; font-size: 10pt; }
pre { font-family: 'Courier New', monospace; background-color: #f5f7fa; padding: 8pt 12pt; border: 1px solid #e5e7eb; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; font-size: 10pt; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #e5e7eb; margin: 8pt 0; padding: 0 0 0 12pt; color: #555; font-style: italic; }
a { color: #1a73e8; text-decoration: underline; }
strong { font-weight: 700; }
em { font-style: italic; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 16pt 0; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * Normalize Mermaid source by inserting line breaks before statement keywords
 * when the AI emitted them collapsed on one line. Mermaid's parser requires
 * statements to be newline-separated, but Markdown rendering and AI output
 * sometimes lose those breaks.
 *
 * Approach: if the code is suspiciously short on newlines but long in length,
 * inject `\n` before each known statement keyword. Conservative — if it's
 * already well-formed (lots of newlines), we leave it alone.
 */
function normalizeMermaidSource(raw: string): string {
  const code = raw.trim();
  if (!code) return code;

  // If the block already has plenty of newlines relative to its length, trust it.
  const lineCount = code.split(/\r?\n/).length;
  if (lineCount >= 3 && code.length / lineCount < 80) {
    return code;
  }

  // Statement-starting keywords that should always begin a new line.
  // Order matters: longer first to avoid partial matches.
  const STATEMENT_KEYWORDS = [
    "sequenceDiagram", "flowchart", "graph", "classDiagram", "stateDiagram",
    "stateDiagram-v2", "erDiagram", "journey", "gantt", "pie", "mindmap",
    "timeline", "participant", "actor", "Note", "loop", "alt", "opt", "par",
    "rect", "activate", "deactivate", "autonumber", "end", "subgraph",
    "title", "section", "class",
  ];

  let result = code;
  for (const kw of STATEMENT_KEYWORDS) {
    // Insert newline before the keyword unless it's already at line start.
    // Match the keyword as a whole word (followed by whitespace or end).
    const re = new RegExp(`(?<!^|\\n)\\s+(${kw})\\b`, "g");
    result = result.replace(re, `\n$1`);
  }

  // Collapse runs of blank lines to single newlines.
  result = result.replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  } as any)[c]);
}
