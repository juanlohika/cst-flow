"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, MonitorSpeaker, Laptop } from "lucide-react";

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
  const [captureSystem, setCaptureSystem] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Refs for logic
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamsRef = useRef<{ mic?: MediaStream; system?: MediaStream }>({});
  
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

  // ── Transcription Uploader ──────────────────────────────────────────────────
  const uploadAudio = async (blob: Blob) => {
    try {
      const formData = new FormData();
      formData.append("audio", blob);
      
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });
      
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      
      if (data.text && data.text.trim()) {
        onTranscriptionRef.current(data.text.trim());
        setInterimText(""); // Clear interim once final chunk is processed
      }
    } catch (e) {
      console.error("Transcription upload error:", e);
    }
  };

  const stopCapture = useCallback(() => {
    setIsListening(false);
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    // Stop all tracks
    Object.values(streamsRef.current).forEach(s => {
      s?.getTracks().forEach(t => t.stop());
    });
    streamsRef.current = {};
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    onToggle?.(false);
  }, [onToggle]);

  const startCapture = useCallback(async () => {
    setError(null);
    try {
      // 1. Get Microphone
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamsRef.current.mic = micStream;

      let finalStream = micStream;

      // 2. Get System Audio (if enabled)
      if (captureSystem) {
        try {
          const systemStream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: 1, height: 1 }, // Required to trigger picker
            audio: true,
          });
          streamsRef.current.system = systemStream;

          // Check if user shared audio
          if (systemStream.getAudioTracks().length === 0) {
            systemStream.getTracks().forEach(t => t.stop());
            throw new Error("No audio shared. Ensure 'Share Audio' is checked.");
          }

          // 3. Mix Streams using AudioContext
          const ctx = new AudioContext();
          audioCtxRef.current = ctx;
          const dest = ctx.createMediaStreamDestination();
          
          const micSource = ctx.createMediaStreamSource(micStream);
          const systemSource = ctx.createMediaStreamSource(systemStream);
          
          micSource.connect(dest);
          systemSource.connect(dest);
          
          finalStream = dest.stream;
        } catch (e: any) {
          if (e.name === "NotAllowedError") {
            setError("Meeting audio cancelled.");
          } else {
            setError(e.message || "Failed to capture system audio.");
          }
          // Cleanup mic if system failed
          micStream.getTracks().forEach(t => t.stop());
          return;
        }
      }

      // 4. Setup MediaRecorder
      const recorder = new MediaRecorder(finalStream, { mimeType: "audio/webm" });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          uploadAudio(e.data);
        }
      };

      // Record in 4-second slices for near-real-time feedback
      recorder.start(4000); 
      setIsListening(true);
      onToggle?.(true);

    } catch (e: any) {
      console.error("Start capture error:", e);
      setError("Could not start recording.");
    }
  }, [captureSystem, onToggle]);

  return (
    <div className="flex items-center gap-1.5 relative">
      {/* Mode Toggle Button */}
      <button
        onClick={() => setCaptureSystem(!captureSystem)}
        disabled={isListening}
        title={captureSystem ? "Switch to Mic Only" : "Switch to Meeting Mode (Inc. System Audio)"}
        className={`h-8 px-2 flex items-center gap-1.5 rounded-lg border transition-all ${
          captureSystem 
            ? "bg-indigo-50 border-indigo-200 text-indigo-600 shadow-sm" 
            : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
        } disabled:opacity-50 text-[10px] font-medium`}
      >
        {captureSystem ? (
          <>
            <MonitorSpeaker className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Meeting</span>
          </>
        ) : (
          <>
            <Laptop className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Normal</span>
          </>
        )}
      </button>

      {/* Main Action Button */}
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
               {captureSystem ? "Recording Meeting..." : "Listening..."}
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
