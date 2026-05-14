"use client";

import { useEffect, useState, useMemo } from "react";
import { marked } from "marked";
import { Loader2 } from "lucide-react";

interface BrdMarkdownViewerProps {
  markdown: string;
}

/**
 * Renders a BRD Markdown blob with proper formatting:
 *  - Headings, paragraphs, lists, bold/italic, links, code blocks via `marked`
 *  - Tables as real HTML tables with bordered cells
 *  - Mermaid fenced blocks rendered client-side as SVG via the mermaid lib
 *
 * Used inside the /eliana detail modal so admins can preview the BRD exactly
 * as it will look in the exported Google Doc — without leaving CST OS.
 */
export default function BrdMarkdownViewer({ markdown }: BrdMarkdownViewerProps) {
  const [renderedHtml, setRenderedHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Marked configuration — match what the export uses
  useEffect(() => {
    marked.setOptions({ gfm: true, breaks: false, pedantic: false });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // 1. Extract Mermaid blocks and replace with placeholders
        const MERMAID_RE = /```mermaid\s*\n([\s\S]*?)\n```/g;
        const mermaidBlocks: Array<{ code: string }> = [];
        const mdWithPlaceholders = markdown.replace(MERMAID_RE, (_full, code) => {
          const idx = mermaidBlocks.length;
          mermaidBlocks.push({ code: String(code).trim() });
          return `\n\n<!--MERMAID_${idx}-->\n\n`;
        });

        // 2. Render the Markdown to HTML
        let html = await marked.parse(mdWithPlaceholders, { async: true });

        // 3. Render each Mermaid block to SVG (lazy-load mermaid only once)
        if (mermaidBlocks.length > 0) {
          try {
            const mermaidMod: any = await import("mermaid");
            const mermaid = mermaidMod.default || mermaidMod;
            mermaid.initialize({
              startOnLoad: false,
              theme: "default",
              securityLevel: "loose",
              fontFamily: "inherit",
            });
            for (let i = 0; i < mermaidBlocks.length; i++) {
              const id = `brd-viewer-mermaid-${i}-${Date.now()}`;
              try {
                const result = await mermaid.render(id, mermaidBlocks[i].code);
                const svg = typeof result === "string" ? result : result?.svg;
                if (svg) {
                  const placeholderRe = new RegExp(`<p>\\s*<!--MERMAID_${i}-->\\s*</p>`, "g");
                  const bareRe = new RegExp(`<!--MERMAID_${i}-->`, "g");
                  const wrapped = `<div class="brd-mermaid">${svg}</div>`;
                  html = html.replace(placeholderRe, wrapped).replace(bareRe, wrapped);
                }
              } catch (err) {
                // Fallback to plain code if this diagram fails
                const code = escapeHtml(mermaidBlocks[i].code);
                const placeholderRe = new RegExp(`<p>\\s*<!--MERMAID_${i}-->\\s*</p>`, "g");
                const bareRe = new RegExp(`<!--MERMAID_${i}-->`, "g");
                const fallback = `<pre class="brd-mermaid-fallback">[Mermaid diagram — couldn't render]\n${code}</pre>`;
                html = html.replace(placeholderRe, fallback).replace(bareRe, fallback);
              }
            }
          } catch {
            // Mermaid module failed entirely — leave placeholders as-is
          }
        }

        if (!cancelled) {
          setRenderedHtml(html);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setRenderedHtml("<p>Failed to render BRD preview. The raw Markdown is below.</p><pre>" + escapeHtml(markdown) + "</pre>");
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [markdown]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        <span className="text-[11px] text-slate-500 ml-2">Rendering preview…</span>
      </div>
    );
  }

  return (
    <>
      <style jsx>{`
        .brd-content :global(h1) { font-size: 18pt; font-weight: 700; margin: 16pt 0 10pt; color: #1a1a1a; }
        .brd-content :global(h2) { font-size: 14pt; font-weight: 700; margin: 14pt 0 8pt; color: #1a1a1a; }
        .brd-content :global(h3) { font-size: 12pt; font-weight: 700; margin: 12pt 0 6pt; color: #1a1a1a; }
        .brd-content :global(h4) { font-size: 11pt; font-weight: 700; margin: 10pt 0 6pt; color: #333; }
        .brd-content :global(p) { margin: 6pt 0; line-height: 1.55; font-size: 11.5pt; color: #202124; }
        .brd-content :global(ul), .brd-content :global(ol) { margin: 6pt 0; padding-left: 20pt; }
        .brd-content :global(li) { margin: 3pt 0; font-size: 11.5pt; color: #202124; }
        .brd-content :global(table) { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 10.5pt; }
        .brd-content :global(th), .brd-content :global(td) { border: 1px solid #d0d7de; padding: 5pt 7pt; text-align: left; vertical-align: top; }
        .brd-content :global(th) { background-color: #f1f3f4; font-weight: 700; }
        .brd-content :global(code) { font-family: 'Courier New', monospace; background-color: #f1f3f4; padding: 1pt 4pt; border-radius: 3px; font-size: 10pt; }
        .brd-content :global(pre) { font-family: 'Courier New', monospace; background-color: #f5f7fa; padding: 8pt 12pt; border: 1px solid #e5e7eb; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; font-size: 10pt; margin: 8pt 0; }
        .brd-content :global(pre code) { background: none; padding: 0; }
        .brd-content :global(blockquote) { border-left: 3px solid #e5e7eb; margin: 8pt 0; padding: 0 0 0 12pt; color: #555; font-style: italic; }
        .brd-content :global(a) { color: #1a73e8; text-decoration: underline; }
        .brd-content :global(.brd-mermaid) { margin: 12pt 0; text-align: center; background-color: #fafbfc; padding: 12pt; border-radius: 6px; border: 1px solid #e5e7eb; overflow-x: auto; }
        .brd-content :global(.brd-mermaid svg) { max-width: 100%; height: auto; }
        .brd-content :global(.brd-mermaid-fallback) { background-color: #fef3c7; border-color: #fcd34d; }
      `}</style>
      <div className="brd-content" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
    </>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  } as any)[c]);
}
