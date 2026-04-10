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
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null); 
  const intentToListen = useRef(false);

  const onTranscriptionRef = useRef(onTranscription);
  const onInterimRef = useRef(onInterim);

  const applyDictionary = useCallback((text: string) => {
    return text
      .replace(/\b(turkey|starkey|tarkey|tar key)\b/gi, "Tarkie")
      .replace(/\b(filled up|fill up|field up|build up)\b/gi, "Field App");
  }, []);

  useEffect(() => { onTranscriptionRef.current = onTranscription; }, [onTranscription]);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);

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
    keepAliveAudioRef.current?.play().catch(console.error);
    return () => { keepAliveAudioRef.current?.pause(); };
  }, [isListening]);

  const stopCapture = useCallback(() => {
    intentToListen.current = false;
    setIsListening(false);
    setError(null);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      recognitionRef.current = null;
    }
    onToggle?.(false);
  }, [onToggle]);

  const startCapture = useCallback(async () => {
    setError(null);
    intentToListen.current = true;
    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        throw new Error("Smart Voice typing is not natively supported in this browser. Please use Chrome/Edge.");
      }
      
      const recognition = new SpeechRecognition();
      recognition.continuous = false; // Fast restarts prevent memory crashes in Chrome.
      recognition.interimResults = true;
      
      let lastInterimUpdate = 0;
      let lastInterimText = "";

      recognition.onresult = (event: any) => {
        let interimTranscript = "";
        let finalTranscript = "";
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          const correctedText = applyDictionary(finalTranscript);
          if (correctedText.trim()) {
            onTranscriptionRef.current(correctedText.trim());
          }
        }

        if (interimTranscript) {
          const now = Date.now();
          if (interimTranscript !== lastInterimText && now - lastInterimUpdate > 200) {
             // CRITICAL FIX: Skip interim updates if tab is hidden to prevent React queue lockups
             if (onInterimRef.current && typeof document !== "undefined" && !document.hidden) {
                 onInterimRef.current(interimTranscript);
             }
             lastInterimText = interimTranscript;
             lastInterimUpdate = now;
          }
        } else if (!interimTranscript && lastInterimText) {
          if (onInterimRef.current && typeof document !== "undefined" && !document.hidden) {
              onInterimRef.current("");
          }
          lastInterimText = "";
          lastInterimUpdate = Date.now();
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech' || event.error === 'aborted' || event.error === 'network') {
          return;
        }
        console.error("Speech Recognition Error", event.error);
        setError(`Mic error: ${event.error}`);
        stopCapture();
      };

      recognition.onend = () => {
        if (intentToListen.current && recognitionRef.current) {
          // Add timeout to prevent synchronous loop freeze when Chrome aborts background tabs
          setTimeout(() => {
             try { recognitionRef.current?.start(); } catch (e) {}
          }, 150);
        } else {
          setIsListening(false);
          onToggle?.(false);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
      onToggle?.(true);

    } catch (e: any) {
      console.error("Start capture error:", e);
      setError(e.message || "Could not start recording.");
      intentToListen.current = false;
    }
  }, [onToggle, stopCapture, applyDictionary]);

  return (
    <div className="flex items-center gap-1.5 relative z-50">
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

      {isListening && (
        <div className="absolute right-[120%] top-1/2 -translate-y-1/2 flex flex-col pointer-events-none whitespace-nowrap">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 border border-red-100 shadow-sm">
             <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
             <span className="text-[10px] text-red-600 font-bold uppercase tracking-wider">
               Listening
             </span>
          </div>
        </div>
      )}
      
      {!isListening && error && (
        <div className="absolute right-[120%] top-1/2 -translate-y-1/2 text-[10px] text-red-500 font-medium whitespace-nowrap bg-white border border-red-100 px-2 py-1 rounded shadow-sm">
          {error}
        </div>
      )}
    </div>
  );
}
