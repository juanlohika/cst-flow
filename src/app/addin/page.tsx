"use client";

import React, { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import {
  Sparkles,
  Send,
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Circle,
} from "lucide-react";

// ── Schema Types ────────────────────────────────────────────────────────────

type ShapeType = "picture" | "text" | "table" | "other";
type ShapeRole = "screenshot" | "title" | "body" | "caption" | "placeholder" | "decoration" | "data" | "unknown";
type SlideRole = "step" | "cover" | "summary" | "data" | "blank" | "mixed";
type Completeness = "complete" | "needs-instruction" | "needs-image" | "needs-data" | "empty";
type Location = "top-left" | "top-center" | "top-right" | "middle-left" | "center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right";

interface ShapeBounds { left: number; top: number; width: number; height: number }

interface ShapeSchema {
  shapeIdx: number;
  type: ShapeType;
  role: ShapeRole;
  context: string;          // AI-generated description (for pictures) or content summary
  location: Location;
  bounds: ShapeBounds;
  linkedTo: number[];       // shapeIdx values this shape is paired with
  content?: string;         // raw text / table string (for text/table shapes)
  base64?: string;          // only present during scan call, stripped after AI processes it
  mimeType?: string;
}

interface SlideSchema {
  slideIndex: number;       // 1-based
  slideRole: SlideRole;
  topic: string;
  completeness: Completeness;
  issues: string[];
  shapes: ShapeSchema[];
}

interface DeckSchema {
  scannedAt: string;
  deckRole: string;
  totalSlides: number;
  readySlides: number;
  slides: SlideSchema[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Derive a human-readable location label from shape bounds.
 *  Assumes standard PowerPoint slide dimensions (approx 960×540 pts). */
function deriveLocation(bounds: ShapeBounds): Location {
  const slideW = 960, slideH = 540;
  const cx = bounds.left + bounds.width / 2;
  const cy = bounds.top + bounds.height / 2;
  const col = cx < slideW / 3 ? "left" : cx < (slideW * 2) / 3 ? "center" : "right";
  const row = cy < slideH / 3 ? "top" : cy < (slideH * 2) / 3 ? "middle" : "bottom";
  if (row === "middle" && col === "center") return "center";
  return `${row}-${col}` as Location;
}

/** Returns true if text looks like a footer/copyright — skip these */
const isFooterText = (t: string) =>
  t.includes("©") || t.includes("All rights reserved") || t.includes("confidential") ||
  (t.length > 120 && !t.includes("\n"));

// ── Main Component ───────────────────────────────────────────────────────────

export default function AddinPage() {
  const { data: session, status } = useSession();
  const [officeInitialized, setOfficeInitialized] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deckSchema, setDeckSchema] = useState<DeckSchema | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  // Initialize Office JS
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";
    script.async = true;
    script.onload = () => {
      window.Office.onReady((info: any) => {
        if (info.host === window.Office.HostType.PowerPoint) {
          setOfficeInitialized(true);
        }
      });
    };
    document.head.appendChild(script);
    return () => { if (document.head.contains(script)) document.head.removeChild(script); };
  }, []);

  // Fetch clients
  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/addin/client-data")
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setClients(data); })
        .catch(err => console.error("Failed to load clients", err));
    }
  }, [status]);

  const handleLogin = () => {
    const width = 500, height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      "/auth/signin?callbackUrl=/addin/auth-complete",
      "tarkie-auth",
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
    );
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/auth/session");
        const s = await res.json();
        if (s?.user) { clearInterval(interval); if (popup && !popup.closed) popup.close(); window.location.reload(); }
      } catch {}
    }, 1500);
    setTimeout(() => clearInterval(interval), 120000);
  };

  // ── Office JS: Scan a single slide into raw ShapeSchema[] ──────────────────
  // Returns shapes with base64 for pictures so the scan-schema API can describe them.
  const scanSlideRaw = async (slideIndex: number): Promise<ShapeSchema[]> => {
    return await window.PowerPoint.run(async (context: any) => {
      const slide = context.presentation.slides.getItemAt(slideIndex);
      const shapes = slide.shapes;
      shapes.load("items");
      await context.sync();

      const result: ShapeSchema[] = [];

      for (let i = 0; i < shapes.items.length; i++) {
        const shape = shapes.items[i];

        // Load common properties available on all shapes
        shape.load("left,top,width,height,name");
        await context.sync();

        const bounds: ShapeBounds = {
          left: shape.left || 0,
          top: shape.top || 0,
          width: shape.width || 0,
          height: shape.height || 0,
        };
        const location = deriveLocation(bounds);

        // ── Try as table ──────────────────────────────────────────────────
        let handled = false;
        try {
          const table = shape.getTable();
          table.load("rowCount,columnCount");
          await context.sync();

          const rows = table.rowCount;
          const cols = table.columnCount;
          let tableStr = `[TABLE:${i} rows:${rows} cols:${cols}]\n`;

          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const cell = table.getCellOrNullObject(r, c);
              cell.load("text");
              await context.sync();
              const val = cell.isNullObject ? "" : (cell.text || "").trim();
              tableStr += `[${r},${c}]="${val}" `;
            }
            tableStr += "\n";
          }

          result.push({
            shapeIdx: i, type: "table", role: "data",
            context: "", location, bounds, linkedTo: [],
            content: tableStr.trim(),
          });
          handled = true;
        } catch { /* not a table */ }
        if (handled) continue;

        // ── Try as picture ────────────────────────────────────────────────
        try {
          const image = shape.image;
          image.load("base64");
          await context.sync();
          if (image.base64) {
            result.push({
              shapeIdx: i, type: "picture", role: "screenshot",
              context: "", location, bounds, linkedTo: [],
              base64: image.base64, mimeType: "image/png",
            });
            handled = true;
          }
        } catch { /* not a picture */ }
        if (handled) continue;

        // ── Try as text shape ─────────────────────────────────────────────
        try {
          shape.textFrame.textRange.load("text");
          await context.sync();
          const t = shape.textFrame.textRange.text?.trim();
          if (t && !isFooterText(t)) {
            result.push({
              shapeIdx: i, type: "text", role: "unknown",
              context: t, location, bounds, linkedTo: [],
              content: t,
            });
            handled = true;
          }
        } catch { /* not a text shape */ }

        if (!handled) {
          result.push({
            shapeIdx: i, type: "other", role: "decoration",
            context: "", location, bounds, linkedTo: [],
          });
        }
      }

      return result;
    });
  };

  /** Gets the 0-based index of the currently active slide */
  const getActiveSlideIndex = async (): Promise<number> => {
    return await window.PowerPoint.run(async (context: any) => {
      const slides = context.presentation.getSelectedSlides();
      slides.load("items");
      await context.sync();
      if (slides.items.length === 0) return 0;
      const allSlides = context.presentation.slides;
      allSlides.load("items");
      await context.sync();
      const selectedId = slides.items[0].id;
      const idx = allSlides.items.findIndex((s: any) => s.id === selectedId);
      return idx >= 0 ? idx : 0;
    });
  };

  /** Get total slide count */
  const getSlideCount = async (): Promise<number> => {
    return await window.PowerPoint.run(async (context: any) => {
      const slides = context.presentation.slides;
      slides.load("items");
      await context.sync();
      return slides.items.length;
    });
  };

  // ── Scan full deck → call scan-schema API → store DeckSchema ───────────────
  const handleScanDeck = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setError(null);
    setStatusMsg("Reading slides...");

    try {
      const slideCount = await getSlideCount();
      const rawSlides: { slideIndex: number; shapes: ShapeSchema[] }[] = [];

      for (let i = 0; i < slideCount; i++) {
        setStatusMsg(`Reading slide ${i + 1} of ${slideCount}...`);
        const shapes = await scanSlideRaw(i);
        rawSlides.push({ slideIndex: i + 1, shapes });
      }

      setStatusMsg("Analyzing with AI...");
      const res = await fetch("/api/addin/scan-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slides: rawSlides, clientId: selectedClient }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");

      setDeckSchema(data.schema);
      setMessages(prev => [...prev, { role: "ai", text: data.summary }]);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsProcessing(false);
      setStatusMsg("");
    }
  };

  // ── Apply suggestions to a slide ───────────────────────────────────────────
  // Suggestions can be:
  //   { shapeIdx, row, col, replacement }  → table cell write
  //   { shapeIdx, replacement }            → text shape write (by index, no search)
  //   { original, replacement }            → legacy text search fallback
  const applyToSlide = async (slideIdx: number, suggestions: any[]) => {
    if (!suggestions || suggestions.length === 0) return;

    await window.PowerPoint.run(async (context: any) => {
      const slide = context.presentation.slides.getItemAt(slideIdx);
      slide.shapes.load("items");
      await context.sync();

      const shapes = slide.shapes.items;

      for (const s of suggestions) {
        const shape = s.shapeIdx !== undefined ? shapes[s.shapeIdx] : null;

        // ── Table cell write (by shapeIdx + row + col) ──────────────────
        if (shape && s.row !== undefined && s.col !== undefined) {
          try {
            const table = shape.getTable();
            table.load("rowCount,columnCount");
            await context.sync();

            // Add rows if needed — table.rows.add requires PowerPointApi 1.9
            // (Desktop build 2508+). On older Desktop it throws — catch and warn.
            if (table.rowCount <= s.row) {
              try {
                while (table.rowCount <= s.row) {
                  table.rows.add(table.rowCount, 1);
                  await context.sync();
                  table.load("rowCount");
                  await context.sync();
                }
              } catch (addErr: any) {
                console.warn(`[Tarkie] table.rows.add not supported on this Desktop version. Row ${s.row} cannot be added. Skipping.`, addErr);
                setError(`Cannot add new rows on this version of PowerPoint Desktop. Please update PowerPoint or use PowerPoint Web.`);
                continue;
              }
            }

            // Add columns if needed
            if (table.columnCount <= s.col) {
              try {
                while (table.columnCount <= s.col) {
                  table.columns.add(table.columnCount, 1);
                  await context.sync();
                  table.load("columnCount");
                  await context.sync();
                }
              } catch (addErr: any) {
                console.warn(`[Tarkie] table.columns.add not supported on this Desktop version. Col ${s.col} cannot be added. Skipping.`, addErr);
                setError(`Cannot add new columns on this version of PowerPoint Desktop. Please update PowerPoint or use PowerPoint Web.`);
                continue;
              }
            }

            const cell = table.getCellOrNullObject(s.row, s.col);
            cell.load("text");
            await context.sync();
            if (!cell.isNullObject) {
              cell.text = s.replacement;
              await context.sync();
              console.log(`[Tarkie] ✓ table[${s.row},${s.col}] → "${s.replacement}"`);
            }
          } catch (e) {
            console.warn(`[Tarkie] table write failed for shape ${s.shapeIdx}:`, e);
          }
          continue;
        }

        // ── Text shape write by shapeIdx ────────────────────────────────
        if (shape && s.shapeIdx !== undefined && s.replacement !== undefined && s.row === undefined) {
          try {
            shape.textFrame.textRange.load("text");
            await context.sync();
            const raw = shape.textFrame.textRange.text || "";
            if (!isFooterText(raw)) {
              shape.textFrame.textRange.text = s.replacement;
              await context.sync();
              console.log(`[Tarkie] ✓ shape[${s.shapeIdx}] text → "${s.replacement}"`);
            }
          } catch (e) {
            console.warn(`[Tarkie] text write failed for shape ${s.shapeIdx}:`, e);
          }
          continue;
        }

        // ── Legacy fallback: text search-and-replace ────────────────────
        if (s.original !== undefined) {
          for (const sh of shapes) {
            try {
              sh.textFrame.textRange.load("text");
              await context.sync();
              const raw = sh.textFrame.textRange.text || "";
              if (raw.includes(s.original) && !isFooterText(raw)) {
                sh.textFrame.textRange.text = raw.split(s.original).join(s.replacement);
                await context.sync();
                console.log(`[Tarkie] ✓ legacy "${s.original}" → "${s.replacement}"`);
              }
            } catch { /* not a text shape */ }
          }
        }
      }
    });
  };

  // ── One-click account update for current slide ─────────────────────────────
  const handleQuickUpdate = async () => {
    if (!selectedClient || isProcessing) return;
    setIsProcessing(true);
    setError(null);
    setStatusMsg("Reading current slide...");

    try {
      const activeSlideIdx = await getActiveSlideIndex();

      // Use stored schema for this slide if available, otherwise do a raw scan
      let slideSchemaForAI: any;
      if (deckSchema) {
        slideSchemaForAI = deckSchema.slides.find(s => s.slideIndex === activeSlideIdx + 1) || null;
      }

      // If no schema yet, do a quick raw scan of just this slide (without image AI description)
      if (!slideSchemaForAI) {
        const shapes = await scanSlideRaw(activeSlideIdx);
        slideSchemaForAI = { slideIndex: activeSlideIdx + 1, shapes };
      }

      setStatusMsg("Updating with account data...");
      const res = await fetch("/api/addin/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Update this slide with the correct account information from the intelligence data. Replace placeholders and incorrect values with real data from the account. Preserve structure and formatting.",
          clientId: selectedClient,
          slideSchema: slideSchemaForAI,
          history: [],
          activeSlideIndex: activeSlideIdx + 1,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");

      setMessages(prev => [...prev, { role: "ai", text: data.text || "(no response)" }]);

      if (data.suggestions?.length > 0) {
        setStatusMsg("Applying updates...");
        const bySlide: Record<number, any[]> = {};
        for (const s of data.suggestions) {
          const idx = (s.slideIndex ?? (activeSlideIdx + 1)) - 1;
          if (!bySlide[idx]) bySlide[idx] = [];
          bySlide[idx].push(s);
        }
        for (const [idxStr, suggs] of Object.entries(bySlide)) {
          await applyToSlide(Number(idxStr), suggs);
        }
      }
    } catch (err: any) {
      setError(err.message || "Quick update failed.");
    } finally {
      setIsProcessing(false);
      setStatusMsg("");
    }
  };

  // ── Chat: send instruction with current slide schema ───────────────────────
  const processChat = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isProcessing) return;

    const userMsg = chatInput;
    setChatInput("");
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setIsProcessing(true);
    setStatusMsg("Reading current slide...");
    setError(null);

    try {
      const activeSlideIdx = await getActiveSlideIndex();

      // Use stored schema for this slide if available
      let slideSchemaForAI: any;
      if (deckSchema) {
        slideSchemaForAI = deckSchema.slides.find(s => s.slideIndex === activeSlideIdx + 1) || null;
      }
      if (!slideSchemaForAI) {
        const shapes = await scanSlideRaw(activeSlideIdx);
        slideSchemaForAI = { slideIndex: activeSlideIdx + 1, shapes };
      }

      setStatusMsg("Thinking...");
      const res = await fetch("/api/addin/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: userMsg,
          clientId: selectedClient,
          slideSchema: slideSchemaForAI,
          history: messages.slice(-14),
          activeSlideIndex: activeSlideIdx + 1,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI returned an error");

      setMessages(prev => [...prev, { role: "ai", text: data.text || "(no response)" }]);

      if (data.suggestions?.length > 0) {
        setStatusMsg("Applying updates...");
        const bySlide: Record<number, any[]> = {};
        for (const s of data.suggestions) {
          const idx = (s.slideIndex ?? (activeSlideIdx + 1)) - 1;
          if (!bySlide[idx]) bySlide[idx] = [];
          bySlide[idx].push(s);
        }
        for (const [idxStr, suggs] of Object.entries(bySlide)) {
          await applyToSlide(Number(idxStr), suggs);
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to process request.");
    } finally {
      setIsProcessing(false);
      setStatusMsg("");
    }
  };

  // ── Deck health summary for UI ─────────────────────────────────────────────
  const deckHealth = deckSchema
    ? { total: deckSchema.totalSlides, ready: deckSchema.readySlides, role: deckSchema.deckRole }
    : null;

  // ── Loading / Unauthenticated states ──────────────────────────────────────
  if (status === "loading" || !officeInitialized) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 p-6 text-center">
        <Loader2 className="w-8 h-8 text-[#2162F9] animate-spin mb-4" />
        <p className="text-sm font-bold text-slate-600">Initializing Intelligence Bridge...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-white p-6 text-center">
        <div className="w-16 h-16 bg-[#2162F9]/10 rounded-full flex items-center justify-center mb-6">
          <Sparkles className="w-8 h-8 text-[#2162F9]" />
        </div>
        <h1 className="text-xl font-black text-slate-800 mb-2 uppercase tracking-tight">Tarkie AI</h1>
        <p className="text-xs text-slate-500 mb-8 font-medium">Please sign in to access client intelligence and generation tools.</p>
        <button
          onClick={handleLogin}
          className="w-full bg-[#2162F9] text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:shadow-lg transition-all"
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-slate-100 bg-white sticky top-0 z-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-[#2162F9] to-[#43EB7C] rounded-lg flex items-center justify-center shadow-sm shadow-blue-500/20">
              <Sparkles size={12} className="text-white" />
            </div>
            <span className="text-xs font-black uppercase tracking-widest text-slate-800">Tarkie AI</span>
          </div>
          <div className="px-2 py-1 bg-blue-50/50 rounded-full flex items-center gap-1.5">
            <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
            <p className="text-[8px] text-[#2162F9] font-black uppercase tracking-tighter">Claude Sonnet 4.5</p>
          </div>
        </div>

        <div className="space-y-2">
          {/* Account dropdown + quick update */}
          <div className="flex items-center gap-2">
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="flex-1 bg-slate-100/80 border-none rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#2162F9]/20 transition-all cursor-pointer shadow-inner"
            >
              <option value="">General Intelligence</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.companyName}</option>
              ))}
            </select>

            {selectedClient && (
              <button
                onClick={handleQuickUpdate}
                disabled={isProcessing}
                title="Update current slide with account data"
                className="shrink-0 h-9 px-3 bg-gradient-to-br from-[#2162F9] to-[#3a79ff] text-white rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 hover:shadow-lg hover:shadow-blue-500/30 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none transition-all active:scale-95"
              >
                <Sparkles size={11} />
                Update
              </button>
            )}
          </div>

          {/* No intelligence warning */}
          {selectedClient && (() => {
            const client = clients.find(c => c.id === selectedClient);
            if (client && !client.intelligenceContent) {
              return (
                <div className="px-2 py-1.5 bg-amber-50 border border-amber-100 rounded-lg flex items-start gap-1.5">
                  <AlertCircle size={10} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[9px] font-bold text-amber-700 leading-tight">
                    No intelligence for this account. Add it in <span className="font-black">Accounts → Intelligence</span>.
                  </p>
                </div>
              );
            }
            return null;
          })()}

          {/* Deck health + scan button */}
          <div className="flex items-center justify-between px-1">
            {deckHealth ? (
              <div className="flex items-center gap-1.5">
                {deckHealth.ready === deckHealth.total
                  ? <CheckCircle2 size={10} className="text-green-500" />
                  : <Circle size={10} className="text-amber-400" />
                }
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  {deckHealth.ready}/{deckHealth.total} slides ready
                  {deckHealth.role !== "mixed" && ` · ${deckHealth.role}`}
                </span>
              </div>
            ) : (
              <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Not scanned</span>
            )}

            <button
              onClick={handleScanDeck}
              disabled={isProcessing}
              className="text-[9px] font-black text-[#2162F9] uppercase tracking-widest flex items-center gap-1 hover:underline disabled:opacity-30 disabled:no-underline"
            >
              <RefreshCw size={10} className={isProcessing && statusMsg.includes("slide") ? "animate-spin" : ""} />
              Scan Deck
            </button>
          </div>
        </div>
      </div>

      {/* ── Chat Messages ────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-4 space-y-5 styled-scroll bg-[radial-gradient(#f1f5f9_1px,transparent_1px)] [background-size:20px_20px]">
        {messages.length === 0 && (
          <div className="text-center py-10 px-6">
            <div className="w-14 h-14 bg-white shadow-xl shadow-blue-500/5 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-slate-50">
              <Sparkles className="text-[#2162F9]/30" size={24} />
            </div>
            <h3 className="text-[11px] font-black text-slate-800 uppercase tracking-widest mb-2">Ready to assist</h3>
            <p className="text-[10px] font-bold text-slate-400 leading-relaxed italic max-w-[180px] mx-auto">
              Scan the deck first, then select an account and click Update — or just type an instruction.
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
            <div className={`max-w-[92%] p-3 shadow-sm text-[11px] font-medium leading-relaxed whitespace-pre-wrap ${
              m.role === "user"
                ? "bg-gradient-to-br from-[#2162F9] to-[#3a79ff] text-white rounded-2xl rounded-tr-sm"
                : "bg-white border border-slate-100 text-slate-700 rounded-2xl rounded-tl-sm"
            }`}>
              {m.text}
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-100 px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-[#2162F9] rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-2 h-2 bg-[#2162F9] rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-2 h-2 bg-[#2162F9] rounded-full animate-bounce" />
              </div>
              {statusMsg && (
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{statusMsg}</p>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2">
            <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] font-black text-red-600 leading-normal uppercase tracking-tighter">{error}</p>
          </div>
        )}

        {/* Per-slide completeness cards (shown after scan) */}
        {deckSchema && messages.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest px-1">Deck Overview</p>
            {deckSchema.slides.map(slide => (
              <div key={slide.slideIndex} className="bg-white border border-slate-100 rounded-xl px-3 py-2 flex items-start gap-2 shadow-sm">
                <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                  slide.completeness === "complete" ? "bg-green-400" :
                  slide.completeness === "empty" ? "bg-slate-200" : "bg-amber-400"
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black text-slate-700 truncate">
                    Slide {slide.slideIndex} · {slide.topic || slide.slideRole}
                  </p>
                  {slide.issues.length > 0 && (
                    <p className="text-[9px] text-amber-600 font-bold leading-tight mt-0.5">{slide.issues[0]}</p>
                  )}
                </div>
                <span className={`text-[8px] font-black uppercase tracking-widest shrink-0 ${
                  slide.completeness === "complete" ? "text-green-500" :
                  slide.completeness === "empty" ? "text-slate-300" : "text-amber-500"
                }`}>
                  {slide.completeness.replace("-", " ")}
                </span>
              </div>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Chat Input ───────────────────────────────────────────── */}
      <div className="p-4 bg-white border-t border-slate-100 shadow-[0_-10px_40px_rgba(0,0,0,0.03)]">
        <form onSubmit={processChat} className="relative">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Type an instruction for the current slide..."
            className="w-full bg-slate-100 border-none rounded-2xl pl-4 pr-14 py-4 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#2162F9]/20 transition-all placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={isProcessing || !chatInput.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 bg-gradient-to-br from-[#2162F9] to-[#3a79ff] text-white rounded-xl flex items-center justify-center hover:shadow-lg hover:shadow-blue-500/30 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none transition-all active:scale-95"
          >
            <Send size={18} />
          </button>
        </form>
        <div className="flex items-center justify-center mt-3">
          <p className="text-[8px] text-slate-300 font-black uppercase tracking-[0.2em]">
            Tarkie OS Ecosystem · Schema-Aware Intelligence
          </p>
        </div>
      </div>

      <style jsx global>{`
        .styled-scroll::-webkit-scrollbar { width: 5px; }
        .styled-scroll::-webkit-scrollbar-track { background: transparent; }
        .styled-scroll::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 20px; }
        .styled-scroll::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}</style>
    </div>
  );
}
