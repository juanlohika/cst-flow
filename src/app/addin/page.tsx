"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { PublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser";
import { 
  Sparkles, 
  Send, 
  Loader2, 
  AlertCircle,
  FileText,
  RefreshCw
} from "lucide-react";

/**
 * Tarkie PowerPoint Add-in Sidebar
 * This page loads inside the PowerPoint Task Pane.
 */
// MSAL configuration for Microsoft Graph access
const MSAL_CONFIG = {
  auth: {
    clientId: "d35494c1-a8b2-4877-b6ba-e7e580768b72",
    authority: "https://login.microsoftonline.com/common",
    redirectUri: typeof window !== "undefined" ? window.location.origin + "/addin/auth-complete" : "",
  },
  cache: { cacheLocation: "localStorage", storeAuthStateInCookie: false },
};

const GRAPH_SCOPES = ["Files.ReadWrite", "openid", "profile"];

let msalInstance: PublicClientApplication | null = null;

async function getMsalInstance(): Promise<PublicClientApplication> {
  if (!msalInstance) {
    msalInstance = new PublicClientApplication(MSAL_CONFIG);
    await msalInstance.initialize();
  }
  return msalInstance;
}

async function getGraphToken(): Promise<string> {
  const msal = await getMsalInstance();
  const accounts = msal.getAllAccounts();

  if (accounts.length > 0) {
    try {
      const result = await msal.acquireTokenSilent({
        scopes: GRAPH_SCOPES,
        account: accounts[0],
      });
      return result.accessToken;
    } catch (e) {
      if (!(e instanceof InteractionRequiredAuthError)) throw e;
    }
  }

  // Silent failed or no account — show popup
  const result = await msal.acquireTokenPopup({ scopes: GRAPH_SCOPES });
  return result.accessToken;
}

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  /** Returns true if text looks like a footer/copyright — skip these */
  const isFooterText = (t: string) =>
    t.includes("©") || t.includes("All rights reserved") || t.includes("confidential") ||
    (t.length > 120 && !t.includes("\n"));

  /** Read text from a table cell — tries every known PowerPoint Web API path */
  const getTableCellText = async (cell: any, context: any): Promise<string> => {
    // Attempt 1: cell has a direct textFrame (some PPT versions treat table cells like shapes)
    try {
      cell.textFrame.textRange.load("text");
      await context.sync();
      const t = cell.textFrame.textRange.text?.trim();
      if (t !== undefined) { console.log("[Tarkie] cell via textFrame:", JSON.stringify(t)); return t; }
    } catch (e) { console.log("[Tarkie] cell.textFrame failed:", e); }
    // Attempt 2: cell.body.text
    try {
      cell.body.load("text");
      await context.sync();
      const t = cell.body.text?.trim() ?? "";
      console.log("[Tarkie] cell via body.text:", JSON.stringify(t));
      return t;
    } catch (e) { console.log("[Tarkie] cell.body.text failed:", e); }
    // Attempt 3: cell.body.paragraphs
    try {
      cell.body.paragraphs.load("items/text");
      await context.sync();
      const t = cell.body.paragraphs.items.map((p: any) => p.text?.trim()).filter(Boolean).join(" ");
      console.log("[Tarkie] cell via paragraphs:", JSON.stringify(t));
      return t;
    } catch (e) { console.log("[Tarkie] cell.body.paragraphs failed:", e); }
    return "";
  };

  /** Reads all text from a slide's shapes + tables (0-based index) */
  const getSlideText = async (slideIndex: number): Promise<string[]> => {
    return await window.PowerPoint.run(async (context: any) => {
      const slide = context.presentation.slides.getItemAt(slideIndex);
      const shapes = slide.shapes;
      shapes.load("items");
      await context.sync();

      const texts: string[] = [];
      for (const shape of shapes.items) {
        // ── Try table ─────────────────────────────────────────────────────
        let handledAsTable = false;
        try {
          const table = shape.table;
          table.rows.load("items/cells/items");
          await context.sync();
          const tableLines: string[] = [];
          for (const row of table.rows.items) {
            const rowCells: string[] = [];
            for (const cell of row.cells.items) {
              const t = await getTableCellText(cell, context);
              if (t) rowCells.push(t);
            }
            if (rowCells.length) tableLines.push(rowCells.join(" | "));
          }
          if (tableLines.length) {
            // First row = headers; format with column labels for Claude context
            const headers = tableLines[0].split(" | ");
            const colCount = headers.length;
            let tableStr = `[TABLE - ${colCount} columns: ${headers.join(", ")}]\n`;
            tableLines.forEach((line, i) => {
              tableStr += `Row ${i + 1}${i === 0 ? " (header)" : ""}: ${line}\n`;
            });
            texts.push(tableStr.trim());
            handledAsTable = true;
          }
        } catch { /* not a table shape */ }
        if (handledAsTable) continue;

        // ── Try text frame ─────────────────────────────────────────────────
        try {
          shape.textFrame.textRange.load("text");
          await context.sync();
          const t = shape.textFrame.textRange.text?.trim();
          if (t && !isFooterText(t)) texts.push(t);
        } catch { /* not a text shape */ }
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

  /** Extracts the OneDrive file ID from the PowerPoint Online URL */
  const getFileId = (): string | null => {
    try {
      const url = new URL(window.location.href);
      // URL format: ...?docId=XXX&driveId=YYY or embedded in path
      const docId = url.searchParams.get("docId") ||
        url.searchParams.get("id") ||
        window.location.href.match(/[?&](?:docId|id)=([^&]+)/)?.[1];
      return docId ? decodeURIComponent(docId) : null;
    } catch {
      return null;
    }
  };

  /**
   * Applies all suggestions using:
   * 1. Office JS for regular text shapes (fast, works on Web + Desktop)
   * 2. Graph API + OOXML patch via server for table cells (works everywhere)
   */
  const applyToSlide = async (slideIdx: number, suggestions: { original: string; replacement: string }[]) => {
    if (!suggestions || suggestions.length === 0) return;

    // ── Step 1: Try Office JS for regular text shapes ─────────────────────────
    let remaining = [...suggestions];

    await window.PowerPoint.run(async (context: any) => {
      const slide = context.presentation.slides.getItemAt(slideIdx);
      slide.shapes.load("items");
      await context.sync();

      for (const shape of slide.shapes.items) {
        try {
          shape.load("type");
          shape.textFrame.textRange.load("text");
          await context.sync();
          if (String(shape.type).toLowerCase().includes("table")) continue;
          const raw: string = shape.textFrame.textRange.text || "";
          if (!raw || isFooterText(raw)) continue;
          for (const s of remaining) {
            if (raw.includes(s.original)) {
              shape.textFrame.textRange.text = raw.split(s.original).join(s.replacement);
              await context.sync();
              console.log(`[Tarkie] ✓ text shape replaced "${s.original}"`);
              remaining = remaining.filter(x => x !== s);
            }
          }
        } catch { /* not a text shape */ }
      }
    }).catch(() => {});

    if (remaining.length === 0) return;

    // ── Step 2: Graph API + server OOXML patch for table cells ────────────────
    console.log(`[Tarkie] ${remaining.length} suggestions need Graph/OOXML patch`);

    // Get Graph token via MSAL (works with personal Microsoft accounts)
    let graphToken: string;
    try {
      setStatusMsg("Connecting to Microsoft...");
      graphToken = await getGraphToken();
      console.log("[Tarkie] Got Graph token via MSAL");
    } catch (e: any) {
      console.error("[Tarkie] Failed to get Graph token:", e.message);
      setError("Microsoft sign-in required to edit tables. Please try again.");
      return;
    }

    // Extract file ID from URL
    const fileId = getFileId();
    if (!fileId) {
      console.error("[Tarkie] Could not extract file ID from URL:", window.location.href);
      setError("Could not identify the PowerPoint file. Make sure it's saved to OneDrive.");
      return;
    }
    console.log("[Tarkie] File ID:", fileId);

    // Call server to patch the slide XML
    const res = await fetch("/api/addin/patch-slide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        graphToken,
        fileId,
        slideIndex: slideIdx + 1, // convert to 1-based
        suggestions: remaining,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.base64) {
      console.error("[Tarkie] patch-slide failed:", data.error);
      setError(`Table update failed: ${data.error}`);
      return;
    }

    console.log(`[Tarkie] Server patched ${data.replaced} replacements. Inserting slide...`);

    // Insert the patched slide and replace the original
    await window.PowerPoint.run(async (context: any) => {
      const slides = context.presentation.slides;
      slides.load("items");
      await context.sync();

      const targetSlide = slides.items[slideIdx];
      targetSlide.load("id");
      await context.sync();
      const targetId = targetSlide.id;

      // Insert patched slide after the target
      context.presentation.insertSlidesFromBase64(data.base64, {
        formatting: "UseDestinationTheme",
        targetSlideId: targetId,
      });
      await context.sync();

      // The new slide was inserted after targetId — find and delete the original
      slides.load("items");
      await context.sync();

      // Delete the original (now at slideIdx, since new one inserted after)
      const originalSlide = slides.items[slideIdx];
      originalSlide.delete();
      await context.sync();

      console.log(`[Tarkie] ✓ Slide ${slideIdx + 1} replaced with patched version`);
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

  const processChat = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isProcessing) return;

    const userMsg = chatInput;
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setChatInput("");
    setIsProcessing(true);
    setStatusMsg(applyToAll ? "Reading all slides..." : "Reading current slide...");
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
        activeSlideIndex: activeSlideIdx + 1, // 1-based for AI
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

        // Group suggestions by slideIndex — default to active slide if AI omits it
        const bySlide: Record<number, { original: string; replacement: string }[]> = {};
        for (const s of data.suggestions) {
          const idx = (s.slideIndex ?? (activeSlideIdx + 1)) - 1; // convert to 0-based
          if (!bySlide[idx]) bySlide[idx] = [];
          bySlide[idx].push(s);
        }

        for (const [idxStr, suggestions] of Object.entries(bySlide)) {
          await applyToSlide(Number(idxStr), suggestions);
        }
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
        <form onSubmit={processChat} className="relative">
          <input 
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Type instructions..."
            className="w-full bg-slate-100 border-none rounded-2xl pl-4 pr-12 py-4 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#2162F9]/20 transition-all placeholder:text-slate-400"
          />
          <button 
            type="submit"
            disabled={isProcessing || !chatInput.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 bg-gradient-to-br from-[#2162F9] to-[#3a79ff] text-white rounded-xl flex items-center justify-center hover:shadow-lg hover:shadow-blue-500/30 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none transition-all active:scale-95"
          >
            <Send size={18} />
          </button>
        </form>
        <div className="flex items-center justify-center gap-4 mt-4">
           <p className="text-[8px] text-slate-300 font-black uppercase tracking-[0.2em]">
            Tarkie OS Ecosystem
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
