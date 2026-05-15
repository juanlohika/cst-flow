/**
 * Phase 22.3 — Markdown → HTML renderer for BRD export.
 *
 * Mermaid handling: emit each diagram as an <img> pointing at mermaid.ink,
 * a free public service that renders Mermaid source into PNG/SVG via URL.
 *
 *   ```mermaid\nsequenceDiagram\nA->>B: hi\n```
 *     ↓ becomes
 *   <img src="https://mermaid.ink/img/<base64-pako-encoded source>" />
 *
 * Why this approach (after trying JSDOM and Chromium):
 *   - JSDOM lacks CSSStyleSheet which Mermaid 11+ requires → fails server-side
 *   - puppeteer-core + @sparticuz/chromium fails on Firebase App Hosting
 *     (missing system libs like libnss3 that we can't install)
 *   - mermaid.ink takes the source as a URL, no server-side rendering needed
 *   - Word and PDF readers load the image when the file is opened (same
 *     mechanism as any embedded image in a Word doc)
 *   - Mermaid.live link is provided alongside so editors can tweak the diagram
 *
 * Trade-off: the image only loads if the reader has internet access. For
 * BRDs shared with clients via Drive, that's always true.
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
  // Step 1: extract Mermaid blocks and prepare their replacement HTML.
  const mermaidBlocks: Array<{ code: string; placeholder: string; imgUrl?: string; liveUrl?: string; error?: string }> = [];
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

  // Step 2: build mermaid.ink + mermaid.live URLs for each block. These are
  // synchronous (just base64 encoding) — no network call from our server.
  for (const block of mermaidBlocks) {
    try {
      block.imgUrl = buildMermaidInkUrl(block.code);
      block.liveUrl = buildMermaidLiveUrl(block.code);
    } catch (e: any) {
      block.error = e?.message || String(e);
    }
  }

  // Step 3: render the rest of the Markdown to HTML.
  marked.setOptions({
    gfm: true,        // tables, fenced code, strikethrough, autolinks
    breaks: false,
    pedantic: false,
  });

  let html = await marked.parse(mdWithPlaceholders, { async: true });

  // Step 4: replace placeholders with <img> tags + edit link.
  for (let i = 0; i < mermaidBlocks.length; i++) {
    const block = mermaidBlocks[i];
    const replacementHtml = block.imgUrl && block.liveUrl
      ? `<div style="margin:16px 0;text-align:center;">
           <img src="${block.imgUrl}" alt="Diagram ${i + 1}" style="max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:6px;padding:8px;background:#fff;" />
           <p style="margin:6px 0 0;font-size:9pt;color:#666;"><a href="${block.liveUrl}" style="color:#1a73e8;text-decoration:none;">View or edit this diagram on mermaid.live →</a></p>
         </div>`
      : `<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:6px;padding:12px;margin:16px 0;font-size:10pt;">
           <p style="margin:0 0 8px;font-weight:bold;color:#9a3412;">⚠ Diagram couldn't be embedded</p>
           ${block.error ? `<p style="margin:0 0 8px;color:#78350f;font-size:9pt;">Reason: ${escapeHtml(block.error.slice(0, 200))}</p>` : ""}
           <pre style="background:#fff;padding:8px;border:1px solid #fed7aa;border-radius:4px;font-family:'Courier New',monospace;font-size:9pt;white-space:pre-wrap;margin:0;">${escapeHtml(block.code)}</pre>
         </div>`;
    const commentRe = new RegExp(`<p>\\s*<!--MERMAID_BLOCK_${i}-->\\s*</p>`, "g");
    const bareCommentRe = new RegExp(`<!--MERMAID_BLOCK_${i}-->`, "g");
    html = html.replace(commentRe, replacementHtml).replace(bareCommentRe, replacementHtml);
  }

  // Step 5: wrap in a full HTML document with inline styles.
  const wrapped = wrapHtmlForDriveImport(html);

  return {
    html: wrapped,
    diagnostics: {
      totalLength: wrapped.length,
      mermaidBlocks: mermaidBlocks.length,
      mermaidRendered: mermaidBlocks.filter(b => !!b.imgUrl).length,
      mermaidFailed: mermaidBlocks
        .map((b, i) => b.error ? { index: i, error: b.error.slice(0, 200) } : null)
        .filter((x): x is { index: number; error: string } => !!x),
    },
  };
}

/**
 * Build a mermaid.ink image URL for the diagram. mermaid.ink expects the
 * source to be base64url-encoded (RFC 4648 §5: '+/' → '-_', no padding) and
 * appended to its /img/ path. We use 'pako' compression for shorter URLs on
 * large diagrams — except pako would be another dep, and most BRD diagrams
 * are small. Plain base64url works for diagrams under ~2KB which is the
 * vast majority.
 */
function buildMermaidInkUrl(code: string): string {
  const b64 = base64UrlEncode(code);
  return `https://mermaid.ink/img/${b64}?type=png`;
}

/**
 * Build a mermaid.live edit URL with the diagram source pre-loaded. Uses the
 * same base64url-encoded JSON config format mermaid.live's #base64: handler
 * accepts.
 */
function buildMermaidLiveUrl(code: string): string {
  const state = {
    code,
    mermaid: { theme: "default" },
    autoSync: true,
    updateDiagram: true,
  };
  const json = JSON.stringify(state);
  const b64 = base64UrlEncode(json);
  return `https://mermaid.live/edit#base64:${b64}`;
}

/** RFC 4648 base64url: '+/' → '-_', strip padding. Works in Node + edge. */
function base64UrlEncode(input: string): string {
  const b64 = Buffer.from(input, "utf-8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
