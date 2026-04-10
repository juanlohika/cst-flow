"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import AuthGuard from "@/components/auth/AuthGuard";
import {
  Loader2, ChevronLeft, ChevronRight, Play, Download, Plus, Trash2, Copy, GripVertical,
  Lock, Unlock, Sparkles, RotateCcw, Maximize2, Settings, Eye, ZoomIn, ZoomOut, CheckSquare
} from "lucide-react";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

// ── Design tokens from the Tarkie Standard design skill ──────────────────
const DESIGN = {
  primary: "#2162F9",
  primaryDark: "#2C448A",
  accentGreen: "#43EB7C",
  white: "#FFFFFF",
  black: "#000000",
  surfaceBlue: "#DCEAF7",
};

const LAYOUT_BG: Record<string, { bg: string; text: string }> = {
  "full-bleed-dark": { bg: DESIGN.primary, text: DESIGN.white },
  "content-light": { bg: DESIGN.white, text: DESIGN.black },
  "content-dark": { bg: DESIGN.primaryDark, text: DESIGN.white },
  "two-column": { bg: DESIGN.white, text: DESIGN.black },
  "table-full": { bg: DESIGN.white, text: DESIGN.black },
};

export default function PresentationBuilderPage() {
  return (
    <AuthGuard>
      <BuilderContent />
    </AuthGuard>
  );
}

