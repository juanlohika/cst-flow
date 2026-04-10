"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastProcessedIndexRef = useRef(0);
  const isRecordingRef = useRef(false);

  const onTranscriptionRef = useRef(onTranscription);
  useEffect(() => { onTranscriptionRef.current = onTranscription; }, [onTranscription]);
  const wakeLockRef = useRef<any>(null);

  const applyDictionary = useCallback((text: string) => {
    return text
      .replace(/\b(turkey|starkey|tarkey|tar key)\b/gi, "Tarkie")
      .replace(/\b(filled up|fill up|field up|build up)\b/gi, "Field App");
  }, []);

  const transcriptionQueue = useRef<Blob[]>([]);
  const isProcessingRef = useRef(false);

  const processQueue = async () => {
    if (isProcessingRef.current || transcriptionQueue.current.length === 0) return;
    
    isProcessingRef.current = true;
    setIsProcessing(true);
    
    const blob = transcriptionQueue.current.shift();
    if (blob) {
      try {
        const formData = new FormData();
        formData.append("file", blob, "audio.webm");

        const res = await fetch("/api/audio/transcribe", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          if (data.text && data.text.trim()) {
            const corrected = applyDictionary(data.text);
            onTranscriptionRef.current(corrected);
          }
        }
      } catch (err) {
        console.error("Transcription error:", err);
      }
    }
    
    isProcessingRef.current = false;
    setIsProcessing(false);
    
    // Process next in queue if any
    if (transcriptionQueue.current.length > 0) {
      setTimeout(processQueue, 100);
    }
  };

  const stopCapture = useCallback(() => {
    isRecordingRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (wakeLockRef.current) {
      try { wakeLockRef.current.release(); } catch (e) {}
      wakeLockRef.current = null;
    }
    setIsListening(false);
    onToggle?.(false);
    transcriptionQueue.current = []; // Clear queue on stop
  }, [onToggle]);

  const startCapture = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      transcriptionQueue.current = [];
      isRecordingRef.current = true;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          
          // Every 5 seconds (5 * 1000ms), push to queue
          if (chunksRef.current.length >= 5) { 
              const blob = new Blob(chunksRef.current, { type: "audio/webm" });
              transcriptionQueue.current.push(blob);
              chunksRef.current = [];
              processQueue();
          }
        }
      };

      recorder.onstop = () => {
        if (chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          transcriptionQueue.current.push(blob);
          processQueue();
        }
      };

      // Start recording with 1-second chunks for dataavailability
      recorder.start(1000);
      setIsListening(true);
      onToggle?.(true);

      // Wake lock
      if ("wakeLock" in navigator) {
        try { wakeLockRef.current = await (navigator as any).wakeLock.request("screen"); } catch (e) {}
      }
    } catch (e: any) {
      console.error("Mic start error:", e);
      setError("Mic access denied or not found.");
    }
  }, [onToggle, applyDictionary]);

  useEffect(() => {
    return () => {
      if (isRecordingRef.current) stopCapture();
    };
  }, [stopCapture]);

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
        {isListening ? (
          isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MicOff className="h-3.5 w-3.5" />
        ) : (
          <Mic className="h-3.5 w-3.5" />
        )}
      </button>

      {isListening && (
        <div className="absolute right-[120%] top-1/2 -translate-y-1/2 flex flex-col pointer-events-none whitespace-nowrap">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 border border-red-100 shadow-sm">
             <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
             <span className="text-[10px] text-red-600 font-bold uppercase tracking-wider">
               {isProcessing ? "Processing..." : "Listening..."}
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
