"use client";

import React, { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { 
  Sparkles, 
  Users, 
  FileText, 
  Send, 
  Loader2, 
  AlertCircle,
  CheckCircle2,
  RefreshCcw
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
  const [deckType, setDeckType] = useState("kickoff");
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState<string | null>(null);

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
      document.head.removeChild(script);
    };
  }, []);

  // 2. Fetch clients
  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/addin/client-data")
        .then(res => res.json())
        .then(data => setClients(data))
        .catch(err => console.error("Failed to load clients", err));
    }
  }, [status]);

  const handleLogin = () => {
    // Office Task Panes run inside iframes — Google OAuth blocks redirects in iframes.
    // We must open a popup window for auth, then detect when the user is logged in.
    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    
    const popup = window.open(
      "/auth/signin?callbackUrl=/addin/auth-complete",
      "tarkie-auth",
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
    );

    // Poll for session changes after popup opens
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/auth/session");
        const session = await res.json();
        if (session?.user) {
          clearInterval(interval);
          if (popup && !popup.closed) popup.close();
          window.location.reload();
        }
      } catch (e) {
        // ignore fetch errors
      }
    }, 1500);

    // Stop polling after 2 minutes
    setTimeout(() => clearInterval(interval), 120000);
  };

  const generateFullDeck = async () => {
    if (!selectedClient) return;
    setIsGenerating(true);
    setStatusMsg("Building prompt strategy...");
    setError(null);

    try {
      // Logic for generating full deck will go here
      // For now, testing the Office JS bridge
      await window.PowerPoint.run(async (context: any) => {
        const slide = context.presentation.slides.getItemAt(0);
        slide.load("shapes");
        await context.sync();
        
        setStatusMsg("Writing content to PowerPoint...");
        // Placeholder for real extraction & write
        setTimeout(() => {
          setIsGenerating(false);
          setStatusMsg("Success! Deck populated.");
        }, 2000);
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate deck.");
      setIsGenerating(false);
    }
  };

  if (status === "loading" || !officeInitialized) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 p-6 text-center">
        <Loader2 className="w-8 h-8 text-[#2162F9] animate-spin mb-4" />
        <p className="text-sm font-bold text-slate-600">Initializing Tarkie Bridge...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-white p-6 text-center">
        <div className="w-16 h-16 bg-[#2162F9]/10 rounded-full flex items-center justify-center mb-6">
          <Users className="w-8 h-8 text-[#2162F9]" />
        </div>
        <h1 className="text-xl font-black text-slate-800 mb-2 uppercase tracking-tight">CST FlowDesk</h1>
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
      {/* Header */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 bg-gradient-to-br from-[#2162F9] to-[#43EB7C] rounded-lg flex items-center justify-center">
            <Sparkles size={12} className="text-white" />
          </div>
          <span className="text-xs font-black uppercase tracking-widest text-slate-800">Tarkie Generator</span>
        </div>
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter opacity-70">
          Connected to: {session?.user?.email}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6 styled-scroll">
        {/* Step 1: Client Selection */}
        <section className="space-y-3">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">1. Select Client</label>
          <select 
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-[#2162F9] transition-colors appearance-none"
          >
            <option value="">-- Choose Account --</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.companyName}</option>
            ))}
          </select>
        </section>

        {/* Step 2: Deck Type */}
        <section className="space-y-3">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">2. Deck Strategy</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: "kickoff", name: "Kickoff", icon: FileText },
              { id: "training", name: "Training", icon: Users },
              { id: "review", name: "QBR", icon: RefreshCcw },
              { id: "custom", name: "Custom", icon: Sparkles },
            ].map(type => (
              <button
                key={type.id}
                onClick={() => setDeckType(type.id)}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
                  deckType === type.id 
                    ? "bg-[#2162F9]/5 border-[#2162F9] text-[#2162F9]" 
                    : "bg-white border-slate-100 text-slate-400 hover:bg-slate-50"
                }`}
              >
                <type.icon size={16} />
                <span className="text-[10px] font-black uppercase tracking-tight">{type.name}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Generate Button */}
        <div className="pt-4">
          <button 
            onClick={generateFullDeck}
            disabled={isGenerating || !selectedClient}
            className={`w-full py-4 rounded-2xl flex items-center justify-center gap-2 text-white font-black text-xs uppercase tracking-widest transition-all ${
              isGenerating || !selectedClient
                ? "bg-slate-100 text-slate-300 cursor-not-allowed"
                : "bg-gradient-to-r from-[#2162F9] to-[#43EB7C] shadow-lg shadow-blue-500/20 active:scale-95"
            }`}
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {statusMsg || "Generating..."}
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Generate Full Deck
              </>
            )}
          </button>
          
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2">
              <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] font-bold text-red-600 leading-normal">{error}</p>
            </div>
          )}
          
          {statusMsg && !isGenerating && !error && (
            <div className="mt-4 p-3 bg-green-50 border border-green-100 rounded-xl flex items-start gap-2">
              <CheckCircle2 size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] font-bold text-green-600 leading-normal">{statusMsg}</p>
            </div>
          )}
        </div>
      </div>

      {/* Slide Chat Footer */}
      <div className="p-4 border-t border-slate-100 bg-white shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
        <label className="text-[9px] font-black text-slate-300 uppercase tracking-widest block mb-2">Refine with AI</label>
        <div className="relative">
          <input 
            type="text"
            placeholder="e.g. Update team from Intel..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-10 py-3 text-xs font-bold text-slate-700 outline-none focus:border-[#2162F9] transition-colors"
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#2162F9] text-white rounded-lg flex items-center justify-center hover:bg-blue-600 transition-colors">
            <Send size={14} />
          </button>
        </div>
      </div>
      
      <style jsx global>{`
        .styled-scroll::-webkit-scrollbar { width: 4px; }
        .styled-scroll::-webkit-scrollbar-track { background: transparent; }
        .styled-scroll::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 10px; }
        .styled-scroll::-webkit-scrollbar-thumb:hover { background: #CBD5E1; }
      `}</style>
    </div>
  );
}