function BuilderContent() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const presId = params.id as string;

  const [presentation, setPresentation] = useState<any>(null);
  const [slides, setSlides] = useState<any[]>([]);
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [isPresenting, setIsPresenting] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.75);
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [autoBuildProgress, setAutoBuildProgress] = useState({ current: 0, total: 0 });

  useBreadcrumbs([
    { label: "Presentations", href: "/presentations" },
    { label: presentation?.name || "Loading..." },
  ]);

  // ── Load presentation ──────────────────────────────────────────
  useEffect(() => {
    loadPresentation();
  }, [presId]);

  const loadPresentation = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/presentations/${presId}`);
      if (res.ok) {
        const data = await res.json();
        setPresentation(data);
        setSlides(data.slides || []);
      }
    } catch (err) {
      console.error("Failed to load presentation:", err);
    } finally {
      setLoading(false);
    }
  };

  // ── Save block content ──────────────────────────────────────────
  const saveBlockContent = useCallback(async (blockId: string, content: any) => {
    setSaving(true);
    try {
      await fetch(`/api/presentations/${presId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId, content: typeof content === "string" ? content : JSON.stringify(content) }),
      });
      // Update local state
      setSlides((prev: any[]) => prev.map(s => ({
        ...s,
        blocks: s.blocks?.map((b: any) =>
          b.id === blockId ? { ...b, content: typeof content === "string" ? content : JSON.stringify(content) } : b
        ),
      })));
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  }, [presId]);

  // ── AI Generate block ──────────────────────────────────────────
  const generateBlock = useCallback(async (block: any, attachedImages: string[] = []) => {
    if (!block.prompt && !block.intelligenceMapping && attachedImages.length === 0) return;
    setGenerating(block.id);
    try {
      const res = await fetch("/api/presentations/generate-block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockType: block.blockType,
          prompt: block.prompt || `Generate content for ${block.blockType} block`,
          images: attachedImages,
          accountIntelligence: presentation?.intelligenceSnapshot || "",
          designSkill: presentation?.designSnapshot || "",
          slideBackground: slides[currentSlideIdx]?.layout?.includes("dark") ? "dark" : "light",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        let finalContent = data.content;
        try {
          const parsed = typeof data.content === "string" ? JSON.parse(data.content) : data.content;
          if (attachedImages.length > 0) {
            parsed.images = attachedImages; // Append Local base64 images directly to block JSON
          }
          finalContent = JSON.stringify(parsed);
        } catch (e) {
          console.warn("Could not inject images to raw text content");
        }
        await saveBlockContent(block.id, finalContent);
      }
    } catch (err) {
      console.error("Generate failed:", err);
    } finally {
      setGenerating(null);
    }
  }, [presId, presentation, slides, currentSlideIdx, saveBlockContent]);

  // ── Auto-Build Deck — Sequential generation loop ──────────────────
  const autoBuildPresentation = async () => {
    if (isAutoGenerating) return;
    
    // Find all blocks that need generation (have prompt or mapping but no valid content)
    const blocksToGenerate: any[] = [];
    slides.forEach(s => {
      s.blocks?.forEach((b: any) => {
        // We generate if it has a prompt or mapping
        if (b.prompt || b.intelligenceMapping) {
          blocksToGenerate.push({ ...b, slideLayout: s.layout });
        }
      });
    });

    if (blocksToGenerate.length === 0) return;

    setIsAutoGenerating(true);
    setAutoBuildProgress({ current: 0, total: blocksToGenerate.length });

    for (let i = 0; i < blocksToGenerate.length; i++) {
        const block = blocksToGenerate[i];
        setAutoBuildProgress({ current: i + 1, total: blocksToGenerate.length });
        
        try {
            const res = await fetch("/api/presentations/generate-block", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    blockType: block.blockType,
                    prompt: block.prompt || `Generate content based on intelligence for ${block.blockType}`,
                    accountIntelligence: presentation?.intelligenceSnapshot || "",
                    designSkill: presentation?.designSnapshot || "",
                    slideBackground: block.slideLayout?.includes("dark") ? "dark" : "light",
                }),
            });
            if (res.ok) {
                const data = await res.json();
                await saveBlockContent(block.id, data.content);
            }
        } catch (err) {
            console.error(`Auto-build failed for block ${block.id}:`, err);
        }
        // Small delay between calls to let UI breathe
        await new Promise(r => setTimeout(r, 200));
    }

    setIsAutoGenerating(false);
  };

  // ── Slide Management ──────────────────────────────────────────
  const addNewSlide = async () => {
    setSaving(true);
    const newSlideId = `slide_${Date.now().toString(36)}_${Math.random().toString(36).substring(2,6)}`;
    const newBlockId = `block_${Date.now().toString(36)}_${Math.random().toString(36).substring(2,6)}`;
    
    const newSlide = {
      id: newSlideId,
      presentationId: presId,
      order: slides.length,
      title: "New Slide",
      layout: "content-light",
      blocks: [
        {
          id: newBlockId,
          slideId: newSlideId,
          order: 0,
          blockType: "text",
          prompt: "Write a professional overview for this slide.",
          content: JSON.stringify({ heading: "New Slide Title", body: "Add your content here or use AI to generate it." }),
          isAiGenerated: false
        }
      ],
    };

    try {
      await fetch(`/api/presentations/${presId}/slides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSlide),
      });
      setSlides([...slides, newSlide]);
      setCurrentSlideIdx(slides.length);
    } catch (err) { console.error("Add slide failed", err); }
    setSaving(false);
  };

  const duplicateSlide = async () => {
    if (!slides[currentSlideIdx]) return;
    setSaving(true);
    const current = slides[currentSlideIdx];
    const newSlideId = `slide_${Date.now().toString(36)}_${Math.random().toString(36).substring(2,6)}`;
    const newSlide = {
      ...current,
      id: newSlideId,
      order: current.order + 1,
      title: `${current.title} (Copy)`,
      blocks: current.blocks?.map((b: any) => ({
        ...b,
        id: `block_${Date.now().toString(36)}_${Math.random().toString(36).substring(2,6)}`,
        slideId: newSlideId,
      })) || []
    };
    try {
      await fetch(`/api/presentations/${presId}/slides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSlide),
      });
      const newSlides = [...slides];
      newSlides.splice(currentSlideIdx + 1, 0, newSlide);
      // Re-normalize orders
      newSlides.forEach((s, i) => s.order = i);
      setSlides(newSlides);
      setCurrentSlideIdx(currentSlideIdx + 1);
    } catch (err) { console.error("Duplicate slide failed", err); }
    setSaving(false);
  };

  // ── Keyboard navigation ──────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setCurrentSlideIdx(prev => Math.min(prev + 1, slides.length - 1));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setCurrentSlideIdx(prev => Math.max(prev - 1, 0));
      } else if (e.key === "Escape" && isPresenting) {
        setIsPresenting(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [slides.length, isPresenting]);

  const currentSlide = slides[currentSlideIdx];
  const selectedBlock = currentSlide?.blocks?.find((b: any) => b.id === selectedBlockId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <Loader2 className="w-8 h-8 animate-spin text-[#2162F9]" />
      </div>
    );
  }

  // ── PRESENTATION MODE ──────────────────────────────────────────
  if (isPresenting) {
    return (
      <PresentationMode
        slides={slides}
        currentIdx={currentSlideIdx}
        onChangeSlide={setCurrentSlideIdx}
        onExit={() => setIsPresenting(false)}
        onSaveBlock={saveBlockContent}
      />
    );
  }

  // ── BUILDER MODE ──────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-slate-100">
      {/* LEFT: Slide Thumbnails */}
      <div className="w-56 bg-white border-r flex flex-col shadow-sm">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Slides</span>
            <span className="text-[10px] font-bold text-slate-300">{slides.length}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2 styled-scroll">
          {slides.map((slide, idx) => (
            <div
              key={slide.id}
              onClick={() => { setCurrentSlideIdx(idx); setSelectedBlockId(null); }}
              className={`relative cursor-pointer rounded-lg border-2 transition-all overflow-hidden ${
                idx === currentSlideIdx
                  ? "border-[#2162F9] shadow-lg shadow-[#2162F9]/20"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              {/* Mini slide preview */}
              <div
                className="aspect-video w-full flex items-center justify-center p-2"
                style={{
                  background: LAYOUT_BG[slide.layout]?.bg || DESIGN.white,
                  color: LAYOUT_BG[slide.layout]?.text || DESIGN.black,
                }}
              >
                <span className="text-[8px] font-bold text-center leading-tight truncate opacity-80">
                  {slide.title}
                </span>
              </div>
              <div className="px-2 py-1.5 bg-white border-t">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold text-slate-500 truncate">{idx + 1}. {slide.title}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-slate-100 bg-white">
          <button 
            onClick={autoBuildPresentation} 
            disabled={isAutoGenerating || !presentation?.intelligenceSnapshot} 
            className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              isAutoGenerating 
                ? "bg-slate-100 text-slate-400 cursor-not-allowed" 
                : "bg-gradient-to-r from-[#2162F9] to-[#43EB7C] text-white shadow-lg shadow-blue-500/20 hover:scale-105 active:scale-95"
            }`}
          >
            {isAutoGenerating ? (
               <>
                 <Loader2 size={12} className="animate-spin" />
                 {autoBuildProgress.current}/{autoBuildProgress.total}...
               </>
            ) : (
               <>
                 <Sparkles size={12} />
                 Auto-Build Deck
               </>
            )}
          </button>
        </div>

        <div className="p-3 border-t flex items-center justify-between gap-2 bg-slate-50">
          <button onClick={addNewSlide} disabled={saving} className="flex items-center justify-center gap-1.5 flex-1 py-1.5 hover:bg-slate-200 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 transition-colors">
            <Plus size={12} /> Add
          </button>
          <button onClick={duplicateSlide} disabled={saving} className="flex items-center justify-center gap-1.5 flex-1 py-1.5 hover:bg-slate-200 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 transition-colors">
            <Copy size={12} /> Duplicate
          </button>
        </div>
      </div>

      {/* CENTER: Canvas */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="h-14 bg-white border-b px-6 flex items-center justify-between shadow-sm z-10">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/presentations")} className="text-slate-400 hover:text-slate-600">
              <ChevronLeft size={18} />
            </button>
            <span className="font-bold text-sm text-slate-800 truncate max-w-[300px]">{presentation?.name}</span>
            {saving && (
              <span className="text-[10px] font-black uppercase text-[#2162F9] animate-pulse">Saving...</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPresenting(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#2162F9] text-white text-xs font-bold rounded-xl hover:shadow-lg transition-all"
            >
              <Play size={12} /> Present
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200 transition-all border border-slate-200"
            >
              <Download size={12} /> Export PDF
            </button>
          </div>
        </div>

        {/* Slide canvas */}
        <div className="flex-1 overflow-auto flex flex-col bg-[#E6EBED] shadow-inner relative styled-scroll">
          {/* Zoom controls floating */}
          <div className="sticky top-4 w-full flex justify-center z-20 pointer-events-none">
            <div className="bg-white/90 backdrop-blur-sm shadow-md rounded-full px-3 py-1.5 flex items-center gap-3 pointer-events-auto border border-slate-200/50">
              <button onClick={() => setZoom(z => Math.max(0.25, z - 0.1))} className="text-slate-500 hover:text-primary transition-colors"><ZoomOut size={16} /></button>
              <span className="text-[10px] font-black w-10 text-center font-mono opacity-60">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(2.0, z + 0.1))} className="text-slate-500 hover:text-primary transition-colors"><ZoomIn size={16} /></button>
              <div className="w-[1px] h-3 bg-slate-200"></div>
              <button onClick={() => setZoom(0.75)} className="text-[9px] font-bold text-slate-400 hover:text-primary uppercase tracking-wider">Reset</button>
            </div>
          </div>

          <div className="flex-1 flex justify-center pt-8 pb-16">
            {currentSlide ? (
              <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', width: 1280, height: 720, transition: 'transform 0.15s ease-out' }}>
                <SlideCanvas
                  slide={currentSlide}
                  onBlockClick={(blockId) => setSelectedBlockId(blockId)}
                  selectedBlockId={selectedBlockId}
                  onSaveBlock={saveBlockContent}
                  generating={generating}
                />
              </div>
            ) : (
              <div className="text-slate-400 font-bold text-sm mt-32">No slides found.</div>
            )}
          </div>
        </div>

        {/* Bottom slide navigation */}
        <div className="h-12 bg-white border-t flex items-center justify-center gap-4 shadow-sm">
          <button
            onClick={() => setCurrentSlideIdx(Math.max(0, currentSlideIdx - 1))}
            disabled={currentSlideIdx === 0}
            className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-bold text-slate-500">
            {currentSlideIdx + 1} / {slides.length}
          </span>
          <button
            onClick={() => setCurrentSlideIdx(Math.min(slides.length - 1, currentSlideIdx + 1))}
            disabled={currentSlideIdx === slides.length - 1}
            className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* RIGHT: Block Config */}
      <div className="w-72 bg-white border-l flex flex-col shadow-sm">
        <div className="p-4 border-b">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {selectedBlock ? "Block Config" : "Slide Config"}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 styled-scroll">
          {selectedBlock ? (
            <BlockConfigPanel
              block={selectedBlock}
              onGenerate={(images) => generateBlock(selectedBlock, images)}
              generating={generating === selectedBlock.id}
              onSave={(content) => saveBlockContent(selectedBlock.id, content)}
              onUpdatePrompt={(prompt) => saveBlockContent(selectedBlock.id, JSON.stringify({...JSON.parse(selectedBlock.content || "{}"), prompt}))}
            />
          ) : currentSlide ? (
            <SlideConfigPanel 
              slide={currentSlide} 
              onUpdate={async (updates) => {
                const newSlides = [...slides];
                newSlides[currentSlideIdx] = { ...currentSlide, ...updates };
                setSlides(newSlides);

                try {
                  const res = await fetch(`/api/presentations/${presId}/slides`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: "update_slide", slideId: currentSlide.id, ...updates })
                  });
                  if(!res.ok) throw new Error("Failed to update slide metadata");
                } catch(e) {
                  console.error(e);
                }
              }} 
            />
          ) : (
            <p className="text-sm text-slate-400">Select a slide or block</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE CANVAS — 16:9 renderer
// ════════════════════════════════════════════════════════════════

function SlideCanvas({ slide, onBlockClick, selectedBlockId, onSaveBlock, generating }: {
  slide: any;
  onBlockClick: (id: string) => void;
  selectedBlockId: string | null;
  onSaveBlock: (blockId: string, content: any) => void;
  generating: string | null;
}) {
  const layout = LAYOUT_BG[slide.layout] || LAYOUT_BG["content-light"];
  const isDark = slide.layout.includes("dark");

  const getBackgroundStyle = () => {
    if (slide.backgroundOverride) return slide.backgroundOverride;
    if (slide.layout === "full-bleed-dark") return `radial-gradient(circle at 80% 20%, #2C448A 0%, ${DESIGN.primary} 100%)`;
    if (slide.layout === "content-dark") return `linear-gradient(135deg, ${DESIGN.primaryDark} 0%, #172B63 100%)`;
    return layout.bg;
  };

  return (
    <div
      className="w-full h-full rounded-md shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] overflow-hidden relative flex flex-col ring-1 ring-black/5"
      style={{ background: getBackgroundStyle(), color: layout.text }}
    >
      {/* Decorative circuitry faint watermark (optional approximation) */}
      {isDark && (
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(rgba(255, 255, 255, 1) 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
      )}
      {/* Confidential tag */}
      <div
        className="absolute top-3 right-4 text-[8px] font-bold uppercase tracking-widest z-10"
        style={{ color: isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.3)" }}
      >
        CONFIDENTIAL
      </div>

      {/* Slide content */}
      <div className="flex-1 p-8 pt-6 overflow-hidden flex flex-col">
        {slide.layout === "full-bleed-dark" ? (
          <FullBleedSlide slide={slide} onBlockClick={onBlockClick} selectedBlockId={selectedBlockId} onSaveBlock={onSaveBlock} generating={generating} />
        ) : slide.layout === "two-column" ? (
          <TwoColumnSlide slide={slide} onBlockClick={onBlockClick} selectedBlockId={selectedBlockId} onSaveBlock={onSaveBlock} generating={generating} />
        ) : (
          <ContentSlide slide={slide} onBlockClick={onBlockClick} selectedBlockId={selectedBlockId} onSaveBlock={onSaveBlock} generating={generating} />
        )}
      </div>

      {/* Footer */}
      <div
        className="h-8 flex items-center justify-between px-6"
        style={{ background: DESIGN.primaryDark }}
      >
        <span className="text-[7px] font-bold text-white/80 tracking-wider">TARKIE</span>
        <span className="text-[6px] text-white/50">©2012-2025 MobileOptima, Inc. All rights reserved.</span>
      </div>
    </div>
  );
}

// ── Full Bleed Dark (Cover + Section Dividers) ────────────────
function FullBleedSlide({ slide, onBlockClick, selectedBlockId, onSaveBlock, generating }: any) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
      {slide.blocks?.map((block: any) => (
        <BlockRenderer
          key={block.id}
          block={block}
          isDark
          onClick={() => onBlockClick(block.id)}
          isSelected={selectedBlockId === block.id}
          onSave={(content) => onSaveBlock(block.id, content)}
          isGenerating={generating === block.id}
        />
      ))}
    </div>
  );
}

// ── Content Slide (Light/Dark) ────────────────
function ContentSlide({ slide, onBlockClick, selectedBlockId, onSaveBlock, generating }: any) {
  const isDark = slide.layout.includes("dark");
  return (
    <div className="flex-1 flex flex-col gap-4">
      {/* Slide title */}
      <h2
        className="text-lg font-bold tracking-tight"
        style={{ color: isDark ? DESIGN.white : DESIGN.primaryDark, fontFamily: "'DM Sans', sans-serif" }}
      >
        {slide.title}
      </h2>
      {/* Blocks */}
      {slide.blocks?.map((block: any) => (
        <BlockRenderer
          key={block.id}
          block={block}
          isDark={isDark}
          onClick={() => onBlockClick(block.id)}
          isSelected={selectedBlockId === block.id}
          onSave={(content) => onSaveBlock(block.id, content)}
          isGenerating={generating === block.id}
        />
      ))}
    </div>
  );
}

// ── Two Column Slide ────────────────
function TwoColumnSlide({ slide, onBlockClick, selectedBlockId, onSaveBlock, generating }: any) {
  return (
    <div className="flex-1 flex flex-col gap-4">
      <h2
        className="text-lg font-bold tracking-tight"
        style={{ color: DESIGN.primaryDark, fontFamily: "'DM Sans', sans-serif" }}
      >
        {slide.title}
      </h2>
      <div className="flex-1 grid grid-cols-2 gap-6">
        {slide.blocks?.map((block: any) => (
          <BlockRenderer
            key={block.id}
            block={block}
            isDark={false}
            onClick={() => onBlockClick(block.id)}
            isSelected={selectedBlockId === block.id}
            onSave={(content) => onSaveBlock(block.id, content)}
            isGenerating={generating === block.id}
          />
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// BLOCK RENDERER
// ════════════════════════════════════════════════════════════════

function BlockRenderer({ block, isDark, onClick, isSelected, onSave, isGenerating }: {
  block: any;
  isDark: boolean;
  onClick: () => void;
  isSelected: boolean;
  onSave: (content: any) => void;
  isGenerating: boolean;
}) {
  let content: any = {};
  try {
    content = block.content ? JSON.parse(block.content) : {};
  } catch { content = { body: block.content || "" }; }

  if (isGenerating) {
    return (
      <div onClick={onClick} className={`flex items-center justify-center gap-2 p-4 rounded-lg animate-pulse ${isSelected ? "ring-2 ring-[#43EB7C]" : ""}`}>
        <Loader2 size={16} className="animate-spin" style={{ color: DESIGN.accentGreen }} />
        <span className="text-xs font-bold" style={{ color: isDark ? DESIGN.white : DESIGN.primaryDark }}>Generating...</span>
      </div>
    );
  }

  const wrapperClass = `cursor-pointer transition-all rounded-lg ${isSelected ? "ring-2 ring-[#43EB7C] ring-offset-2" : "hover:ring-1 hover:ring-slate-300"}`;

  switch (block.blockType) {
    case "text":
      return (
        <div onClick={onClick} className={wrapperClass}>
          {content.decorativeDashes && (
            <div className="flex items-center justify-center gap-3 mb-2">
              {[1,2,3].map(i => (
                <div key={i} className="w-12 h-1.5 rounded-full" style={{ background: DESIGN.accentGreen }} />
              ))}
            </div>
          )}
          {content.heading && (
            <h1
              className="font-bold text-center"
              style={{
                fontSize: content.decorativeDashes ? "2rem" : "1.5rem",
                fontFamily: isDark ? "'Quicksand', sans-serif" : "'DM Sans', sans-serif",
              }}
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => onSave(JSON.stringify({ ...content, heading: e.currentTarget.textContent || "" }))}
            >
              {content.heading}
            </h1>
          )}
          {content.subtitle && (
            <p className="text-center text-sm mt-2 opacity-80 italic"
              contentEditable suppressContentEditableWarning
              onBlur={(e) => onSave(JSON.stringify({ ...content, subtitle: e.currentTarget.textContent || "" }))}
            >
              {content.subtitle}
            </p>
          )}
          {content.tagline && (
            <p className="text-center text-xs mt-3 font-bold italic opacity-60">{content.tagline}</p>
          )}
          {content.body && (
            <p className="text-xs leading-relaxed"
              contentEditable suppressContentEditableWarning
              onBlur={(e) => onSave(JSON.stringify({ ...content, body: e.currentTarget.textContent || "" }))}
            >
              {content.body}
            </p>
          )}
        </div>
      );

    case "bullet-list":
      return (
        <div onClick={onClick} className={wrapperClass}>
          <ul className="space-y-1.5">
            {(content.items || []).map((item: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: DESIGN.accentGreen }} />
                <span
                  contentEditable suppressContentEditableWarning
                  onBlur={(e) => {
                    const newItems = [...content.items];
                    newItems[i] = e.currentTarget.textContent || "";
                    onSave(JSON.stringify({ ...content, items: newItems }));
                  }}
                >
                  {item}
                </span>
              </li>
            ))}
          </ul>
          {(content.items?.length === 0 || !content.items) && (
            <p className="text-xs opacity-40 italic">No items yet — use AI Generate or add manually</p>
          )}
        </div>
      );

    case "table":
      return (
        <TableBlockUI
          content={content}
          onClick={onClick}
          wrapperClass={wrapperClass}
          onSave={onSave}
        />
      );

    case "phase-card":
      return (
        <div onClick={onClick} className={`${wrapperClass} space-y-3`}>
          {(content.phases || []).map((phase: any, i: number) => (
            <div key={i} className="rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 font-bold text-xs" style={{ background: DESIGN.accentGreen, color: DESIGN.black }}>
                {phase.label} — {phase.title}
              </div>
              <div className="pl-3 border-l-2 py-2 space-y-1" style={{ borderColor: DESIGN.accentGreen }}>
                {(phase.items || []).map((item: string, j: number) => (
                  <p key={j} className="text-[9px] leading-relaxed flex items-start gap-1.5">
                    <span className="mt-1 w-1 h-1 rounded-full flex-shrink-0" style={{ background: DESIGN.primary }} />
                    {item}
                  </p>
                ))}
              </div>
            </div>
          ))}
          {(!content.phases || content.phases.length === 0) && (
            <p className="text-xs opacity-40 italic">No phases — use AI Generate</p>
          )}
        </div>
      );

    case "sparkle-row":
      return (
        <div onClick={onClick} className={`${wrapperClass} space-y-0.5`}>
          {(content.rows || []).map((row: any, i: number) => (
            <div key={i} className="flex text-[9px]">
              <div className="w-8 flex items-center justify-center font-bold text-sm" style={{ background: DESIGN.primary, color: DESIGN.accentGreen }}>
                {row.letter}
              </div>
              <div className="w-28 px-2 py-1 font-bold flex items-center" style={{ background: DESIGN.primaryDark, color: DESIGN.white }}>
                {row.label}
              </div>
              <div className="flex-1 px-2 py-1" style={{ background: i % 2 === 0 ? DESIGN.white : DESIGN.surfaceBlue, color: DESIGN.black }}>
                {row.description}
              </div>
            </div>
          ))}
        </div>
      );

    case "image":
      return (
        <div onClick={onClick} className={`${wrapperClass} flex flex-col items-center justify-center p-4 border rounded-lg gap-2`} style={{ borderColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.1)", background: 'rgba(0,0,0,0.05)' }}>
          {content.images && content.images.length > 0 ? (
            <div className={`grid gap-4 ${content.images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {content.images.map((img: string, i: number) => (
                <img key={i} src={img} className="max-w-full h-auto rounded-md shadow-sm" alt={`Generated image ${i}`} />
              ))}
            </div>
          ) : (
            <span className="text-xs opacity-40">{content.alt || "Image placeholder"}</span>
          )}
        </div>
      );

    default:
      // If we find raw images inside a generic block but not matched to a specific block type (fallback)
      if (content.images && content.images.length > 0) {
        return (
          <div onClick={onClick} className={wrapperClass}>
            <div className={`grid gap-4 ${content.images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {content.images.map((img: string, i: number) => (
                <img key={i} src={img} className="max-w-full h-auto rounded-md shadow-sm" alt={`Attached UI image ${i}`} />
              ))}
            </div>
          </div>
        );
      }
      return (
        <div onClick={onClick} className={`${wrapperClass} text-xs opacity-50 p-4 border rounded`}>
          [Unknown Block: {block.blockType}]
        </div>
      );
  }
}

// ════════════════════════════════════════════════════════════════
// TABLE BLOCK INTERACTIVE UI
// ════════════════════════════════════════════════════════════════
function TableBlockUI({ content, onClick, wrapperClass, onSave }: any) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);

  const addRow = (index: number) => {
    const newRows = [...(content.rows || [])];
    const emptyRow = Array((content.columns || []).length).fill("New Cell");
    newRows.splice(index, 0, emptyRow);
    onSave(JSON.stringify({ ...content, rows: newRows }));
  };

  const addCol = (index: number) => {
    const newCols = [...(content.columns || [])];
    newCols.splice(index, 0, "NEW COL");
    const newRows = (content.rows || []).map((row: string[]) => {
      const r = [...row];
      r.splice(index, 0, "Data");
      return r;
    });
    onSave(JSON.stringify({ ...content, columns: newCols, rows: newRows }));
  };

  const removeRow = (index: number) => {
    const newRows = [...(content.rows || [])];
    newRows.splice(index, 1);
    onSave(JSON.stringify({ ...content, rows: newRows }));
  };

  const removeCol = (index: number) => {
    const newCols = [...(content.columns || [])];
    newCols.splice(index, 1);
    const newRows = (content.rows || []).map((row: string[]) => {
      const r = [...row];
      r.splice(index, 1);
      return r;
    });
    onSave(JSON.stringify({ ...content, columns: newCols, rows: newRows }));
  };

  return (
    <div onClick={onClick} className={`${wrapperClass} overflow-visible block relative group/table`} onMouseLeave={() => { setHoveredRow(null); setHoveredCol(null); }}>
      <table className="w-full text-sm border-collapse table-fixed">
        <thead>
          <tr>
            {(content.columns || []).map((col: string, i: number) => (
              <th
                key={i}
                onMouseEnter={() => setHoveredCol(i)}
                className="px-4 py-3 text-left font-bold uppercase tracking-wider relative group/th"
                style={{
                  background: DESIGN.primaryDark,
                  color: DESIGN.white,
                  borderBottom: `3px solid ${DESIGN.accentGreen}`,
                }}
              >
                <span contentEditable suppressContentEditableWarning onBlur={(e) => {
                  const newCols = [...content.columns];
                  newCols[i] = e.currentTarget.textContent || "";
                  onSave(JSON.stringify({ ...content, columns: newCols }));
                }}>{col}</span>

                {/* Column controls */}
                {hoveredCol === i && (
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 flex items-center bg-white shadow-md rounded border text-black p-0.5 z-20">
                    <button onClick={() => addCol(i)} className="p-1 hover:bg-slate-100 rounded text-slate-500" title="Add Left"><Plus size={12} /></button>
                    <button onClick={() => removeCol(i)} className="p-1 hover:bg-red-100 text-red-500 rounded" title="Delete Column"><Trash2 size={12} /></button>
                    <button onClick={() => addCol(i+1)} className="p-1 hover:bg-slate-100 rounded text-slate-500" title="Add Right"><Plus size={12} /></button>
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(content.rows || []).map((row: string[], ri: number) => (
            <tr key={ri} className="relative group/tr" onMouseEnter={() => setHoveredRow(ri)} style={{ background: ri % 2 === 1 ? DESIGN.surfaceBlue : DESIGN.white }}>
              {row.map((cell: string, ci: number) => (
                <td
                  key={ci}
                  className="px-4 py-2.5 border-b border-slate-200"
                  contentEditable suppressContentEditableWarning
                  onBlur={(e) => {
                    const newRows = content.rows.map((r: string[], idx: number) =>
                      idx === ri ? r.map((c: string, cidx: number) => cidx === ci ? (e.currentTarget.textContent || "") : c) : r
                    );
                    onSave(JSON.stringify({ ...content, rows: newRows }));
                  }}
                >
                  {cell}
                </td>
              ))}
              
              {/* Row controls */}
              {hoveredRow === ri && (
                <td className="absolute -left-16 top-1/2 -translate-y-1/2 flex items-center bg-white shadow-md rounded border text-black p-0.5 z-20 w-max">
                  <button onClick={() => addRow(ri)} className="p-1 hover:bg-slate-100 rounded text-slate-500" title="Add Above"><Plus size={12} /></button>
                  <button onClick={() => removeRow(ri)} className="p-1 hover:bg-red-100 text-red-500 rounded" title="Delete Row"><Trash2 size={12} /></button>
                  <button onClick={() => addRow(ri+1)} className="p-1 hover:bg-slate-100 rounded text-slate-500" title="Add Below"><Plus size={12} /></button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {(!content.rows || content.rows.length === 0) && (
        <div className="flex flex-col items-center py-6 gap-2">
          <p className="text-xs opacity-40 italic text-center">No data — use AI Generate or add manually</p>
          <button onClick={() => addRow(0)} className="px-3 py-1 bg-slate-100 text-slate-600 rounded text-xs font-bold hover:bg-slate-200">
            + Add First Row
          </button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// BLOCK CONFIG PANEL (Right sidebar)
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// BLOCK CONFIG PANEL (Right sidebar)
// ════════════════════════════════════════════════════════════════

import SmartMic from "@/components/ui/SmartMic";
import { Image as ImageIcon, X } from "lucide-react";

function BlockConfigPanel({ block, onGenerate, generating, onSave, onUpdatePrompt }: {
  block: any;
  onGenerate: (images: string[]) => void;
  generating: boolean;
  onSave: (content: any) => void;
  onUpdatePrompt?: (prompt: string) => void;
}) {
  const [editPrompt, setEditPrompt] = useState(block.prompt || "");
  const [attachedImages, setAttachedImages] = useState<{url: string, file: File}[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => { 
    setEditPrompt(block.prompt || ""); 
    // Cleanup old URLs before clearing
    objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
    setAttachedImages([]); 
  }, [block.id]);

  // Global cleanup on unmount
  useEffect(() => {
    return () => {
        objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const url = URL.createObjectURL(file);
          // Track for cleanup
          if (!objectUrlsRef.current) objectUrlsRef.current = [];
          objectUrlsRef.current.push(url);
          setAttachedImages((prev: any[]) => [...prev, { url, file }]);
        }
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newImages = Array.from(e.target.files).map(file => {
        const url = URL.createObjectURL(file);
        if (!objectUrlsRef.current) objectUrlsRef.current = [];
        objectUrlsRef.current.push(url);
        return { url, file };
      });
      setAttachedImages((prev: any[]) => [...prev, ...newImages]);
    }
  };

  const handleGenerateClick = async () => {
    // Read all files as base64
    const base64Images = await Promise.all(attachedImages.map(img => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(img.file);
      });
    }));
    
    // Save prompt first
    if (onUpdatePrompt && editPrompt !== block.prompt) {
      onUpdatePrompt(editPrompt);
    }
    
    // Pass images to generator
    onGenerate(base64Images);
  };

  return (
    <div className="space-y-5">
      <div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Block Type</span>
        <p className="text-sm font-bold text-slate-700 mt-1 capitalize">{block.blockType?.replace("-", " ")}</p>
      </div>

      {block.intelligenceMapping && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <span className="text-[10px] font-black uppercase text-emerald-600">Intelligence Source</span>
          <p className="text-xs font-bold text-emerald-700 mt-1">{block.intelligenceMapping}</p>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            AI Prompt
          </label>
          <SmartMic
            onTranscription={(text) => setEditPrompt((prev: string) => prev ? prev + " " + text : text)}
          />
        </div>
        <textarea
          value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)}
          onPaste={handlePaste}
          placeholder="Describe content or paste an image/screenshot here..."
          className="w-full h-24 px-3 py-2 border rounded-xl text-xs focus:ring-2 focus:ring-[#2162F9]/20 focus:border-[#2162F9] outline-none resize-none"
        />
        
        {/* Attachment preview / upload controls */}
        <div className="mt-2 flex flex-col gap-2">
          {attachedImages.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachedImages.map((img, idx) => (
                <div key={idx} className="relative w-12 h-12 rounded border bg-slate-50 flex items-center justify-center overflow-hidden group">
                  <img src={img.url} className="object-cover w-full h-full" alt="attachment" />
                  <button
                    onClick={() => {
                        URL.revokeObjectURL(img.url);
                        objectUrlsRef.current = objectUrlsRef.current.filter(u => u !== img.url);
                        setAttachedImages((prev: any[]) => prev.filter((_, i) => i !== idx));
                    }}
                    className="absolute top-0.5 right-0.5 bg-black/50 text-white rounded-sm p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <input type="file" accept="image/*" multiple className="hidden" ref={fileInputRef} onChange={handleFileChange} />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-400 hover:text-[#2162F9] transition-colors"
          >
            <ImageIcon size={12} /> Attach Image/Screenshot
          </button>
        </div>
      </div>

      <button
        onClick={handleGenerateClick}
        disabled={generating}
        className="w-full flex items-center justify-center gap-2 bg-[#2162F9] text-white py-2.5 rounded-xl font-bold text-xs hover:shadow-lg transition-all disabled:opacity-50"
      >
        {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {generating ? "Generating..." : "Generate with AI"}
      </button>

      <div className="border-t pt-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lock Block</span>
          <button className="text-slate-400 hover:text-slate-600">
            {block.isLocked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function SlideConfigPanel({ slide, onUpdate }: { slide: any, onUpdate: (data: any) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Slide Title</label>
        <input 
          type="text" 
          value={slide.title} 
          onChange={(e) => onUpdate({ title: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#2162F9]/20 font-bold focus:border-[#2162F9] outline-none" 
        />
      </div>
      <div>
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Slide Layout</label>
        <select 
          value={slide.layout} 
          onChange={(e) => onUpdate({ layout: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg text-sm font-medium focus:ring-2 focus:ring-[#2162F9]/20 focus:border-[#2162F9] outline-none bg-white"
        >
          {Object.keys(LAYOUT_BG).map((l) => (
            <option key={l} value={l}>{l.replace(/-/g, " ")}</option>
          ))}
        </select>
      </div>
      <div className="pt-2 border-t border-slate-100">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Content Blocks</span>
        <p className="text-sm text-slate-500 mt-1">{slide.blocks?.length || 0} active blocks</p>
      </div>
      <p className="text-xs text-slate-400 italic">Click any block on the canvas to configure AI & content.</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// PRESENTATION MODE
// ════════════════════════════════════════════════════════════════

function PresentationMode({ slides, currentIdx, onChangeSlide, onExit, onSaveBlock }: {
  slides: any[];
  currentIdx: number;
  onChangeSlide: (idx: number) => void;
  onExit: () => void;
  onSaveBlock: (blockId: string, content: any) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (containerRef.current && !document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => console.error(err));
    }
    const handleFullscreenChange = () => { if (!document.fullscreenElement) onExit(); };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const computeScale = () => {
      // We know our master SlideCanvas is perfectly built for 1280x720, so we literally just scale it up via CSS!
      const availableWidth = window.innerWidth;
      // Reserve 0px for footer since it's going to be absolute/overlay or we just let it be on top.
      const availableHeight = window.innerHeight; 
      const newScale = Math.min(availableWidth / 1280, availableHeight / 720);
      setScale(newScale);
    };
    computeScale();
    window.addEventListener("resize", computeScale);
    return () => window.removeEventListener("resize", computeScale);
  }, []);

  const slide = slides[currentIdx];
  if (!slide) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
      style={{ background: "#000000" }} 
    >
      <div 
        style={{ 
          transform: `scale(${scale})`, 
          transformOrigin: 'center center',
          width: 1280, 
          height: 720,
          position: 'relative'
        }}
      >
        <SlideCanvas
           slide={slide}
           onBlockClick={() => {}}
           selectedBlockId={null}
           onSaveBlock={onSaveBlock}
           generating={null}
        />
      </div>

      {/* Footer Navigation Controls Overlay */}
      <div className="absolute bottom-0 inset-x-0 h-16 flex items-center justify-between px-8 bg-gradient-to-t from-black/80 to-transparent opacity-0 hover:opacity-100 transition-opacity z-50">
        <span className="text-[14px] font-black text-white/50 tracking-widest">TARKIE</span>
        <div className="flex items-center gap-6">
          <button onClick={() => onChangeSlide(Math.max(0, currentIdx - 1))} className="text-white hover:text-[#43EB7C] transition-colors p-2">
            <ChevronLeft size={32} />
          </button>
          <span className="text-xl font-bold text-white tracking-widest">{currentIdx + 1} / {slides.length}</span>
          <button onClick={() => onChangeSlide(Math.min(slides.length - 1, currentIdx + 1))} className="text-white hover:text-[#43EB7C] transition-colors p-2">
            <ChevronRight size={32} />
          </button>
        </div>
        <button onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); onExit(); }} className="text-white p-2 hover:bg-white/20 rounded-lg">
          <Maximize2 size={20} />
        </button>
      </div>
    </div>
  );
}
