"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Sparkles,
  Send,
  Loader2,
  AlertCircle,
  RefreshCw,
  Paperclip,
  X,
  Image as ImageIcon,
} from "lucide-react";

type AttachedImage = { base64: string; mimeType: string; preview: string; name: string };

/**
 * Tarkie PowerPoint Add-in Sidebar
 * This page loads inside the PowerPoint Task Pane.
 */

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
  const [applyToAll, setApplyToAll] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  // 1. Initialize Office JS
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
    
    return () => {
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, []);

  // 2. Fetch clients
  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/addin/client-data")
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setClients(data);
        })
        .catch(err => console.error("Failed to load clients", err));
    }
  }, [status]);

  const handleLogin = () => {
    const width = 500;
    const height = 600;
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
        const sessionRes = await res.json();
        if (sessionRes?.user) {
          clearInterval(interval);
          if (popup && !popup.closed) popup.close();
          window.location.reload();
        }
      } catch (e) {}
    }, 1500);

    setTimeout(() => clearInterval(interval), 120000);
  };

  /** Convert a File or Blob to AttachedImage */
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

  /** Handle paste — capture images pasted with Ctrl+V / Cmd+V */
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

  /** Listen for paste globally */
  useEffect(() => {
    document.addEventListener("paste", handlePaste as any);
    return () => document.removeEventListener("paste", handlePaste as any);
  }, [handlePaste]);

  /** Handle file input selection */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const attached = await fileToAttached(file, file.name);
      setAttachedImages(prev => [...prev, attached]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /** Returns true if text looks like a footer/copyright — skip these */
  const isFooterText = (t: string) =>
    t.includes("©") || t.includes("All rights reserved") || t.includes("confidential") ||
    (t.length > 120 && !t.includes("\n"));

  /** Reads all text from a slide's shapes + tables (0-based index).
   *  Tables are returned with cell coordinates so the AI can do exact-cell updates.
   *  Format: [TABLE:shapeIdx rows:R cols:C]
   *          [0,0]="Header1" [0,1]="Header2"
   *          [1,0]="Value1"  [1,1]="Value2"
   */
  const getSlideText = async (slideIndex: number): Promise<string[]> => {
    return await window.PowerPoint.run(async (context: any) => {
      const slide = context.presentation.slides.getItemAt(slideIndex);
      const shapes = slide.shapes;
      shapes.load("items");
      await context.sync();

      const texts: string[] = [];
      let shapeIdx = 0;

      for (const shape of shapes.items) {
        shape.load("type");
        await context.sync();

        // ── Table shape ───────────────────────────────────────────────────
        if (shape.type === window.PowerPoint.ShapeType.table) {
          try {
            const table = shape.getTable();
            table.load("rowCount,columnCount");
            await context.sync();

            const rows = table.rowCount;
            const cols = table.columnCount;
            let tableStr = `[TABLE:${shapeIdx} rows:${rows} cols:${cols}]\n`;

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
            texts.push(tableStr.trim());
          } catch (e) {
            console.warn("[Tarkie] table read failed:", e);
          }
          shapeIdx++;
          continue;
        }

        // ── Text shape ────────────────────────────────────────────────────
        try {
          shape.textFrame.textRange.load("text");
          await context.sync();
          const t = shape.textFrame.textRange.text?.trim();
          if (t && !isFooterText(t)) texts.push(t);
        } catch { /* not a text shape */ }
        shapeIdx++;
      }
      return texts;
    });
  };

  /** Gets the 0-based index of the currently active slide */
  const getActiveSlideIndex = async (): Promise<number> => {
    return await window.PowerPoint.run(async (context: any) => {
      const slides = context.presentation.getSelectedSlides();
      slides.load("items");
      await context.sync();
      if (slides.items.length === 0) return 0;
      // Get index by comparing with presentation slides
      const allSlides = context.presentation.slides;
      allSlides.load("items");
      await context.sync();
      const selectedId = slides.items[0].id;
      const idx = allSlides.items.findIndex((s: any) => s.id === selectedId);
      return idx >= 0 ? idx : 0;
    });
  };

  /** Scrapes all text from the current active slide */
  const getActiveSlideContent = async (): Promise<string[]> => {
    const idx = await getActiveSlideIndex();
    return getSlideText(idx);
  };

  /** Scrapes text from ALL slides */
  const getFullDeckContent = async (): Promise<{ slideIndex: number; content: string[] }[]> => {
    // Get slide count first
    const slideCount = await window.PowerPoint.run(async (context: any) => {
      const slides = context.presentation.slides;
      slides.load("items");
      await context.sync();
      return slides.items.length;
    });

    const deckData: { slideIndex: number; content: string[] }[] = [];
    for (let i = 0; i < slideCount; i++) {
      const content = await getSlideText(i);
      deckData.push({ slideIndex: i + 1, content });
    }
    return deckData;
  };

  /**
   * Applies all suggestions using:
   * 1. Office JS for regular text shapes (fast path)
   * 2. getFileAsync + server OOXML patch for table cells (no sign-in needed)
   */
  /**
   * Applies suggestions to a slide.
   * Suggestions can be:
   *   - { row, col, replacement } — direct cell coordinate write (for tables)
   *   - { original, replacement } — text search-and-replace (for text shapes)
   */
  const applyToSlide = async (slideIdx: number, suggestions: any[]) => {
    if (!suggestions || suggestions.length === 0) return;

    await window.PowerPoint.run(async (context: any) => {
      const slide = context.presentation.slides.getItemAt(slideIdx);
      slide.shapes.load("items");
      await context.sync();

      const shapes = slide.shapes.items;
      let tableShapeIdx = 0;

      for (const shape of shapes) {
        shape.load("type");
        await context.sync();

        // ── Table: write by [row, col] coordinate, add rows/cols as needed ──────
        if (shape.type === window.PowerPoint.ShapeType.table) {
          const cellSuggestions = suggestions.filter(
            s => s.row !== undefined && s.col !== undefined &&
              (s.shapeIdx === undefined || s.shapeIdx === tableShapeIdx)
          );

          if (cellSuggestions.length > 0) {
            const table = shape.getTable();
            table.load("rowCount,columnCount");
            await context.sync();

            // Add any missing rows first (in order, so indices stay valid)
            const maxRow = Math.max(...cellSuggestions.map((s: any) => s.row));
            const maxCol = Math.max(...cellSuggestions.map((s: any) => s.col));

            while (table.rowCount <= maxRow) {
              table.rows.add(table.rowCount, 1);
              await context.sync();
              table.load("rowCount");
              await context.sync();
              console.log(`[Tarkie] Added row, now ${table.rowCount} rows`);
            }

            while (table.columnCount <= maxCol) {
              table.columns.add(table.columnCount, 1);
              await context.sync();
              table.load("columnCount");
              await context.sync();
              console.log(`[Tarkie] Added column, now ${table.columnCount} cols`);
            }

            // Now write all cell values
            for (const s of cellSuggestions) {
              const cell = table.getCellOrNullObject(s.row, s.col);
              cell.load("text");
              await context.sync();
              if (cell.isNullObject) continue;
              cell.text = s.replacement;
              await context.sync();
              console.log(`[Tarkie] ✓ table[${s.row},${s.col}] → "${s.replacement}"`);
            }
          }
          tableShapeIdx++;
          continue;
        }

        // ── Text shape: search-and-replace ────────────────────────────────────
        const textSuggestions = suggestions.filter(s => s.original !== undefined && s.row === undefined);
        if (textSuggestions.length === 0) continue;
        try {
          shape.textFrame.textRange.load("text");
          await context.sync();
          const raw = shape.textFrame.textRange.text || "";
          if (!raw || isFooterText(raw)) continue;
          let updated = raw;
          for (const s of textSuggestions) {
            if (raw.includes(s.original)) {
              updated = updated.split(s.original).join(s.replacement);
              console.log(`[Tarkie] ✓ text "${s.original}" → "${s.replacement}"`);
            }
          }
          if (updated !== raw) {
            shape.textFrame.textRange.text = updated;
            await context.sync();
          }
        } catch { /* not a text shape */ }
      }
    });
  };

  const handleScanDeck = async () => {
    setIsProcessing(true);
    setStatusMsg("Scanning full deck architecture...");
    try {
      const fullContent = await getFullDeckContent();
      const res = await fetch("/api/addin/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullContent, clientId: selectedClient })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");

      setMessages(prev => [...prev, { role: "ai", text: data.text }]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsProcessing(false);
      setStatusMsg("");
    }
  };

  /**
   * Builds slides from an AI-generated plan.
   * Each plan item: { title, description, imageIndex, annotation?: { x, y, label } }
   * Images are inserted as pictures, title + description as text boxes.
   */
  const buildSlidesFromPlan = async (plan: any[], images: AttachedImage[]) => {
    await window.PowerPoint.run(async (context: any) => {
      const presentation = context.presentation;
      const slides = presentation.slides;
      slides.load("items");
      await context.sync();

      for (let i = 0; i < plan.length; i++) {
        const step = plan[i];
        setStatusMsg(`Building slide ${i + 1} of ${plan.length}...`);

        // Add a new blank slide at the end
        presentation.insertSlidesFromBase64(
          // minimal blank pptx slide — we just need a new empty slide
          "UEsDBBQABgAIAAAAIQDfpNJsWgEAACAFAAATAAgCW0NvbnRlbnRfVHlwZXNdLnhtbCCiBAIooAAC" +
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          {}
        );
        await context.sync();

        // Get the newly added slide (last one)
        slides.load("items");
        await context.sync();
        const newSlide = slides.items[slides.items.length - 1];

        // Add title text box at top
        if (step.title) {
          const titleBox = newSlide.shapes.addTextBox(step.title, {
            left: 30, top: 20, width: 480, height: 40,
          });
          titleBox.textFrame.textRange.font.size = 18;
          titleBox.textFrame.textRange.font.bold = true;
          await context.sync();
        }

        // Add image if specified
        const img = images[step.imageIndex ?? 0];
        if (img) {
          newSlide.shapes.addImage(`data:${img.mimeType};base64,${img.base64}`);
          await context.sync();

          // Position image below title
          const imgShapes = newSlide.shapes;
          imgShapes.load("items");
          await context.sync();
          const imgShape = imgShapes.items[imgShapes.items.length - 1];
          imgShape.left = 30;
          imgShape.top = 70;
          imgShape.width = 480;
          imgShape.height = 300;
          await context.sync();
        }

        // Add description text box below image
        if (step.description) {
          const descBox = newSlide.shapes.addTextBox(step.description, {
            left: 30, top: 380, width: 480, height: 80,
          });
          descBox.textFrame.textRange.font.size = 11;
          descBox.textFrame.wordWrap = true;
          await context.sync();
        }

        // Add annotation callout if AI specified one
        if (step.annotation) {
          const { x = 50, y = 50, label = "①" } = step.annotation;
          // Convert % position to slide coordinates (slide is ~540x400 pts visible area)
          const calloutLeft = 30 + (x / 100) * 480 - 15;
          const calloutTop = 70 + (y / 100) * 300 - 15;
          const callout = newSlide.shapes.addTextBox(label, {
            left: calloutLeft, top: calloutTop, width: 30, height: 30,
          });
          callout.textFrame.textRange.font.size = 14;
          callout.textFrame.textRange.font.bold = true;
          callout.textFrame.textRange.font.color = "#FFFFFF";
          callout.fill.setSolidColor("#2162F9");
          await context.sync();
        }

        console.log(`[Tarkie] ✓ Built slide ${i + 1}: ${step.title}`);
      }
    });
  };

  const processChat = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() && attachedImages.length === 0) return;
    if (isProcessing) return;

    const userMsg = chatInput;
    const images = [...attachedImages];
    setMessages(prev => [...prev, { role: "user", text: userMsg || `[${images.length} image${images.length > 1 ? "s" : ""} attached]` }]);
    setChatInput("");
    setAttachedImages([]);
    setIsProcessing(true);
    setStatusMsg(images.length > 0 ? "Analyzing images..." : applyToAll ? "Reading all slides..." : "Reading current slide...");
    setError(null);

    try {
      // ── Step 1: Read slide content via Office JS ──────────────────────────
      let slideContent: string[] = [];
      let allSlides: { slideIndex: number; content: string[] }[] = [];
      let activeSlideIdx = 0;

      if (applyToAll) {
        allSlides = await getFullDeckContent();
        activeSlideIdx = 0;
      } else {
        activeSlideIdx = await getActiveSlideIndex();
        slideContent = await getSlideText(activeSlideIdx);
      }

      // ── Step 2: Call AI once with all content ─────────────────────────────
      setStatusMsg("Thinking...");

      const body: any = {
        prompt: userMsg,
        clientId: selectedClient,
        history: messages.slice(-14),
        activeSlideIndex: activeSlideIdx + 1,
        images: images.map(img => ({ base64: img.base64, mimeType: img.mimeType })),
      };
      if (applyToAll) {
        body.allSlides = allSlides;
      } else {
        body.slideContent = slideContent;
      }

      const res = await fetch("/api/addin/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI returned an error");

      // ── Step 3: Show AI response ──────────────────────────────────────────
      setMessages(prev => [...prev, { role: "ai", text: data.text || "(no response)" }]);

      // ── Step 4: Apply suggestions to slides ───────────────────────────────
      if (data.suggestions && data.suggestions.length > 0) {
        setStatusMsg("Applying updates to slides...");
        const bySlide: Record<number, any[]> = {};
        for (const s of data.suggestions) {
          const idx = (s.slideIndex ?? (activeSlideIdx + 1)) - 1;
          if (!bySlide[idx]) bySlide[idx] = [];
          bySlide[idx].push(s);
        }
        for (const [idxStr, suggestions] of Object.entries(bySlide)) {
          await applyToSlide(Number(idxStr), suggestions);
        }
      }

      // ── Step 5: Build new slides from image plan ──────────────────────────
      if (data.slidePlan && data.slidePlan.length > 0) {
        setStatusMsg(`Building ${data.slidePlan.length} slides...`);
        await buildSlidesFromPlan(data.slidePlan, images);
      }

    } catch (err: any) {
      setError(err.message || "Failed to process request.");
    } finally {
      setIsProcessing(false);
      setStatusMsg("");
    }
  };

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
      <div className="px-4 py-3 border-b border-slate-100 bg-white sticky top-0 z-10 transition-all hover:bg-slate-50/30">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-[#2162F9] to-[#43EB7C] rounded-lg flex items-center justify-center shadow-sm shadow-blue-500/20">
              <Sparkles size={12} className="text-white" />
            </div>
            <span className="text-xs font-black uppercase tracking-widest text-slate-800">Tarkie AI</span>
          </div>
          <div className="px-2 py-1 bg-blue-50/50 rounded-full flex items-center gap-1.5">
             <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
             <p className="text-[8px] text-[#2162F9] font-black uppercase tracking-tighter">
              Claude Sonnet 4.5
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <select 
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
            className="w-full bg-slate-100/80 border-none rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#2162F9]/20 transition-all cursor-pointer shadow-inner"
          >
            <option value="">General Intelligence (Independent)</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.companyName}</option>
            ))}
          </select>

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

          <div className="flex items-center justify-between px-1">
             <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="applyAll"
                  checked={applyToAll}
                  onChange={(e) => setApplyToAll(e.target.checked)}
                  className="w-3.5 h-3.5 rounded-md accent-[#2162F9] cursor-pointer"
                />
                <label htmlFor="applyAll" className="text-[9px] font-black text-slate-400 uppercase tracking-widest cursor-pointer hover:text-slate-600 transition-colors">
                  Apply to all slides
                </label>
             </div>

             <button
              onClick={handleScanDeck}
              disabled={isProcessing}
              className="text-[9px] font-black text-[#2162F9] uppercase tracking-widest flex items-center gap-1 hover:underline disabled:opacity-30 disabled:no-underline"
             >
               <RefreshCw size={10} className={isProcessing && statusMsg.includes("Scan") ? "animate-spin" : ""} />
               Scan Presentation
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
              "Scan the presentation and tell me what's missing for Sol Manpower."
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
            <div className={`max-w-[92%] p-3 shadow-sm text-[11px] font-medium leading-relaxed ${
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
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 animate-shake">
            <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] font-black text-red-600 leading-normal uppercase tracking-tighter">{error}</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Chat Input ───────────────────────────────────────────── */}
      <div className="p-4 bg-white border-t border-slate-100 shadow-[0_-10px_40px_rgba(0,0,0,0.03)]">

        {/* Image thumbnails */}
        {attachedImages.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {attachedImages.map((img, i) => (
              <div key={i} className="relative group">
                <img src={img.preview} alt={img.name} className="w-14 h-14 object-cover rounded-xl border border-slate-200" />
                <button
                  type="button"
                  onClick={() => setAttachedImages(prev => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={8} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={processChat} className="relative">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder={attachedImages.length > 0 ? "Describe what to do with these images..." : "Type instructions or paste a screenshot..."}
            className="w-full bg-slate-100 border-none rounded-2xl pl-4 pr-20 py-4 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#2162F9]/20 transition-all placeholder:text-slate-400"
          />
          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute right-14 top-1/2 -translate-y-1/2 w-9 h-9 text-slate-400 hover:text-[#2162F9] flex items-center justify-center transition-colors"
            title="Attach image"
          >
            <Paperclip size={16} />
          </button>
          <button
            type="submit"
            disabled={isProcessing || (!chatInput.trim() && attachedImages.length === 0)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 bg-gradient-to-br from-[#2162F9] to-[#3a79ff] text-white rounded-xl flex items-center justify-center hover:shadow-lg hover:shadow-blue-500/30 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none transition-all active:scale-95"
          >
            <Send size={18} />
          </button>
        </form>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="flex items-center justify-center gap-4 mt-3">
          <p className="text-[8px] text-slate-300 font-black uppercase tracking-[0.2em]">
            Tarkie OS Ecosystem · Paste screenshots with Ctrl+V
          </p>
        </div>
      </div>
      
      <style jsx global>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.2s ease-in-out 0s 2; }
        .styled-scroll::-webkit-scrollbar { width: 5px; }
        .styled-scroll::-webkit-scrollbar-track { background: transparent; }
        .styled-scroll::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 20px; }
        .styled-scroll::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}</style>
    </div>
  );
}
