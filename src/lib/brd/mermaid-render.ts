/**
 * Mermaid → PNG, rendered in the browser.
 *
 * A BRD's process flows arrive from the model as fenced ```mermaid blocks.
 * Raw mermaid source in a Word file is unreadable, so it is rasterised to a
 * PNG data URI and embedded as an <img>, which html-to-docx turns into a real
 * picture in the .docx and PDF.
 *
 * Why client-side: Firebase App Hosting has no browser binary, so server-side
 * Puppeteer is not an option. `mermaid` is already a dependency and needs a DOM,
 * so rendering happens in the page before the markdown is sent to the exporter.
 */

export interface RenderedDiagram {
  /** The mermaid source, unchanged — kept so the BRD stays editable. */
  code: string;
  /** PNG data URI, or null when the diagram could not be rendered. */
  png: string | null;
  error?: string;
}

const FENCE = /```mermaid\s*\n([\s\S]*?)```/g;

/** True when the markdown contains at least one mermaid block. */
export function hasMermaid(markdown: string): boolean {
  return /```mermaid\s*\n/.test(markdown);
}

/** Every mermaid block in document order. */
export function extractMermaid(markdown: string): string[] {
  const out: string[] = [];
  const re = new RegExp(FENCE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) out.push(m[1].trim());
  return out;
}

/**
 * Repair the mermaid mistakes models make most often.
 *
 * Observed from real BRD output: unescaped parentheses inside node labels —
 * `E[System validates (static rules)]` — which mermaid rejects with a parse
 * error. Quoting the label is the documented fix.
 */
export function sanitizeMermaid(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      // Only touch bracketed node labels, and only when they contain a
      // character mermaid treats as syntax.
      return line.replace(
        /(\[|\(\()([^\]"]*?[()][^\]"]*?)(\]|\)\))/g,
        (whole, open, label, close) => {
          if (label.startsWith('"')) return whole;      // already quoted
          return `${open}"${label.replace(/"/g, "'")}"${close}`;
        },
      );
    })
    .join("\n");
}

let mermaidReady: Promise<any> | null = null;

async function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((mod) => {
      const mermaid = (mod as any).default ?? mod;
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "strict",
        fontFamily: "Arial, Helvetica, sans-serif",
        themeVariables: {
          primaryColor: "#eef2fc",
          primaryBorderColor: "#1b4fd6",
          primaryTextColor: "#1a2233",
          lineColor: "#64748b",
          fontSize: "14px",
        },
      });
      return mermaid;
    });
  }
  return mermaidReady;
}

/** Rasterise one SVG string to a PNG data URI at 2x for print sharpness. */
function svgToPng(svg: string, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    // Read the intended size off the SVG so the bitmap keeps its aspect ratio.
    const vb = /viewBox="([\d.\-\s]+)"/.exec(svg)?.[1]?.trim().split(/\s+/);
    const w = vb ? Math.ceil(parseFloat(vb[2])) : 800;
    const h = vb ? Math.ceil(parseFloat(vb[3])) : 600;

    // Mermaid emits width="100%" plus style="max-width:NNNpx". A percentage
    // width has nothing to resolve against in a detached image, and the inline
    // max-width overrides whatever width we set — both make the raster blank
    // or time out. Replace them with absolute pixels.
    const sized = svg
      .replace(/(<svg[^>]*?)\swidth="[^"]*"/, "$1")
      .replace(/(<svg[^>]*?)\sheight="[^"]*"/, "$1")
      .replace(/(<svg[^>]*?)\sstyle="[^"]*"/, "$1")
      .replace(/<svg/, `<svg width="${w}" height="${h}"`);

    const img = new Image();
    const blob = new Blob([sized], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas 2d context unavailable");
        ctx.fillStyle = "#ffffff";          // Word has no transparency support
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      } catch (e: any) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG failed to load into an image"));
    };
    img.src = url;
  });
}

/** Render one mermaid diagram. Never throws — a bad diagram returns an error. */
const RENDER_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms)),
  ]);
}

/**
 * Render one mermaid diagram. Never throws and never hangs — a diagram that
 * fails or stalls returns an error so the export can fall back to its source.
 */
export async function renderOne(code: string, id: string): Promise<RenderedDiagram> {
  const attempt = async (src: string) => {
    const mermaid = await getMermaid();
    const { svg } = await withTimeout<{ svg: string }>(
      mermaid.render(id, src), RENDER_TIMEOUT_MS, "mermaid render");
    return withTimeout(svgToPng(svg), RENDER_TIMEOUT_MS, "raster");
  };

  try {
    return { code, png: await attempt(code) };
  } catch (first: any) {
    // Models routinely emit unquoted parentheses in node labels. Retry once
    // with the label quoted before giving up.
    try {
      const fixed = sanitizeMermaid(code);
      if (fixed !== code) {
        console.warn("[mermaid] retrying with sanitised source:", first?.message);
        return { code, png: await attempt(fixed) };
      }
    } catch (second: any) {
      console.warn("[mermaid] sanitised retry also failed:", second?.message);
      return { code, png: null, error: second?.message ?? String(second) };
    }
    console.warn("[mermaid] render failed:", first?.message);
    return { code, png: null, error: first?.message ?? String(first) };
  }
}

/**
 * Replace every ```mermaid block with an <img> carrying the rendered PNG.
 *
 * A diagram that fails to render keeps its fenced code, so nothing is lost —
 * the export degrades to the previous behaviour for that one block instead of
 * failing the whole document.
 */
export async function inlineMermaidAsImages(markdown: string): Promise<{
  markdown: string;
  rendered: number;
  failed: number;
}> {
  if (!hasMermaid(markdown)) return { markdown, rendered: 0, failed: 0 };

  const blocks = extractMermaid(markdown);
  const results: RenderedDiagram[] = [];
  for (let i = 0; i < blocks.length; i++) {
    results.push(await renderOne(blocks[i], `brd-mmd-${Date.now()}-${i}`));
  }

  let i = 0;
  const out = markdown.replace(FENCE, (whole) => {
    const r = results[i++];
    if (!r?.png) return whole;                       // keep the code on failure
    return `<img src="${r.png}" alt="Process flow diagram" ` +
           `style="max-width:100%;height:auto;" />`;
  });

  return {
    markdown: out,
    rendered: results.filter((r) => r.png).length,
    failed: results.filter((r) => !r.png).length,
  };
}
