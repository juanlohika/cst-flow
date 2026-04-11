"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import AuthGuard from "@/components/auth/AuthGuard";
import { Loader2, Upload, Sparkles, CheckCircle2, ChevronLeft, FileCode, Check } from "lucide-react";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";
import Link from "next/link";

export default function PremiumBuilderPage() {
  return (
    <AuthGuard>
      <PremiumBuilderContent />
    </AuthGuard>
  );
}

function PremiumBuilderContent() {
  const { data: session } = useSession();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "generating" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  useBreadcrumbs([
    { label: "Presentations", href: "/presentations" },
    { label: "Premium Branded Builder" }
  ]);

  useEffect(() => {
    fetch("/api/addin/client-data")
      .then(res => res.json())
      .then(data => setAccounts(data || []))
      .catch(err => console.error("Load accounts error:", err));
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const generatePresentation = async () => {
    if (!file || !selectedAccount) return;

    setStatus("generating");
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clientId", selectedAccount);

      const res = await fetch("/api/presentation/generate", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Generation failed");
      }

      // Convert response to blob
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      setDownloadUrl(url);
      setStatus("success");
    } catch (err: any) {
      console.error(err);
      setError(err.message);
      setStatus("error");
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50 p-8 flex flex-col items-center">
      <div className="w-full max-w-3xl">
        <Link 
          href="/presentations" 
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors mb-6 text-sm font-bold"
        >
          <ChevronLeft size={16} /> Back to Presentations
        </Link>

        <div className="bg-white border border-slate-200 rounded-3xl p-10 shadow-xl shadow-slate-200/50">
          <div className="flex items-center gap-4 mb-10">
            <div className="bg-[#2162F9] text-white p-4 rounded-2xl shadow-lg ring-4 ring-[#2162F9]/10">
              <Sparkles size={24} />
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">Premium Branded Builder</h1>
              <p className="text-slate-500 font-medium">Inject Tarkie Intelligence directly into your professional .pptx templates.</p>
            </div>
          </div>

          <div className="space-y-8">
            {/* Step 1: Account Selection */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-[#2162F9] mb-3 block">
                1. Select Client Intelligence
              </label>
              <select
                value={selectedAccount}
                onChange={(e) => setSelectedAccount(e.target.value)}
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 font-bold focus:ring-4 focus:ring-[#2162F9]/10 focus:border-[#2162F9] outline-none transition-all appearance-none cursor-pointer"
              >
                <option value="">Choose an account...</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.companyName} — {acc.industry}
                  </option>
                ))}
              </select>
            </div>

            {/* Step 2: File Upload */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-[#2162F9] mb-3 block">
                2. Upload Branded Template (.pptx)
              </label>
              <div 
                className={`relative border-2 border-dashed rounded-3xl p-12 transition-all group flex flex-col items-center justify-center cursor-pointer ${
                  file ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 hover:border-[#2162F9] hover:bg-[#2162F9]/5"
                }`}
              >
                <input
                  type="file"
                  accept=".pptx"
                  onChange={handleFileChange}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                
                {file ? (
                  <>
                    <div className="bg-emerald-500 text-white p-4 rounded-2xl mb-4 shadow-lg">
                      <FileCode size={32} />
                    </div>
                    <p className="text-emerald-700 font-bold">{file.name}</p>
                    <p className="text-emerald-500 text-xs mt-1">Ready for injection</p>
                  </>
                ) : (
                  <>
                    <Upload size={40} className="text-slate-300 mb-4 group-hover:text-[#2162F9] group-hover:scale-110 transition-all" />
                    <p className="text-slate-500 font-bold">Drag & Drop your template here</p>
                    <p className="text-slate-400 text-xs mt-1 underline">or click to browse files</p>
                  </>
                )}
              </div>
            </div>

            {/* Action Button */}
            <div className="pt-6">
              {status === "success" ? (
                <div className="bg-emerald-50 border border-emerald-100 p-8 rounded-3xl animate-in fade-in zoom-in slide-in-from-bottom-4 duration-500">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="bg-emerald-500 text-white p-3 rounded-full">
                      <CheckCircle2 size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-emerald-900 leading-none">Generation Complete!</h3>
                      <p className="text-emerald-600 text-sm mt-1">Your branded presentation is ready for delivery.</p>
                    </div>
                  </div>
                  <a
                    href={downloadUrl}
                    download={`Tarkie_Presentation_${accounts.find(a => a.id === selectedAccount)?.companyName || "Deck"}.pptx`}
                    className="w-full flex items-center justify-center gap-3 bg-emerald-600 text-white px-8 py-5 rounded-2xl font-black text-lg hover:bg-emerald-700 shadow-xl shadow-emerald-200 transition-all group"
                  >
                    Download Branded PowerPoint
                    <Check className="group-hover:translate-x-1 transition-transform" />
                  </a>
                  <button 
                    onClick={() => { setStatus("idle"); setFile(null); setDownloadUrl(""); }}
                    className="w-full mt-4 text-emerald-600 text-sm font-bold opacity-60 hover:opacity-100 transition-opacity"
                  >
                    Start another generation
                  </button>
                </div>
              ) : (
                <button
                  disabled={!file || !selectedAccount || status === "generating"}
                  onClick={generatePresentation}
                  className="w-full flex items-center justify-center gap-4 bg-[#2162F9] text-white px-10 py-6 rounded-2xl font-black text-xl hover:shadow-2xl hover:shadow-[#2162F9]/40 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-30 disabled:hover:scale-100 shadow-xl shadow-[#2162F9]/20"
                >
                  {status === "generating" ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Injected AI Intelligence...
                    </>
                  ) : (
                    <>
                      <Sparkles size={24} />
                      Generate Premium Presentation
                    </>
                  )}
                </button>
              )}

              {status === "error" && (
                <p className="text-red-500 text-sm font-bold text-center mt-4 bg-red-50 p-4 rounded-xl border border-red-100 italic">
                  ⚠ Error: {error}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-8 flex gap-6">
          <div className="bg-blue-50/50 p-6 rounded-3xl border border-blue-100 flex-1">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-[#2162F9] mb-2">How it works</h4>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              We use <strong className="text-slate-700">Native XML Injection</strong> to map Tarkie data into your template placeholders. Your slide designs, master layouts, and animations remain untouched.
            </p>
          </div>
          <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 flex-1">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Placeholder Guide</h4>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">
              Ensure your template has tags like <code className="text-[#2162F9]/70 bg-white px-1 py-0.5 rounded">{"{client_name}"}</code> or <code className="text-[#2162F9]/70 bg-white px-1 py-0.5 rounded">{"{industry}"}</code> in the text boxes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
