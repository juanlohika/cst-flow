"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { 
  Sparkles, 
  Send, 
  Loader2, 
  AlertCircle,
  FileText
} from "lucide-react";

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

  /** Scrapes all text from the current active slide */
  const getActiveSlideContent = async () => {
    return await window.PowerPoint.run(async (context: any) => {
      const selectedSlides = context.presentation.getSelectedSlides();
      selectedSlides.load("items");
      await context.sync();

      if (selectedSlides.items.length === 0) return [];

      const shapes = activeSlide.shapes;
      shapes.load("items/textFrame/hasText, items/textFrame/textRange/text");
      await context.sync();

      const textBlocks: string[] = [];
      for (const shape of shapes.items) {
        if (shape.textFrame && shape.textFrame.hasText) {
          textBlocks.push(shape.textFrame.textRange.text);
        }
      }
      return textBlocks;
    });
  };

  /** Applies string-level replacements suggested by the AI */
  const applySlideUpdates = async (suggestions: { original: string; replacement: string }[]) => {
    if (!suggestions || suggestions.length === 0) return;

    await window.PowerPoint.run(async (context: any) => {
      const selectedSlides = context.presentation.getSelectedSlides();
      selectedSlides.load("items");
      await context.sync();

      const activeSlide = selectedSlides.items[0];
      const shapes = activeSlide.shapes;
      shapes.load("items/textFrame/hasText, items/textFrame/textRange");
      await context.sync();

      for (const shape of shapes.items) {
        if (shape.textFrame && shape.textFrame.hasText) {
          let currentText = shape.textFrame.textRange.text;
          let updated = false;

          for (const s of suggestions) {
            if (currentText.includes(s.original)) {
              currentText = currentText.replace(s.original, s.replacement);
              updated = true;
            }
          }

          if (updated) {
            shape.textFrame.textRange.text = currentText;
          }
        }
      }
      await context.sync();
    });
  };

  const processChat = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isProcessing) return;

    const userMsg = chatInput;
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setChatInput("");
    setIsProcessing(true);
    setStatusMsg("Analyzing slide context...");
    setError(null);

    try {
      // 1. Get Slides count or current slide
      await window.PowerPoint.run(async (context: any) => {
        const presentation = context.presentation;
        const slides = presentation.slides;
        slides.load("items");
        await context.sync();

        const slideIndices = applyToAll 
          ? Array.from({ length: slides.items.length }, (_, i) => i) 
          : [0]; // 0 here is a placeholder for "current", but we use selectedSlides below

        for (let i = 0; i < slideIndices.length; i++) {
          if (applyToAll) setStatusMsg(`Processing slide ${i + 1} of ${slides.items.length}...`);
          else setStatusMsg("Analyzing current slide...");

          // Get content for specific slide index if looping, else current
          let slideContent: string[] = [];
          if (applyToAll) {
            const slide = slides.items[i];
            const shapes = slide.shapes;
            shapes.load("items/textFrame/hasText, items/textFrame/textRange/text");
            await context.sync();

            slideContent = shapes.items
              .filter((s: any) => s.textFrame && s.textFrame.hasText)
              .map((s: any) => s.textFrame.textRange.text);
          } else {
            slideContent = await getActiveSlideContent();
          }

          if (slideContent.length === 0) continue;

          // Call AI
          const res = await fetch("/api/addin/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: userMsg,
              clientId: selectedClient,
              slideContent,
              applyToAll
            })
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Generation error");

          // Apply Updates to this slide
          if (data.suggestions && data.suggestions.length > 0) {
            if (applyToAll) {
              const slide = slides.items[i];
              const shapes = slide.shapes;
              shapes.load("items/textFrame/hasText, items/textFrame/textRange");
              await context.sync();

              for (const shape of shapes.items) {
                if (shape.textFrame && shape.textFrame.hasText) {
                  let currentText = shape.textFrame.textRange.text;
                  let updated = false;
                  for (const s of data.suggestions) {
                    if (currentText.includes(s.original)) {
                      currentText = currentText.replace(s.original, s.replacement);
                      updated = true;
                    }
                  }
                  if (updated) shape.textFrame.textRange.text = currentText;
                }
              }
              await context.sync();
            } else {
              await applySlideUpdates(data.suggestions);
            }
          }
        }

        setMessages(prev => [...prev, { 
          role: "ai", 
          text: applyToAll 
            ? `I've processed all slides and applied intelligence where applicable.`
            : `I've updated the current slide based on your instructions and client intelligence.` 
        }]);
      });

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
      <div className="px-4 py-3 border-b border-slate-100 bg-white sticky top-0 z-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-[#2162F9] to-[#43EB7C] rounded-lg flex items-center justify-center">
              <Sparkles size={12} className="text-white" />
            </div>
            <span className="text-xs font-black uppercase tracking-widest text-slate-800">Tarkie AI</span>
          </div>
          <div className="px-2 py-1 bg-blue-50 rounded-full">
             <p className="text-[9px] text-[#2162F9] font-black uppercase tracking-tighter">
              Claude 3.5 Sonnet
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <select 
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
            className="w-full bg-slate-100 border-none rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#2162F9]/20 transition-all cursor-pointer"
          >
            <option value="">General Intelligence (Independent)</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.companyName}</option>
            ))}
          </select>

          <div className="flex items-center gap-2 px-1">
            <input 
              type="checkbox" 
              id="applyAll" 
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="w-3 h-3 rounded accent-[#2162F9]"
            />
            <label htmlFor="applyAll" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest cursor-pointer">
              Apply to all slides
            </label>
          </div>
        </div>
      </div>

      {/* ── Chat Messages ────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-4 space-y-4 styled-scroll">
        {messages.length === 0 && (
          <div className="text-center py-12 px-6">
            <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="text-slate-300" size={20} />
            </div>
            <p className="text-xs font-bold text-slate-400 leading-relaxed italic">
              "Update this slide with the client's account management team from intelligence."
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[90%] p-3 rounded-2xl text-[11px] font-medium leading-relaxed ${
              m.role === "user" 
                ? "bg-[#2162F9] text-white rounded-tr-sm" 
                : "bg-slate-100 text-slate-700 rounded-tl-sm"
            }`}>
              {m.text}
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="flex justify-start">
            <div className="bg-slate-50 p-3 rounded-2xl rounded-tl-sm flex items-center gap-2 text-[10px] font-bold text-slate-400">
              <Loader2 size={12} className="animate-spin text-[#2162F9]" />
              {statusMsg}
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2">
            <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] font-bold text-red-600 leading-normal">{error}</p>
          </div>
        )}
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
            className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-[#2162F9] text-white rounded-xl flex items-center justify-center hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400 transition-all"
          >
            <Send size={16} />
          </button>
        </form>
        <p className="text-[9px] text-center text-slate-300 mt-3 font-medium uppercase tracking-widest">
          Powered by Tarkie intelligence
        </p>
      </div>
      
      <style jsx global>{`
        .styled-scroll::-webkit-scrollbar { width: 4px; }
        .styled-scroll::-webkit-scrollbar-track { background: transparent; }
        .styled-scroll::-webkit-scrollbar-thumb { background: #F1F5F9; border-radius: 10px; }
        .styled-scroll::-webkit-scrollbar-thumb:hover { background: #E2E8F0; }
      `}</style>
    </div>
  );
}
