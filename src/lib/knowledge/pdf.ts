/**
 * Hybrid PDF extraction (Phase 20.1)
 *
 * Step 1 — pdf2json extracts every text run with x/y coordinates AND every
 *          embedded image (Fills array on each page).
 * Step 2 — Gemini Vision describes each embedded image in plain English so
 *          the resulting Markdown captures what app screenshots / diagrams
 *          actually show, not just the prose around them.
 * Step 3 — Stitch text + image descriptions in document order so the output
 *          reads top-to-bottom like the original PDF.
 *
 * Result: a single Markdown document where every paragraph is preserved and
 * every image is inlined as a "[Image: …]" block with a Gemini-generated
 * description. ARIMA / Eliana can reason about both the text and the screens.
 *
 * Fallback: if Gemini is unavailable (no API key, rate limit, network error),
 * we still return text-only Markdown — never crash the upload because of an
 * image-description hiccup.
 */

type TextRun = { y: number; text: string; kind: "text" };
type ImageRef = { y: number; pageWidth: number; pageHeight: number; w: number; h: number; src?: string; kind: "image" };
type PageItem = TextRun | ImageRef;

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdfData = await parsePdf(buffer);
  // Pull text + image positions from each page so we can interleave
  const pages: PageItem[][] = [];
  const imagesToDescribe: { pageIdx: number; itemIdx: number; bytes: Buffer; mime: string }[] = [];

  for (let p = 0; p < (pdfData?.Pages || []).length; p++) {
    const page = pdfData.Pages[p];
    const items: PageItem[] = [];
    for (const t of (page?.Texts || [])) {
      const runs = (t?.R || []) as Array<{ T?: string }>;
      const decoded = runs.map(r => safeDecodeUri(r?.T || "")).join("").trim();
      if (decoded) items.push({ y: typeof t.y === "number" ? t.y : 0, text: decoded, kind: "text" });
    }
    // pdf2json exposes embedded images on the page's "Fills" array. We only
    // care about ones that look like real bitmaps (have a src field).
    for (const f of (page?.Fills || [])) {
      const src = (f?.src || f?.image) as string | undefined;
      if (!src) continue;
      const item: ImageRef = {
        y: typeof f.y === "number" ? f.y : 0,
        pageWidth: page?.Width || 0,
        pageHeight: page?.Height || 0,
        w: f.w || 0,
        h: f.h || 0,
        src,
        kind: "image",
      };
      items.push(item);
      // Try to decode the inline base64 if present
      const bytes = tryDecodeImageBytes(src);
      if (bytes) {
        imagesToDescribe.push({
          pageIdx: p,
          itemIdx: items.length - 1,
          bytes: bytes.buffer,
          mime: bytes.mime,
        });
      }
    }
    items.sort((a, b) => a.y - b.y);
    pages.push(items);
  }

  // Describe images via Gemini Vision (best-effort, sequential to avoid burst)
  const descriptions = new Map<string, string>(); // key: `${pageIdx}:${itemIdx}` → description
  for (const img of imagesToDescribe) {
    const key = `${img.pageIdx}:${img.itemIdx}`;
    const desc = await describeImageWithGemini(img.bytes, img.mime).catch(() => null);
    if (desc) descriptions.set(key, desc);
  }

  // Stitch back to Markdown
  const out: string[] = [];
  for (let p = 0; p < pages.length; p++) {
    const items = pages[p];
    let buffer: string[] = [];
    let lastY = -Infinity;
    const flush = () => { if (buffer.length) { out.push(buffer.join(" ")); buffer = []; } };

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "text") {
        const gap = it.y - lastY;
        if (gap > 0.5 && buffer.length > 0) flush();
        buffer.push(it.text);
        lastY = it.y;
      } else {
        flush();
        const desc = descriptions.get(`${p}:${i}`);
        if (desc) {
          out.push(`> **[Image]** ${desc}`);
        } else {
          out.push(`> **[Image]** _Embedded image (description unavailable — Gemini Vision could not process it)._`);
        }
        out.push("");
      }
    }
    flush();
    if (p < pages.length - 1) out.push("");
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function parsePdf(buffer: Buffer): Promise<any> {
  const mod: any = await import("pdf2json").catch(() => null);
  if (!mod) throw new Error("pdf2json not available — install it first.");
  const PDFParser = mod.default || mod;
  return new Promise<any>((resolve, reject) => {
    const parser = new PDFParser(null, true);
    parser.on("pdfParser_dataError", (err: any) => {
      reject(new Error(err?.parserError?.message || err?.message || "PDF parse failed"));
    });
    parser.on("pdfParser_dataReady", (pdfData: any) => resolve(pdfData));
    parser.parseBuffer(buffer);
  });
}

function tryDecodeImageBytes(src: string): { buffer: Buffer; mime: string } | null {
  // pdf2json sometimes encodes images as data URIs; sometimes as raw bytes.
  try {
    if (src.startsWith("data:")) {
      const m = src.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) return null;
      const mime = m[1] || "image/png";
      const buf = Buffer.from(m[2], "base64");
      if (buf.length < 256) return null; // too small to be a real screenshot
      return { buffer: buf, mime };
    }
    return null;
  } catch {
    return null;
  }
}

async function describeImageWithGemini(bytes: Buffer, mime: string): Promise<string | null> {
  try {
    const { getGeminiModel } = await import("@/lib/ai");
    const model = await getGeminiModel().catch(() => null);
    if (!model) return null;
    const base64 = bytes.toString("base64");
    const prompt = `This image was extracted from a Tarkie product playbook (Tarkie is a Field Force Automation platform with three surfaces: Field App, Control Tower Dashboard, Manager App).

Describe what this image shows in 1-3 short sentences. Be specific:
- If it's a screenshot of the Tarkie app, identify which screen and what visible UI elements / text / buttons appear.
- If it's a diagram, explain what the diagram depicts.
- If it's a logo or watermark, just say "[Logo/branding image — Tarkie]" and stop.
- If you can't tell what it is, say "[Unidentified image]" and stop.

Keep the description factual. Do not invent details. Do not include preamble like "This image shows..." — just describe.`;

    const result: any = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: mime, data: base64 } },
          ],
        },
      ],
    });
    const text = (result?.response?.text?.() || "").trim();
    return text || null;
  } catch (e: any) {
    console.warn("[knowledge/pdf] Gemini Vision failed for one image:", e?.message);
    return null;
  }
}

function safeDecodeUri(s: string): string {
  try { return decodeURIComponent(s); }
  catch { return s.replace(/%[0-9A-F]{2}/g, ""); }
}
