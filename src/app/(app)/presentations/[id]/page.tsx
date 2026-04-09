"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import AuthGuard from "@/components/auth/AuthGuard";
import {
  Loader2, ChevronLeft, ChevronRight, Play, Download, Plus, Trash2, Copy, GripVertical,
  Lock, Unlock, Sparkles, RotateCcw, Maximize2, Settings, Eye
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
      setSlides(prev => prev.map(s => ({
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
  const generateBlock = useCallback(async (block: any) => {
    if (!block.prompt && !block.intelligenceMapping) return;
    setGenerating(block.id);
    try {
      const res = await fetch("/api/presentations/generate-block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockType: block.blockType,
          prompt: block.prompt || `Generate content for ${block.blockType} block`,
          accountIntelligence: presentation?.intelligenceSnapshot || "",
          designSkill: presentation?.designSnapshot || "",
          slideBackground: slides[currentSlideIdx]?.layout?.includes("dark") ? "dark" : "light",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await saveBlockContent(block.id, data.content);
      }
    } catch (err) {
      console.error("Generate failed:", err);
    } finally {
      setGenerating(null);
    }
  }, [presId, presentation, slides, currentSlideIdx, saveBlockContent]);

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
        <div className="flex-1 overflow-auto flex items-center justify-center p-8">
          {currentSlide ? (
            <SlideCanvas
              slide={currentSlide}
              onBlockClick={(blockId) => setSelectedBlockId(blockId)}
              selectedBlockId={selectedBlockId}
              onSaveBlock={saveBlockContent}
              generating={generating}
            />
          ) : (
            <div className="text-slate-300 text-sm">No slides</div>
          )}
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
              onGenerate={() => generateBlock(selectedBlock)}
              generating={generating === selectedBlock.id}
              onSave={(content) => saveBlockContent(selectedBlock.id, content)}
            />
          ) : currentSlide ? (
            <SlideConfigPanel slide={currentSlide} />
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

  return (
    <div
      className="w-full max-w-[960px] aspect-video rounded-2xl shadow-2xl overflow-hidden relative flex flex-col"
      style={{ background: slide.backgroundOverride || layout.bg, color: layout.text }}
    >
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
        <div onClick={onClick} className={`${wrapperClass} overflow-auto`}>
          <table className="w-full text-[9px] border-collapse">
            <thead>
              <tr>
                {(content.columns || []).map((col: string, i: number) => (
                  <th
                    key={i}
                    className="px-2 py-1.5 text-left font-bold uppercase tracking-wider"
                    style={{
                      background: DESIGN.primaryDark,
                      color: DESIGN.white,
                      borderBottom: `2px solid ${DESIGN.accentGreen}`,
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(content.rows || []).map((row: string[], ri: number) => (
                <tr key={ri} style={{ background: ri % 2 === 1 ? DESIGN.surfaceBlue : DESIGN.white }}>
                  {row.map((cell: string, ci: number) => (
                    <td
                      key={ci}
                      className="px-2 py-1 border-b border-slate-200"
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
                </tr>
              ))}
            </tbody>
          </table>
          {(!content.rows || content.rows.length === 0) && (
            <p className="text-xs opacity-40 italic text-center py-2">No data — use AI Generate or add rows</p>
          )}
        </div>
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
        <div onClick={onClick} className={`${wrapperClass} flex items-center justify-center p-4 border-2 border-dashed rounded-lg`} style={{ borderColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.1)" }}>
          <span className="text-xs opacity-40">{content.alt || "Image placeholder"}</span>
        </div>
      );

    default:
      return (
        <div onClick={onClick} className={`${wrapperClass} text-xs opacity-50`}>
          [{block.blockType}]
        </div>
      );
  }
}

// ════════════════════════════════════════════════════════════════
// BLOCK CONFIG PANEL (Right sidebar)
// ════════════════════════════════════════════════════════════════

function BlockConfigPanel({ block, onGenerate, generating, onSave }: {
  block: any;
  onGenerate: () => void;
  generating: boolean;
  onSave: (content: any) => void;
}) {
  const [editPrompt, setEditPrompt] = useState(block.prompt || "");

  useEffect(() => { setEditPrompt(block.prompt || ""); }, [block.id]);

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
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block">
          AI Prompt
        </label>
        <textarea
          value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)}
          placeholder="Describe what this block should contain..."
          className="w-full h-24 px-3 py-2 border rounded-xl text-xs focus:ring-2 focus:ring-[#2162F9]/20 focus:border-[#2162F9] outline-none resize-none"
        />
      </div>

      <button
        onClick={onGenerate}
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

function SlideConfigPanel({ slide }: { slide: any }) {
  return (
    <div className="space-y-4">
      <div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Slide Title</span>
        <p className="text-sm font-bold text-slate-700 mt-1">{slide.title}</p>
      </div>
      <div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Layout</span>
        <p className="text-sm font-medium text-slate-600 mt-1 capitalize">{slide.layout?.replace(/-/g, " ")}</p>
      </div>
      <div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Blocks</span>
        <p className="text-sm text-slate-500 mt-1">{slide.blocks?.length || 0} blocks</p>
      </div>
      <p className="text-xs text-slate-400 italic">Click a block on the canvas to configure it</p>
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
  const slide = slides[currentIdx];
  if (!slide) return null;

  const layout = LAYOUT_BG[slide.layout] || LAYOUT_BG["content-light"];
  const isDark = slide.layout.includes("dark");

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: slide.backgroundOverride || layout.bg, color: layout.text }}
    >
      {/* Confidential */}
      <div
        className="absolute top-4 right-6 text-[10px] font-bold uppercase tracking-widest z-10"
        style={{ color: isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.3)" }}
      >
        CONFIDENTIAL
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="w-full max-w-[1200px]">
          {slide.layout === "full-bleed-dark" ? (
            <FullBleedSlide slide={slide} onBlockClick={() => {}} selectedBlockId={null} onSaveBlock={onSaveBlock} generating={null} />
          ) : slide.layout === "two-column" ? (
            <TwoColumnSlide slide={slide} onBlockClick={() => {}} selectedBlockId={null} onSaveBlock={onSaveBlock} generating={null} />
          ) : (
            <ContentSlide slide={slide} onBlockClick={() => {}} selectedBlockId={null} onSaveBlock={onSaveBlock} generating={null} />
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        className="h-12 flex items-center justify-between px-8"
        style={{ background: DESIGN.primaryDark }}
      >
        <span className="text-[10px] font-bold text-white/80 tracking-widest">TARKIE</span>
        <div className="flex items-center gap-4">
          <button onClick={() => onChangeSlide(Math.max(0, currentIdx - 1))} className="text-white/60 hover:text-white">
            <ChevronLeft size={20} />
          </button>
          <span className="text-xs font-bold text-white/70">{currentIdx + 1} / {slides.length}</span>
          <button onClick={() => onChangeSlide(Math.min(slides.length - 1, currentIdx + 1))} className="text-white/60 hover:text-white">
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[7px] text-white/40">©2012-2025 MobileOptima, Inc.</span>
          <button onClick={onExit} className="text-white/60 hover:text-white">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
