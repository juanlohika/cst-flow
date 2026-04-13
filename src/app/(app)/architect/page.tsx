"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import dynamic from "next/dynamic";
import SmartMic from "@/components/ui/SmartMic";
import WorkflowCanvas from "@/components/flow/WorkflowCanvas";
import { ArrowUp, Loader2, LayoutTemplate, Save, ZoomIn, ZoomOut, Maximize, Download, Paperclip, X, Brain } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { Node, Edge } from "@xyflow/react";
import * as htmlToImage from "html-to-image";

const MermaidChart = dynamic(() => import("@/components/flow/MermaidChart"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center p-12 text-muted-foreground w-full h-full min-h-[500px]">
      <Loader2 className="h-6 w-6 animate-spin mb-2" />
      Loading Diagram Engine...
    </div>
  ),
});

type AttachedImage = { base64: string; mimeType: string; preview: string; name: string };
type AIProvider = "auto" | "claude" | "gemini" | "groq";

export default function ArchitectPage() {
  return (
    <AuthGuard>
      <Suspense>
        <ArchitectContent />
      </Suspense>
    </AuthGuard>
  );
}

function ArchitectContent() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "model", content: string }[]>([]);
  const [diagramType, setDiagramType] = useState<"swimlane" | "regular" | "mermaid" | "mermaid-sequence">("swimlane");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [provider, setProvider] = useState<AIProvider>("auto");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Default placeholder flowchart
  const INITIAL_NODES: Node[] = [
    { id: "lane-client", type: "swimlane", data: { label: "Client Level", width: 1000, height: 200, colorIndex: 0 }, position: { x: 0, y: 0 }, style: { width: 1000, height: 200 }, draggable: false, selectable: false, zIndex: -1 },
    { id: "lane-system", type: "swimlane", data: { label: "System Logic", width: 1000, height: 200, colorIndex: 1 }, position: { x: 0, y: 220 }, style: { width: 1000, height: 200 }, draggable: false, selectable: false, zIndex: -1 },
    { id: "s1", type: "startend", data: { label: "Client Input" }, position: { x: 50, y: 50 }, parentId: "lane-client", extent: "parent" },
    { id: "s2", type: "process", data: { label: "System Validate" }, position: { x: 400, y: 50 }, parentId: "lane-system", extent: "parent" },
  ];
  const INITIAL_EDGES: Edge[] = [
    { id: "e-1-2", source: "s1", target: "s2", sourceHandle: "bottom", targetHandle: "top", animated: true }
  ];

  const [nodes, setNodes] = useState<Node[]>(INITIAL_NODES);
  const [edges, setEdges] = useState<Edge[]>(INITIAL_EDGES);
  const [chart, setChart] = useState<string>("");
  const [mermaidScale, setMermaidScale] = useState(1);

  const accountId = searchParams.get("accountId");
  const flowCategory = searchParams.get("flowCategory");

  // Auto-switch to Claude when images are attached
  const effectiveProvider: AIProvider = attachedImages.length > 0 ? "claude" : provider;

  useEffect(() => {
    const loadId = searchParams.get("loadId");
    if (loadId && session?.user) {
      fetch("/api/works/" + loadId).then(r => r.json()).then(data => {
        if (data.data) {
          try {
            const parsed = JSON.parse(data.data);
            if (parsed.chart) setChart(parsed.chart);
            if (parsed.nodes) setNodes(parsed.nodes);
            if (parsed.edges) setEdges(parsed.edges);
            if (parsed.diagramType) setDiagramType(parsed.diagramType);
          } catch (e) { console.error(e); }
          setSavedId(data.id);
        }
      }).catch(console.error);
    }
  }, [searchParams, session]);

  // ── Image handling ──────────────────────────────────────────────────────────
  const fileToAttached = (file: File | Blob, name = "image"): Promise<AttachedImage> =>
    new Promise((resolve, reject) => {
      const mimeType = file.type || "image/png";
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const base64 = dataUrl.split(",")[1];
        resolve({ base64, mimeType, preview: dataUrl, name });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(i => i.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const item of imageItems) {
      const blob = item.getAsFile();
      if (!blob) continue;
      const attached = await fileToAttached(blob, `screenshot-${Date.now()}.png`);
      setAttachedImages(prev => [...prev, attached]);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("paste", handlePaste as any);
    return () => document.removeEventListener("paste", handlePaste as any);
  }, [handlePaste]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const attached = await fileToAttached(file, file.name);
      setAttachedImages(prev => [...prev, attached]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const saveToCloud = async () => {
    if (!session?.user) { alert("Please sign in to save."); return; }
    if (nodes.length === 0 && !chart) { alert("Generate a flowchart first."); return; }
    const title = prompt || messages[0]?.content?.slice(0, 60) || "Untitled Workflow";
    setSaving(true);
    try {
      const payload: any = {
        id: savedId, appType: "architect", title,
        data: JSON.stringify({ nodes, edges, chart, diagramType }),
      };
      if (accountId) payload.clientProfileId = accountId;
      if (flowCategory) payload.flowCategory = flowCategory;
      const res = await fetch("/api/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) { setSavedId(data.id); alert("Saved to cloud!"); }
      else alert("Save failed: " + data.error);
    } catch (err: any) { alert("Error: " + err.message); }
    finally { setSaving(false); }
  };

  const handleTranscription = (text: string) => setPrompt((p) => (p ? p + " " + text : text));

  // ── Generate ────────────────────────────────────────────────────────────────
  const generateWorkflow = async () => {
    if (!prompt.trim() && attachedImages.length === 0) return;

    const userMsg = prompt || `[${attachedImages.length} image${attachedImages.length > 1 ? "s" : ""} attached]`;
    const newMessages: { role: "user" | "model", content: string }[] = [
      ...messages,
      { role: "user", content: userMsg },
    ];
    setMessages(newMessages);
    setPrompt("");

    const images = [...attachedImages];
    setAttachedImages([]);

    const customInstruction = localStorage.getItem(`prompt_${diagramType === "mermaid" ? "swimlane" : diagramType}`);

    setLoading(true);
    setMermaidScale(1);

    try {
      const res = await fetch("/api/architect/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userMsg,
          messages: newMessages,
          diagramType,
          systemInstruction: customInstruction,
          provider: effectiveProvider,
          images: images.map(img => ({ base64: img.base64, mimeType: img.mimeType })),
        }),
      });

      const data = await res.json();

      if (res.ok) {
        if (diagramType.startsWith("mermaid") && data.chart) {
          setChart(data.chart);
          setNodes([]); setEdges([]);
        } else if (data.nodes && data.edges) {
          setNodes(data.nodes);
          setEdges(data.edges);
          setChart("");
        }
        setMessages(prev => [...prev, { role: "model", content: "✅ Successfully updated the flowchart layout!" }]);
      } else {
        setMessages(prev => [...prev, { role: "model", content: `❌ Backend Error: ${data.error || "Failed to generate workflow."}` }]);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: "model", content: `🚨 Network Error / Crash: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleMermaidZoom = (direction: "in" | "out" | "reset") => {
    if (direction === "in") setMermaidScale(s => Math.min(s + 0.2, 3));
    if (direction === "out") setMermaidScale(s => Math.max(s - 0.2, 0.2));
    if (direction === "reset") setMermaidScale(1);
  };

  const handleMermaidExport = () => {
    const el = document.getElementById("mermaid-export-target");
    if (!el) return;
    const oldScale = mermaidScale;
    setMermaidScale(1);
    setTimeout(() => {
      htmlToImage.toPng(el, { backgroundColor: "#ffffff" })
        .then((dataUrl) => {
          const a = document.createElement("a");
          const name = diagramType === "mermaid-sequence" ? "cst_sequence.png" : "cst_flowchart.png";
          a.setAttribute("download", name);
          a.setAttribute("href", dataUrl);
          a.click();
          setMermaidScale(oldScale);
        })
        .catch(err => { console.error("Export failed", err); setMermaidScale(oldScale); });
    }, 100);
  };

  const isMermaid = diagramType.startsWith("mermaid");

  const providerLabel: Record<AIProvider, string> = {
    auto: "Auto",
    claude: "Claude",
    gemini: "Gemini",
    groq: "Groq",
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-1/3 border-r bg-card flex flex-col shadow-xl z-20">
        <div className="p-6 border-b flex justify-between items-start shrink-0">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Workflow Architect</h1>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-[200px]">
              Combine intelligence with dual-rendered flowcharts.
            </p>
          </div>
          <div className="flex flex-col gap-2 items-end shrink-0">
            <div className="flex flex-col gap-1 items-end">
              <label className="text-[0.65rem] font-bold uppercase text-primary tracking-wider flex items-center gap-1">
                <LayoutTemplate className="h-3 w-3" /> Diagram Engine
              </label>
              <select
                value={diagramType}
                onChange={(e: any) => setDiagramType(e.target.value)}
                className="text-xs bg-muted border font-medium rounded-md px-2 py-1.5 outline-none ring-primary/50 focus:ring-2 shadow-sm"
              >
                <option value="swimlane">React Flow: Swimlanes</option>
                <option value="regular">React Flow: Auto-Layout</option>
                <option value="mermaid">Mermaid.js: Flowchart</option>
                <option value="mermaid-sequence">Mermaid.js: Sequence Diagram</option>
              </select>
            </div>

            {/* AI Provider selector */}
            <div className="flex flex-col gap-1 items-end">
              <label className="text-[0.65rem] font-bold uppercase text-primary tracking-wider flex items-center gap-1">
                <Brain className="h-3 w-3" /> AI Provider
              </label>
              <select
                value={provider}
                onChange={(e: any) => setProvider(e.target.value)}
                className="text-xs bg-muted border font-medium rounded-md px-2 py-1.5 outline-none ring-primary/50 focus:ring-2 shadow-sm"
              >
                <option value="auto">Auto (use app default)</option>
                <option value="claude">Claude (Anthropic)</option>
                <option value="gemini">Gemini (Google)</option>
                <option value="groq">Groq (Fast)</option>
              </select>
              {attachedImages.length > 0 && provider !== "claude" && (
                <p className="text-[9px] text-amber-600 font-bold">
                  ⚠ Switched to Claude for image reading
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/30 flex flex-col">
          <div className="bg-background shadow-sm border rounded-xl p-4 max-w-[85%] text-sm leading-relaxed self-start">
            Hello! I am ready to convert your business requirements into a process workflow. Select your diagram engine above, attach images or screenshots, and let&apos;s start building!
          </div>

          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`p-4 text-sm leading-relaxed max-w-[85%] border shadow-sm ${msg.role === "user" ? "self-end bg-primary text-primary-foreground rounded-2xl rounded-tr-sm" : "self-start bg-background rounded-2xl rounded-tl-sm"}`}
            >
              {msg.content}
            </div>
          ))}

          {loading && (
            <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 max-w-[85%] text-sm animate-pulse flex items-center gap-3 self-start">
              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              Analyzing{attachedImages.length > 0 ? " images and" : ""} drawing the architecture...
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-background shrink-0">
          {/* Image thumbnails */}
          {attachedImages.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {attachedImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img src={img.preview} alt={img.name} className="w-14 h-14 object-cover rounded-lg border border-border" />
                  <button
                    type="button"
                    onClick={() => setAttachedImages(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={8} />
                  </button>
                </div>
              ))}
              <div className="text-[9px] font-bold text-amber-600 self-center">
                Claude will read {attachedImages.length} image{attachedImages.length > 1 ? "s" : ""}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generateWorkflow(); } }}
              rows={3}
              placeholder={attachedImages.length > 0 ? "Describe what to extract from the image(s)... (or leave blank)" : "Describe process flow here... (Shift+Enter for new line, Ctrl+V to paste screenshot)"}
              disabled={loading}
              className="w-full rounded-2xl border bg-muted/50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 resize-vertical min-h-[50px] max-h-[250px]"
            />
            <div className="flex items-center justify-between">
              {session?.user ? (
                <button onClick={saveToCloud} disabled={saving || (!chart && nodes.length === 0)} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors disabled:opacity-40">
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  {savedId ? "Update Cloud" : "Save to Cloud"}
                </button>
              ) : <div />}
              <div className="flex items-center gap-2">
                {/* Attach image button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach image (or paste with Ctrl+V)"
                  className="h-9 w-9 flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <SmartMic onTranscription={handleTranscription} disabled={loading} />
                <button
                  className="h-9 min-w-[100px] px-3 flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all shadow-md disabled:opacity-50"
                  onClick={generateWorkflow}
                  disabled={loading || (!prompt.trim() && attachedImages.length === 0)}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ArrowUp className="h-4 w-4" /> Generate</>}
                </button>
              </div>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Active provider indicator */}
          <div className="mt-2 flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
              Using: {providerLabel[effectiveProvider]}
              {attachedImages.length > 0 && provider !== "claude" ? " (auto-switched)" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 w-2/3 bg-surface-subtle relative overflow-hidden flex flex-col">
        {isMermaid && chart && (
          <div className="absolute top-4 right-4 z-[40] flex items-center gap-1 bg-surface-default border border-border-default shadow-sm rounded-lg p-1">
            <button onClick={handleMermaidExport} className="p-1.5 hover:bg-surface-muted rounded-md text-text-secondary border-r border-border-default pr-2 mr-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"><Download className="h-3.5 w-3.5" /> Export</button>
            <button onClick={() => handleMermaidZoom("out")} className="p-1.5 hover:bg-surface-muted rounded-md text-text-secondary"><ZoomOut className="h-4 w-4" /></button>
            <button onClick={() => handleMermaidZoom("reset")} className="p-1.5 hover:bg-surface-muted rounded-md text-text-secondary"><Maximize className="h-4 w-4" /></button>
            <button onClick={() => handleMermaidZoom("in")} className="p-1.5 hover:bg-surface-muted rounded-md text-text-secondary"><ZoomIn className="h-4 w-4" /></button>
            <span className="text-[10px] font-mono px-2 text-text-secondary">{Math.round(mermaidScale * 100)}%</span>
          </div>
        )}

        {isMermaid ? (
          chart ? (
            <div className="w-full h-full overflow-auto bg-surface-subtle p-8 flex items-center justify-center">
              <div
                id="mermaid-export-target"
                className="transition-transform duration-200 origin-center bg-surface-default shadow-xl rounded-xl border border-border-default p-8"
                style={{ transform: `scale(${mermaidScale})` }}
              >
                <MermaidChart chart={chart} />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-text-secondary flex-col">
              <LayoutTemplate className="h-16 w-16 mb-4 opacity-20" />
              <p>Your Mermaid diagram will appear here</p>
            </div>
          )
        ) : (
          <div className="w-full h-full">
            <WorkflowCanvas initialNodes={nodes} initialEdges={edges} />
          </div>
        )}
      </div>
    </div>
  );
}
