"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

// Mermaid is loaded dynamically inside useEffect so this module stays
// CommonJS-compatible during Next's server prerender pass. Mermaid is an
// ESM-only package and a static import breaks the build.
let mermaidPromise: Promise<any> | null = null;
let mermaidInitialized = false;
async function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => (mod as any).default || mod);
  }
  const m = await mermaidPromise;
  if (!mermaidInitialized) {
    m.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "loose",
      fontFamily: "inherit",
    });
    mermaidInitialized = true;
  }
  return m;
}

interface MermaidChartProps {
  chart: string;
}

export default function MermaidChart({ chart }: MermaidChartProps) {
  const [svgContent, setSvgContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chart) return;

    let isMounted = true;
    setError(null);
    setSvgContent("");

    const renderChart = async () => {
      try {
        const m = await getMermaid();
        const newId = `mermaid-${Math.random().toString(36).substring(7)}`;
        const { svg } = await m.render(newId, chart);
        if (isMounted) {
          setSvgContent(svg);
        }
      } catch (err: any) {
        console.error("Mermaid rendering failed:", err);
        if (isMounted) {
          setError(err.message || "Failed to render flowchart. The AI generated invalid Mermaid syntax.");
        }
      }
    };

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-red-500 bg-red-50 rounded-xl border border-red-200">
        <p className="font-semibold mb-2">Diagram rendering error</p>
        <p className="text-sm opacity-80 max-w-xl">{error}</p>
        <pre className="mt-4 p-4 bg-white rounded border text-left text-xs text-red-800 overflow-auto w-full max-h-[200px]">
          {chart}
        </pre>
      </div>
    );
  }

  if (!svgContent) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Rendering Diagram...
      </div>
    );
  }

  return (
    <div 
      className="w-full h-full min-h-[500px] flex items-center justify-center overflow-auto p-4 bg-slate-50 rounded-xl"
      dangerouslySetInnerHTML={{ __html: svgContent }} 
    />
  );
}
