/**
 * Phase 22.2 — Markdown → HTML renderer for BRD export.
 *
 * Converts a BRD Markdown document into a single self-contained HTML string
 * that Google Drive's import endpoint can convert into a proper Google Doc.
 *
 * Mermaid handling:
 *   - We extract all ```mermaid fenced blocks first
 *   - Render each one to PNG via @mermaid-js/mermaid-cli (Chromium-backed)
 *   - Base64-encode the PNG bytes and inline as `<img src="data:image/png;base64,...">`
 *   - This avoids any external URL dependency (no mermaid.ink) — Drive's
 *     importer reliably embeds inline base64 images.
 *   - If Mermaid rendering fails (no Chromium, etc.), the diagram source
 *     stays in the doc as a styled <pre> code block so nothing is lost.
 *
 * Other Markdown features:
 *   - Headings (#, ##, ###, ####) → <h1>..<h4> with inline CSS styles
 *   - Tables → real <table>/<thead>/<tbody>/<tr>/<th>/<td> with borders
 *   - Lists → <ul>/<ol>/<li>
 *   - Inline **bold** / *italic* / `code` / [text](url) — all preserved
 *   - Code blocks → <pre><code> monospace
 *   - Blockquotes → <blockquote> with left border
 */

import { marked } from "marked";
import { promises as fsPromises } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

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
  // Step 1: extract Mermaid blocks and render each to a base64 PNG (or fallback).
  const mermaidBlocks: Array<{ code: string; placeholder: string; renderedImg?: string; error?: string }> = [];
  let blockIdx = 0;

  const mdWithPlaceholders = markdown.replace(MERMAID_FENCE_RE, (_full, code) => {
    const placeholder = `\n\n<!--MERMAID_BLOCK_${blockIdx}-->\n\n`;
    mermaidBlocks.push({ code: String(code).trim(), placeholder });
    blockIdx++;
    return placeholder;
  });

  // Render each Mermaid block (best-effort, sequential to avoid spawning many
  // Chromium instances at once)
  for (let i = 0; i < mermaidBlocks.length; i++) {
    try {
      const png = await renderMermaidToPng(mermaidBlocks[i].code);
      const base64 = png.toString("base64");
      mermaidBlocks[i].renderedImg = `<img src="data:image/png;base64,${base64}" alt="Mermaid diagram" style="max-width: 100%; height: auto; display: block; margin: 16px 0;" />`;
    } catch (e: any) {
      mermaidBlocks[i].error = e?.message || String(e);
    }
  }

  // Step 2: render the rest of the Markdown to HTML.
  marked.setOptions({
    gfm: true,            // tables, fenced code, strikethrough, autolinks
    breaks: false,
    pedantic: false,
  });

  let html = await marked.parse(mdWithPlaceholders, { async: true });

  // Step 3: replace the Mermaid placeholders with rendered images (or fallback code).
  for (let i = 0; i < mermaidBlocks.length; i++) {
    const block = mermaidBlocks[i];
    // The placeholder ends up as <p><!--MERMAID_BLOCK_X--></p> after marked parses it,
    // or as a standalone comment depending on context. Replace both forms.
    const replacementHtml = block.renderedImg
      ? block.renderedImg
      : `<pre style="background:#f5f7fa;padding:12px;border:1px solid #e5e7eb;border-radius:6px;font-family:'Courier New',monospace;font-size:11pt;white-space:pre-wrap;">[Mermaid diagram — paste into mermaid.live to view]\n${escapeHtml(block.code)}</pre>`;
    const commentRe = new RegExp(`<p>\\s*<!--MERMAID_BLOCK_${i}-->\\s*</p>`, "g");
    const bareCommentRe = new RegExp(`<!--MERMAID_BLOCK_${i}-->`, "g");
    html = html.replace(commentRe, replacementHtml).replace(bareCommentRe, replacementHtml);
  }

  // Step 4: wrap in a full HTML document with styles. Inline styles are
  // necessary because Drive's importer is conservative — external CSS or
  // most style elements are stripped during conversion.
  const wrapped = wrapHtmlForDriveImport(html);

  return {
    html: wrapped,
    diagnostics: {
      totalLength: wrapped.length,
      mermaidBlocks: mermaidBlocks.length,
      mermaidRendered: mermaidBlocks.filter(b => !!b.renderedImg).length,
      mermaidFailed: mermaidBlocks
        .map((b, i) => b.error ? { index: i, error: b.error.slice(0, 200) } : null)
        .filter((x): x is { index: number; error: string } => !!x),
    },
  };
}

/**
 * Render a Mermaid graph to PNG bytes using @mermaid-js/mermaid-cli, which
 * launches a headless Chromium under the hood.
 *
 * We write the graph to a temp file, invoke `mmdc` programmatically, read the
 * output PNG, clean up. The whole thing is sequential per block to avoid
 * spawning many browsers at once.
 */
async function renderMermaidToPng(code: string): Promise<Buffer> {
  const id = randomBytes(8).toString("hex");
  const inputPath = join(tmpdir(), `mermaid-${id}.mmd`);
  const outputPath = join(tmpdir(), `mermaid-${id}.png`);

  try {
    await fsPromises.writeFile(inputPath, code, "utf-8");

    // Use the mermaid-cli's run function. We import it lazily so the cold-start
    // doesn't load Chromium when not exporting.
    const mod: any = await import("@mermaid-js/mermaid-cli");
    if (typeof mod.run !== "function") {
      throw new Error("mermaid-cli has no run() export");
    }

    await mod.run(inputPath, outputPath, {
      // Force a wider viewport so diagrams render at a reasonable size
      puppeteerConfig: {
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      },
      outputFormat: "png",
      backgroundColor: "white",
    } as any);

    const png = await fsPromises.readFile(outputPath);
    return png;
  } finally {
    // Best-effort cleanup
    fsPromises.unlink(inputPath).catch(() => {});
    fsPromises.unlink(outputPath).catch(() => {});
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  } as any)[c]);
}
