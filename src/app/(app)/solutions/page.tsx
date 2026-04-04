import React from "react";
import { Workflow, ClipboardList, Clock, Sparkles, Database, ShieldCheck } from "lucide-react";
import Link from "next/link";

export default function SolutionsPage() {
  return (
    <div className="container py-16 space-y-24">
      {/* Hero / System Overview */}
      <section className="text-center space-y-6 max-w-3xl mx-auto">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl text-slate-900">
          The Future of <br />
          <span className="text-primary">Business Operations</span>
        </h1>
        <p className="text-lg text-slate-600 leading-relaxed">
          CST FlowDesk is a unified AI ecosystem designed to accelerate the digital transformation of Tarkie implementations. From process mapping to roadmap delivery, we automate the boring and empower the strategic.
        </p>
        <div className="pt-4">
          <Link href="/">
            <button className="bg-primary text-primary-foreground px-8 py-4 rounded-2xl font-bold text-lg hover:scale-105 transition-transform shadow-xl">
              Get Started for Free
            </button>
          </Link>
        </div>
      </section>

      {/* Core Ecosystem */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white border text-card-foreground p-8 rounded-3xl shadow-sm space-y-4 hover:shadow-md transition-shadow">
          <div className="h-14 w-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center">
            <Workflow className="h-8 w-8" />
          </div>
          <h3 className="text-2xl font-bold">Workflow Architect</h3>
          <p className="text-slate-500 text-sm leading-relaxed">
            The AI engine that understands complex organizational roles and converts natural language or dictation into professional, color-coded swimlane diagrams instantly.
          </p>
          <ul className="space-y-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <li>• Smart Edge Routing</li>
            <li>• Multi-Role Lanes</li>
            <li>• Auto-Overlap Correction</li>
          </ul>
        </div>

        <div className="bg-white border text-card-foreground p-8 rounded-3xl shadow-sm space-y-4 hover:shadow-md transition-shadow">
          <div className="h-14 w-14 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center">
            <ClipboardList className="h-8 w-8" />
          </div>
          <h3 className="text-2xl font-bold">BRD Maker</h3>
          <p className="text-slate-500 text-sm leading-relaxed">
            Automatically transform your workflows into a 15-page Business Requirements Document. It generates context, stakeholder roles, and technical dependencies in seconds.
          </p>
          <ul className="space-y-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <li>• Markdown Format</li>
            <li>• Technical Scope</li>
            <li>• Executive Summary</li>
          </ul>
        </div>

        <div className="bg-white border text-card-foreground p-8 rounded-3xl shadow-sm space-y-4 hover:shadow-md transition-shadow">
          <div className="h-14 w-14 bg-violet-100 text-violet-600 rounded-2xl flex items-center justify-center">
            <Clock className="h-8 w-8" />
          </div>
          <h3 className="text-2xl font-bold">Timeline Maker</h3>
          <p className="text-slate-500 text-sm leading-relaxed">
            The final step of the implementation. It creates a chronological milestone roadmap with owners and durations, ready for project management handoff.
          </p>
          <ul className="space-y-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <li>• Vertical Gantt UI</li>
            <li>• CSV Data Export</li>
            <li>• Auto-Phase Detection</li>
          </ul>
        </div>
      </section>

      {/* How to Use */}
      <section className="bg-slate-900 text-white rounded-[3rem] p-12 md:p-20 relative overflow-hidden">
        <Sparkles className="absolute top-10 right-10 h-32 w-32 text-white/5" />
        <div className="max-w-4xl space-y-12 relative z-10">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">How to use FlowDesk</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="flex gap-6">
              <div className="h-12 w-12 rounded-full border border-white/20 flex items-center justify-center font-bold text-xl shrink-0">1</div>
              <div className="space-y-2">
                <h4 className="text-xl font-bold">Secure Access</h4>
                <p className="text-slate-400 text-sm">Sign in with your @tarkie.com or @mobileoptima.com Google account to activate your cloud-backed workspace.</p>
              </div>
            </div>

            <div className="flex gap-6">
              <div className="h-12 w-12 rounded-full border border-white/20 flex items-center justify-center font-bold text-xl shrink-0">2</div>
              <div className="space-y-2">
                <h4 className="text-xl font-bold">Contextual AI Chat</h4>
                <p className="text-slate-400 text-sm">Dictate or type your business process in the sidebar. The AI maintains history so you can refine your diagram iteratively.</p>
              </div>
            </div>

            <div className="flex gap-6">
              <div className="h-12 w-12 rounded-full border border-white/20 flex items-center justify-center font-bold text-xl shrink-0">3</div>
              <div className="space-y-2">
                <h4 className="text-xl font-bold">Refine & Edit</h4>
                <p className="text-slate-400 text-sm">Manually drag nodes, edit labels directly on the canvas, or delete faulty connections to perfect your logic.</p>
              </div>
            </div>

            <div className="flex gap-6">
              <div className="h-12 w-12 rounded-full border border-white/20 flex items-center justify-center font-bold text-xl shrink-0">4</div>
              <div className="space-y-2">
                <h4 className="text-xl font-bold">Cloud Presence</h4>
                <p className="text-slate-400 text-sm">Save your work to the cloud. Access it later from the Explorer page or share the output via PNG, Markdown, or CSV.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Platform Security */}
      <section className="flex flex-col md:flex-row items-center gap-12 border-t pt-24">
        <div className="flex-1 space-y-6">
          <div className="flex items-center gap-2 text-primary font-bold tracking-widest uppercase text-xs">
            <ShieldCheck className="h-4 w-4" /> Enterprise Security
          </div>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">How to use CST OS</h2>
          <div className="max-w-2xl text-[15px] leading-relaxed text-slate-300 space-y-4">
            <p>
              CST OS is designed as a BYOK (Bring Your Own Key) system. Your Gemini API key stays encrypted in your browser&apos;s LocalStorage, while your generated workflows are securely stored on our backend for collaboration.
            </p>
          </div>
          <div className="flex gap-8">
            <div className="space-y-1">
              <h5 className="font-bold text-lg">SQLite</h5>
              <p className="text-xs text-slate-400">Stable Local Database</p>
            </div>
            <div className="space-y-1">
              <h5 className="font-bold text-lg">Prisma</h5>
              <p className="text-xs text-slate-400">Modern Type-Safe ORM</p>
            </div>
            <div className="space-y-1">
              <h5 className="font-bold text-lg">Google Auth</h5>
              <p className="text-xs text-slate-400">Strict Domain Locking</p>
            </div>
          </div>
        </div>
        <div className="flex-1 w-full bg-slate-50 rounded-3xl p-8 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center min-h-[300px] text-center space-y-4">
          <Database className="h-16 w-16 text-slate-300" />
          <h4 className="font-bold text-slate-700">Database Optimized</h4>
          <p className="text-sm text-slate-400 max-w-sm">Every flowchart, document, and timeline is indexed for fast retrieval and future cross-app correlation.</p>
        </div>
      </section>
    </div>
  );
}
