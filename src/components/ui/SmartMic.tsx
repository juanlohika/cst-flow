"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff } from "lucide-react";

interface SmartMicProps {
  onTranscription: (text: string) => void;
  onInterim?: (text: string) => void;
  meetingId?: string;
  disabled?: boolean;
  onToggle?: (listening: boolean) => void;
}

/**
 * SmartMic — continuous Web Speech API transcription.
 *
 * - User must click the mic button to start (no auto-start — avoids the
 *   browser blocking the permission prompt when it fires unexpectedly).
 * - Pauses automatically when the tab is hidden and resumes when the tab
 *   is focused again, so the mic does not lock other apps out.
 * - Each finalized result fires onTranscription(text) and is persisted to
 *   the DB in the background. No audio upload, no base64, no AI fallback.
 */
export default function SmartMic({
  onTranscription,
  onInterim,
  meetingId,
  disabled = false,
  onToggle,
}: SmartMicProps) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  // True when the user wants the mic active (independent of tab visibility)
  const wantsListeningRef = useRef(false);
  const onTranscriptionRef = useRef(onTranscription);
  const onInterimRef = useRef(onInterim);
  const meetingIdRef = useRef(meetingId);

  useEffect(() => { onTranscriptionRef.current = onTranscription; }, [onTranscription]);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);
  useEffect(() => { meetingIdRef.current = meetingId; }, [meetingId]);

  // ── Core recognition instance factory ──────────────────────────────────────

  const buildRecognition = useCallback(() => {
    if (typeof window === "undefined") return null;
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return null;

    const cleanBranding = (t: string) => t.replace(/\b(Turkey|Starkey|starkey|turkey)\b/g, "Tarkie");

    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.maxAlternatives = 1;

    r.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const rawText = result[0].transcript.trim();
          const text = cleanBranding(rawText);
          if (text) {
            onTranscriptionRef.current(text);
            const mid = meetingIdRef.current;
            if (mid) {
              fetch(`/api/meetings/${mid}/transcribe`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
              }).catch(() => {});
            }
          }
        } else {
          interim += cleanBranding(result[0].transcript);
        }
      }
      setInterimText(interim);
      onInterimRef.current?.(interim);
    };

    r.onend = () => {
      setInterimText("");
      // Auto-restart only if tab is visible and user still wants to listen
      if (wantsListeningRef.current && document.visibilityState === "visible") {
        try { r.start(); } catch { /* already started */ }
      }
    };

    r.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed") {
        wantsListeningRef.current = false;
        setIsListening(false);
        setError(
          'Microphone blocked. In Chrome: click the 🔒 icon in the address bar → Microphone → "Allow" → refresh.'
        );
        return;
      }
      setError(`Mic error: ${event.error}`);
    };

    return r;
  }, []);

  // ── Start / stop helpers ────────────────────────────────────────────────────

  const startListening = useCallback(() => {
    if (recognitionRef.current) return; // already running
    const r = buildRecognition();
    if (!r) {
      setError("Speech recognition is not supported. Please use Chrome.");
      return;
    }
    recognitionRef.current = r;
    wantsListeningRef.current = true;
    setIsListening(true);
    setError(null);
    try { r.start(); } catch { /* ignore */ }
    onToggle?.(true);
  }, [buildRecognition, onToggle]);

  const stopListening = useCallback(() => {
    wantsListeningRef.current = false;
    setIsListening(false);
    setInterimText("");
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    onToggle?.(false);
  }, [onToggle]);

  // ── Tab visibility — pause mic when hidden, resume when visible ────────────

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        // Pause: stop the recognition instance but keep wantsListening = true
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch { /* ignore */ }
          recognitionRef.current = null;
          setInterimText("");
        }
      } else if (document.visibilityState === "visible" && wantsListeningRef.current) {
        // Resume: rebuild and restart
        const r = buildRecognition();
        if (r) {
          recognitionRef.current = r;
          try { r.start(); } catch { /* ignore */ }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [buildRecognition]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      wantsListeningRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={isListening ? stopListening : startListening}
        disabled={disabled}
        title={isListening ? "Stop listening" : "Start listening"}
        className={`h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-lg transition-all border ${
          isListening
            ? "bg-red-500 hover:bg-red-600 text-white border-red-600 shadow-sm shadow-red-200 animate-pulse"
            : "bg-white text-text-muted hover:bg-surface-subtle border-border-default"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
      </button>

      <div className="flex-1 min-w-0">
        {isListening && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[11px] text-red-500 font-medium">Listening</span>
          </div>
        )}
        {isListening && interimText && (
          <p className="text-[11px] text-text-secondary italic truncate mt-0.5">{interimText}</p>
        )}
        {!isListening && !error && (
          <p className="text-[11px] text-text-secondary">Click mic to start</p>
        )}
        {error && (
          <p className="text-[11px] text-red-500 leading-tight">{error}</p>
        )}
      </div>
    </div>
  );
}
