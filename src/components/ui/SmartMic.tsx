"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, MonitorSpeaker, ChevronDown } from "lucide-react";

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
  const [showMenu, setShowMenu] = useState(false);

  // Refs for logic
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const onTranscriptionRef = useRef(onTranscription);
  useEffect(() => { onTranscriptionRef.current = onTranscription; }, [onTranscription]);

  // Keep-Alive audio to prevent tab throttling
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
    setIsListening(false);
    setShowMenu(false);
    setError(null);
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    onToggle?.(false);
  }, [onToggle]);

  const startCapture = async (source: "mic" | "system") => {
    setError(null);
    setShowMenu(false);
    try {
      let stream;
      if (source === "system") {
        // Native System Sound Capture for Online Meetings
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: "browser" },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        // Stop video immediately, we only want the audio track
        stream.getVideoTracks().forEach(track => track.stop());
        const audioTracks = stream.getAudioTracks();
        if (!audioTracks.length) {
          throw new Error("No system audio selected. Be sure to check 'Share tab audio'.");
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      streamRef.current = stream;
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;

      let chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        if (chunks.length === 0) return;
        const blob = new Blob(chunks, { type: "audio/webm" });
        chunks = []; // Reset

        // Send to Whisper Server API
        const formData = new FormData();
        formData.append("audio", blob, "chunk.webm");
        try {
          const res = await fetch("/api/transcribe", { method: "POST", body: formData });
          if (res.ok) {
            const data = await res.json();
            if (data.text && data.text.trim()) {
              onTranscriptionRef.current(data.text.trim());
            }
          }
        } catch (err) {
          console.error("Whisper API Error", err);
        }
      };

      // Slice audio every 10 seconds and restart recorder to stream transcription 
      // without causing memory leaks or heavy DOM hangups
      mediaRecorder.start();
      
      timerRef.current = setInterval(() => {
        if (mediaRecorder.state === "recording") {
          mediaRecorder.requestData();
          mediaRecorder.stop();
          mediaRecorder.start();
        }
      }, 10000); // 10s chunks

      // Auto-stop if user stops sharing the OS audio
      stream.getTracks().forEach(track => {
        track.onended = () => {
          if (isListening) stopCapture();
        };
      });

      setIsListening(true);
      onToggle?.(true);

    } catch (e: any) {
      console.error("Start capture error:", e);
      setError(e.message || "Could not start recording.");
    }
  };

  return (
    <div className="flex items-center gap-1 relative">
      <div className={`flex items-center rounded-lg border transition-all ${
          isListening
            ? "bg-red-500 border-red-600 shadow-sm shadow-red-200"
            : "bg-white border-slate-200"
        }`}>
        
        <button
          onClick={() => isListening ? stopCapture() : setShowMenu(!showMenu)}
          disabled={disabled}
          title={isListening ? "Stop listening" : "Start listening"}
          className={`h-8 px-2 flex items-center justify-center rounded-l-lg transition-colors ${
            isListening ? "text-white hover:bg-red-600" : "text-slate-400 hover:bg-slate-50"
          } disabled:opacity-50`}
        >
          {isListening ? <MicOff className="h-4 w-4 animate-pulse" /> : <Mic className="h-4 w-4" />}
        </button>

        {!isListening && (
          <button
            onClick={() => setShowMenu(!showMenu)}
            disabled={disabled}
            className="h-8 w-5 flex items-center justify-center border-l border-slate-200 text-slate-400 hover:bg-slate-50 rounded-r-lg disabled:opacity-50"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Input Source Menu */}
      {showMenu && !isListening && (
        <div className="absolute top-10 right-0 w-48 bg-white border border-slate-200 shadow-xl rounded-xl overflow-hidden z-50">
          <button onClick={() => startCapture("mic")} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 text-left font-medium border-b border-slate-100">
            <Mic className="h-4 w-4 text-[#2162F9]" /> Device Mic
          </button>
          <button onClick={() => startCapture("system")} className="w-full flex items-start gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 text-left">
            <MonitorSpeaker className="h-4 w-4 text-emerald-500 mt-0.5" />
            <div>
              <p className="font-medium">System Sound</p>
              <p className="text-[10px] text-slate-400 leading-tight mt-1">Transcribe online meetings by sharing a Tab with audio.</p>
            </div>
          </button>
        </div>
      )}

      {/* Floating Status Indicator */}
      {isListening && (
        <div className="absolute right-[100%] mr-2 top-1/2 -translate-y-1/2 flex flex-col pointer-events-none whitespace-nowrap z-20">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 border border-red-100 shadow-sm">
             <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
             <span className="text-[10px] text-red-600 font-bold uppercase tracking-wider">
               Recording (10s blocks)
             </span>
          </div>
        </div>
      )}
      
      {!isListening && error && (
        <div className="absolute right-[100%] mr-2 top-1/2 -translate-y-1/2 text-[10px] text-red-500 font-medium whitespace-nowrap bg-white border border-red-100 px-2 py-1 rounded shadow-sm">
          {error}
        </div>
      )}
    </div>
  );
}
