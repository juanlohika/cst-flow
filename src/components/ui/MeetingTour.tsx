"use client";

import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, ChevronRight, ChevronLeft, Sparkles, Check } from "lucide-react";

export interface TourStep {
  targetId: string;
  title: string;
  content: string;
  placement: "top" | "bottom" | "left" | "right";
}

interface MeetingTourProps {
  steps: TourStep[];
  onComplete: () => void;
  onClose: () => void;
}

export default function MeetingTour({ steps, onComplete, onClose }: MeetingTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [isVisible, setIsVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  const step = steps[currentStep];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const updatePosition = () => {
      const el = document.getElementById(step.targetId);
      if (!el) {
        // Fallback to center screen if target not found
        setCoords({ top: window.innerHeight / 2 - 100, left: window.innerWidth / 2 - 150 });
        setIsVisible(true);
        return;
      }

      const rect = el.getBoundingClientRect();
      let t = 0, l = 0;

      switch (step.placement) {
        case "top":
          t = rect.top - 200;
          l = rect.left + rect.width / 2 - 150;
          break;
        case "bottom":
          t = rect.bottom + 20;
          l = rect.left + rect.width / 2 - 150;
          break;
        case "left":
          t = rect.top + rect.height / 2 - 100;
          l = rect.left - 320;
          break;
        case "right":
          t = rect.top + rect.height / 2 - 100;
          l = rect.right + 20;
          break;
      }

      // Bounds checking
      t = Math.max(20, Math.min(t, window.innerHeight - 250));
      l = Math.max(20, Math.min(l, window.innerWidth - 320));

      setCoords({ top: t, left: l });
      setIsVisible(true);
      
      // Pulse effect on target
      el.classList.add("tour-pulse");
      return () => el.classList.remove("tour-pulse");
    };

    setIsVisible(false);
    const timer = setTimeout(updatePosition, 100);
    return () => clearTimeout(timer);
  }, [currentStep, step]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(s => s + 1);
    } else {
      onComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep(s => s - 1);
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2000000] pointer-events-none overflow-hidden h-full w-full">
      {/* Dimmed backdrop area (optional, user said no modal style but subtle focus helps) */}
      <div className="absolute inset-0 bg-slate-900/5 backdrop-blur-[1px] pointer-events-auto" onClick={onClose} />

      <div 
        className={`absolute z-[1000001] w-[300px] pointer-events-auto transition-all duration-500 ease-out transform ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
        style={{ top: coords.top, left: coords.left }}
      >
        <div className="bg-white/90 backdrop-blur-xl border border-white/50 rounded-[2rem] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.15)] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-5 pt-5 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center text-white shadow shadow-primary/20">
                <Sparkles className="w-4 h-4" />
              </div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Live Guide</p>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full transition-colors">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-2">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight mb-2">{step.title}</h3>
            <p className="text-[12px] leading-relaxed text-slate-500 font-medium">
              {step.content}
            </p>
          </div>

          {/* Footer */}
          <div className="p-4 flex items-center justify-between mt-2">
            <div className="flex gap-1">
              {steps.map((_, i) => (
                <div key={i} className={`h-1 rounded-full transition-all duration-300 ${i === currentStep ? 'w-4 bg-primary' : 'w-1.5 bg-slate-200'}`} />
              ))}
            </div>
            
            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button 
                  onClick={handlePrev} 
                  className="w-8 h-8 flex items-center justify-center rounded-xl border border-slate-100 text-slate-400 hover:bg-slate-50 transition-all font-bold"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              <button 
                onClick={handleNext} 
                className="h-8 pl-4 pr-3 flex items-center gap-2 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-dark shadow shadow-primary/10 transition-all active:scale-95"
              >
                {currentStep === steps.length - 1 ? "Finish" : "Next"}
                {currentStep === steps.length - 1 ? <Check className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Small pointer triangle */}
        <div className={`absolute w-4 h-4 bg-white/90 border-r border-b border-white/50 rotate-45 transition-all duration-500
          ${step.placement === 'top' ? 'bottom-[-7px] left-1/2 -ml-2' : ''}
          ${step.placement === 'bottom' ? 'top-[-7px] left-1/2 -ml-2 rotate-[225deg]' : ''}
          ${step.placement === 'left' ? 'right-[-7px] top-1/2 -mt-2 rotate-[-45deg]' : ''}
          ${step.placement === 'right' ? 'left-[-7px] top-1/2 -mt-2 rotate-[135deg]' : ''}
        `} />
      </div>

      <style jsx global>{`
        .tour-pulse {
          box-shadow: 0 0 0 0 rgba(26, 115, 232, 0.4);
          animation: tour-pulse-anim 2s infinite;
          border-radius: 8px;
          position: relative;
          z-index: 1000002;
          background: white !important;
        }
        @keyframes tour-pulse-anim {
          0% { box-shadow: 0 0 0 0 rgba(26, 115, 232, 0.4); }
          70% { box-shadow: 0 0 0 15px rgba(26, 115, 232, 0); }
          100% { box-shadow: 0 0 0 0 rgba(26, 115, 232, 0); }
        }
      `}</style>
    </div>,
    document.body
  );
}
