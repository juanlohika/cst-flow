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

  // Refs for logic
  const recognitionRef = useRef<any>(null); // For Native SpeechRecognition
  
  const onTranscriptionRef = useRef(onTranscription);
  const onInterimRef = useRef(onInterim);

  useEffect(() => { onTranscriptionRef.current = onTranscription; }, [onTranscription]);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);

  // ── Browser "Keep-Alive" Heartbeat ─────────────────────────────────────────
  const keepAliveAudioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
    if (!isListening) {
      if (keepAliveAudioRef.current) {
        keepAliveAudioRef.current.pause();
        navigator.mediaSession.playbackState = "none";
      }
      return;
    }
    if (!keepAliveAudioRef.current) {
      const audio = new Audio();
      audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAIA+AAABAAgAZGF0YQAAAAA=";
      audio.loop = true;
      keepAliveAudioRef.current = audio;
    }
    const startAlive = async () => {
      try {
        await keepAliveAudioRef.current?.play();
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "Smart Transcription Active",
          artist: "CST FlowDesk",
          album: "Live Capture"
        });
        navigator.mediaSession.playbackState = "playing";
      } catch (e) {}
    };
    startAlive();
    return () => { keepAliveAudioRef.current?.pause(); };
  }, [isListening]);

  const stopCapture = useCallback(() => {
    setIsListening(false);
    
    // Stop Smart Mode
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    
    onToggle?.(false);
  }, [onToggle]);

  const startCapture = useCallback(async () => {
    setError(null);
    try {
      // ─── SMART DICTATION MODE (Native SpeechRecognition) ─────────────────────
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        throw new Error("Smart Voice typing is not natively supported in this browser. Please use Chrome/Edge.");
      }
      
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      
      recognition.onresult = (event: any) => {
        let interimTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            const text = event.results[i][0].transcript;
            if (text.trim()) {
              onTranscriptionRef.current(text.trim());
            }
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        if (interimTranscript && onInterimRef.current) {
          onInterimRef.current(interimTranscript);
        } else if (!interimTranscript && onInterimRef.current) {
          onInterimRef.current("");
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech Recognition Error", event.error);
        if (event.error !== 'no-speech') {
          setError(`Microphone error: ${event.error}`);
          stopCapture();
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        onToggle?.(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
      onToggle?.(true);

    } catch (e: any) {
      console.error("Start capture error:", e);
      setError(e.message || "Could not start recording.");
    }
  }, [onToggle, stopCapture]);

  return (
    <div className="flex items-center gap-1.5 relative">
      <button
        onClick={isListening ? stopCapture : startCapture}
        disabled={disabled}
        title={isListening ? "Stop listening" : "Start listening"}
        className={`h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-lg transition-all border ${
          isListening
            ? "bg-red-500 hover:bg-red-600 text-white border-red-600 shadow-sm shadow-red-200 animate-pulse"
            : "bg-white text-slate-400 hover:bg-slate-50 border-slate-200"
        } disabled:opacity-50`}
      >
        {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
      </button>

      {/* Floating Status Indicator */}
      {isListening && (
        <div className="absolute left-[85px] top-1/2 -translate-y-1/2 flex flex-col pointer-events-none whitespace-nowrap z-20">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 border border-red-100 shadow-sm">
             <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
             <span className="text-[10px] text-red-600 font-bold uppercase tracking-wider">
               Listening...
             </span>
          </div>
        </div>
      )}
      
      {!isListening && error && (
        <div className="absolute left-[85px] top-1/2 -translate-y-1/2 text-[10px] text-red-500 font-medium whitespace-nowrap bg-white border border-red-100 px-2 py-1 rounded shadow-sm">
          {error}
        </div>
      )}
    </div>
  );
}
