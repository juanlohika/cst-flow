/**
 * PDF text extraction via pdf2json.
 *
 * pdf2json is async/event-based. We wrap it in a promise that resolves with
 * the extracted text, formatted as readable Markdown (one paragraph per text
 * run, blank lines between pages).
 *
 * Note: pdf2json works on text-bearing PDFs (born-digital documents created
 * from Word/Markdown/etc.). If a playbook is scanned from paper (just images
 * of text), the extracted output will be empty — that case needs OCR which is
 * a Phase 21 enhancement.
 */

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const mod: any = await import("pdf2json").catch(() => null);
  if (!mod) throw new Error("pdf2json not available — install it first.");
  const PDFParser = mod.default || mod;

  return new Promise<string>((resolve, reject) => {
    const parser = new PDFParser(null, true);
    parser.on("pdfParser_dataError", (err: any) => {
      reject(new Error(err?.parserError?.message || err?.message || "PDF parse failed"));
    });
    parser.on("pdfParser_dataReady", (pdfData: any) => {
      try {
        const md = pdfDataToMarkdown(pdfData);
        resolve(md);
      } catch (e: any) {
        reject(new Error(e?.message || "PDF formatting failed"));
      }
    });
    parser.parseBuffer(buffer);
  });
}

function pdfDataToMarkdown(pdfData: any): string {
  const pages = pdfData?.Pages || [];
  const out: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const texts = page?.Texts || [];
    const lines: { y: number; text: string }[] = [];
    for (const t of texts) {
      const runs = (t?.R || []) as Array<{ T?: string }>;
      const decoded = runs
        .map(r => safeDecodeUri(r?.T || ""))
        .join("")
        .trim();
      if (!decoded) continue;
      lines.push({ y: typeof t.y === "number" ? t.y : 0, text: decoded });
    }
    // Sort by vertical position so paragraphs read top-to-bottom
    lines.sort((a, b) => a.y - b.y);

    // Merge consecutive lines with similar Y into single paragraphs
    let lastY = -Infinity;
    let buffer: string[] = [];
    const flush = () => { if (buffer.length) { out.push(buffer.join(" ")); buffer = []; } };

    for (const line of lines) {
      const gap = line.y - lastY;
      if (gap > 0.5 && buffer.length > 0) {
        flush();
      }
      buffer.push(line.text);
      lastY = line.y;
    }
    flush();

    if (i < pages.length - 1) out.push(""); // blank line between pages
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function safeDecodeUri(s: string): string {
  try { return decodeURIComponent(s); }
  catch { return s.replace(/%[0-9A-F]{2}/g, ""); }
}
