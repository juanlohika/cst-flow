"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Timer,
  Users,
  Square,
  FileText,
  GitBranch,
  CheckSquare2,
  Loader2,
  RefreshCw,
  Check,
  Mic,
  ExternalLink,
  X,
  PenLine,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import SmartMic from "@/components/ui/SmartMic";
import AuthGuard from "@/components/auth/AuthGuard";
import MeetingTour, { TourStep } from "@/components/ui/MeetingTour";
import { useToast } from "@/components/ui/ToastContext";
import { formatRef } from "@/lib/utils/format";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MinutesState {
  keyAgreements: string[];
  discussionPoints: string[];
  actionItems: { task: string; owner: string }[];
  openQuestions: string[];
  parkingLot: string[];
  clarificationsRequired: string[];
}

interface BRDState {
  requirements: { text: string; type: string }[];
  suggestedQuestions: (string | { question: string; options: string[] })[];
}

interface ChecklistItem {
  id: string;
  question: string;
  category?: string;
  purpose?: string;
  checked: boolean;
}

interface MemberUser { id: string; name: string; email: string; }
interface MemberRole { id: string; name: string; }

// ─── Page export ──────────────────────────────────────────────────────────────

export default function LiveMeetingPage() {
  return (
    <AuthGuard>
      <LiveMeetingRoom />
    </AuthGuard>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function LiveMeetingRoom() {
  const { showToast } = useToast();
  const params = useParams();
  const router = useRouter();
  const meetingId = params.id as string;
  const { setBreadcrumbs } = useBreadcrumbs();

  // Meeting data
  const [meeting, setMeeting] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const meetingRef = useRef<any>(null);


  // Transcript — each element is one finalized speech utterance or an AI suggestion
  const [transcript, setTranscript] = useState<(string | { type: "ai"; text: string })[]>([]);
  const transcriptRef = useRef<(string | { type: "ai"; text: string })[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Right panel tabs
  const [activePanel, setActivePanel] = useState<"minutes" | "brd" | "flowchart" | "insights">("minutes");

  // BRD question tracking (keyed by question text)
  const [checkedQuestions, setCheckedQuestions] = useState<Set<string>>(new Set());
  const [dismissedQuestions, setDismissedQuestions] = useState<Set<string>>(new Set());

  // Inline transcript preview (interim speech before final commit)
  const [interimText, setInterimText] = useState("");

  // Notes
  const [notes, setNotes] = useState("");

  // Minutes panel
  const emptyMinutes: MinutesState = {
    keyAgreements: [],
    discussionPoints: [],
    actionItems: [],
    openQuestions: [],
    parkingLot: [],
    clarificationsRequired: [],
  };
  const [minutesState, setMinutesState] = useState<MinutesState>(emptyMinutes);
  const minutesStateRef = useRef<MinutesState>(emptyMinutes);
  const [isUpdatingMinutes, setIsUpdatingMinutes] = useState(false);
  const [minutesLastUpdated, setMinutesLastUpdated] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error" | "quota">("idle");

  // BRD panel
  const emptyBrd: BRDState = { requirements: [], suggestedQuestions: [] };
  const [brdState, setBrdState] = useState<BRDState>(emptyBrd);
  const brdStateRef = useRef<BRDState>(emptyBrd);
  const [isUpdatingBrd, setIsUpdatingBrd] = useState(false);
  const [brdLastUpdated, setBrdLastUpdated] = useState<number | null>(null);

  // Indicators mapping: tracks total count when tab was last active
  const [lastSeenCounts, setLastSeenCounts] = useState<Record<string, number>>({
    insights: 0,
    brd: 0
  });

  // Effect to reset counts when switching tabs
  useEffect(() => {
    if (activePanel === "insights") {
      setLastSeenCounts(prev => ({ ...prev, insights: minutesState.clarificationsRequired?.length || 0 }));
    } else if (activePanel === "brd") {
      setLastSeenCounts(prev => ({ ...prev, brd: brdState.requirements?.length + brdState.suggestedQuestions?.length || 0 }));
    }
  }, [activePanel, minutesState.clarificationsRequired?.length, brdState.requirements?.length, brdState.suggestedQuestions?.length]);

  // Flowchart panel
  const [isGeneratingFlowchart, setIsGeneratingFlowchart] = useState(false);
  const [flowchartResult, setFlowchartResult] = useState<string | null>(null);
  const [flowContext, setFlowContext] = useState<"as-is" | "to-be">("as-is");
  const [savedFlowchartId, setSavedFlowchartId] = useState<string | null>(null);

  // Left panel: checklist + anticipated requirements
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [anticipatedReqs, setAnticipatedReqs] = useState<any[]>([]);

  // AI update tracking
  const lastProcessedIndexRef = useRef(0);

  // API key (loaded from settings, used for flowchart generation)
  const [geminiKey, setGeminiKey] = useState("");

  // End meeting
  const [isEnding, setIsEnding] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [isVerifyingTasks, setIsVerifyingTasks] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationStep, setVerificationStep] = useState<"minutes" | "tasks">("minutes");
  const [verifiedTasks, setVerifiedTasks] = useState<{ task: string; owner: string; plannedStart?: string; plannedEnd?: string }[]>([]);
  const [members, setMembers] = useState<{ users: MemberUser[]; roles: MemberRole[] }>({ users: [], roles: [] });
  const notesRef = useRef("");
  const lastNotesRef = useRef("");

  // Tour
  const [showTour, setShowTour] = useState(false);
  const tourSteps: TourStep[] = [
    { targetId: "tour-header", title: "Live Meeting Room", content: "Welcome! This is your live workspace where AI assists you in real-time.", placement: "bottom" },
    { targetId: "tour-smartmic", title: "SmartMic™", content: "Start recording here. The AI will transcribe and analyze your discussion instantly.", placement: "right" },
    { targetId: "tour-agenda", title: "Meeting Agenda", content: "Keep track of your goals and prep checklist here on the left sidebar.", placement: "right" },
    { targetId: "tour-panels", title: "AI Intelligence", content: "Switch between Minutes, BRD, and Flowcharts. The AI updates these as you talk!", placement: "left" },
    { targetId: "tour-update", title: "Manual Sync", content: "Click here any time to force the AI to rethink and update all panels immediately.", placement: "bottom" },
    { targetId: "tour-end", title: "Verify & Close", content: "Ready to wrap up? Click here to review and verify all AI-identified next steps before finalizing the meeting.", placement: "bottom" }
  ];

  // ─── Load data ────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/users/members")
      .then(r => r.ok ? r.json() : { users: [], roles: [] })
      .then(setMembers)
      .catch(() => {});
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/meetings/${meetingId}`);
        if (!res.ok) {
          router.replace("/meetings");
          return;
        }
        const data = await res.json();
        
        // Ensure activeApps is an array (might be a JSON string from DB via raw SQL)
        if (typeof data.activeApps === "string") {
          try { data.activeApps = JSON.parse(data.activeApps); } 
          catch { data.activeApps = []; }
        }
        if (!Array.isArray(data.activeApps)) data.activeApps = [];

        setMeeting(data);
        meetingRef.current = data;

        // Parse prep checklist from linked prep session
        const prep = data.meetingPrepSession;
        if (prep?.questionnaireContent) {
          try {
            const parsed = JSON.parse(prep.questionnaireContent);
            const items: ChecklistItem[] = [];
            if (Array.isArray(parsed)) {
              parsed.forEach((q: any, i: number) => {
                items.push({
                  id: q.id || `q-${i}`,
                  question:
                    typeof q === "string"
                      ? q
                      : q.question || q.text || String(q),
                  category: q.category,
                  purpose: q.purpose,
                  checked: false,
                });
              });
            }
            setChecklistItems(items);
          } catch {}
        }

        // Parse anticipated requirements
        if (prep?.anticipatedRequirements) {
          try {
            const reqs = JSON.parse(prep.anticipatedRequirements);
            setAnticipatedReqs(Array.isArray(reqs) ? reqs : []);
          } catch {}
        }

        // Restore transcript from DB
        try {
          const tRes = await fetch(`/api/meetings/${meetingId}/transcribe`);
          if (tRes.ok) {
            const tData = await tRes.json();
            if (tData.transcript?.rawTranscript) {
              const lines = tData.transcript.rawTranscript.split("\n").filter((l: string) => l.trim().length > 0);
              setTranscript(lines);
              transcriptRef.current = lines;
              lastProcessedIndexRef.current = lines.length;
            }
          }
        } catch (err) {
          console.error("Failed to load transcript:", err);
        }

        // Restore notes from localStorage
        const savedNotes = localStorage.getItem(`meeting-notes-${meetingId}`);
        if (savedNotes) setNotes(savedNotes);

        // Load API key for flowchart generation (matches where admin settings saves it)
        // Key no longer needed — server uses config.json provider

        // Mark meeting as in-progress
        fetch(`/api/meetings/${meetingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "in-progress" }),
        }).catch(() => {});
      } catch (err) {
        console.error("Failed to load meeting:", err);
        router.replace("/meetings");
      } finally {
        setLoading(false);
      }
    }
    load();

    // Set standard breadcrumbs
    setBreadcrumbs([
      { label: "AI Intelligence", href: "/meetings" },
      { label: "Live Hub", href: "/meetings" },
      { label: meetingRef.current?.title || "Active Meeting" }
    ]);

    // Show tour if first time
    const hasSeenTour = localStorage.getItem("cst-live-tour-seen");
    if (!hasSeenTour) {
      setTimeout(() => setShowTour(true), 1500);
    }
  }, [meetingId, router, setBreadcrumbs]);

  // ─── Timer ────────────────────────────────────────────────────────────────

  // ── Timer ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Browser "Keep-Alive" (Media Session & Silent Audio) ─────────────────────
  // This prevents Chrome/Safari from putting the tab to sleep during long meetings
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;

    // 1. Silent Audio Heartbeat - Singleton via Ref
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAIA+AAABAAgAZGF0YQAAAAA=";
      audioRef.current.loop = true;
    }
    const audio = audioRef.current;
    
    const startKeepAlive = async () => {
      try {
        await audio.play();
        // 2. Media Session Metadata (tells OS this is an active "call")
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "Live Meeting Hub",
          artist: "CST OS",
          album: meetingRef.current?.title || "Active Session",
        });
        navigator.mediaSession.playbackState = "playing";
      } catch (err) {
        console.warn("Keep-alive failed to start (requires user interaction):", err);
      }
    };

    // Trigger after short delay to ensure browser allows audio play context
    const timer = setTimeout(startKeepAlive, 2000);
    return () => {
      clearTimeout(timer);
      if (audio) audio.pause();
    };
  }, [meeting?.title]);

  // ─── Auto-scroll transcript ───────────────────────────────────────────────

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.length]);

  // ─── Transcription callback ───────────────────────────────────────────────

  const handleTranscription = useCallback((text: string) => {
    setInterimText("");
    setTranscript((prev) => {
      const next = [...prev, text];
      transcriptRef.current = next;
      return next;
    });

    // Autosave utterance to DB immediately
    fetch(`/api/meetings/${meetingId}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(err => console.error("Auto-sync failed:", err));
  }, [meetingId]);

  const handleInterim = useCallback((text: string) => {
    setInterimText(text);
  }, []);
  
  const enableTool = async (appSlug: string) => {
    const nextApps = [...(meeting?.activeApps || []), appSlug];
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeApps: nextApps })
      });
      if (res.ok) {
        showToast("Tool enabled successfully", "success");
        setMeeting({ ...meeting, activeApps: nextApps });
      } else {
        showToast("Failed to enable tool", "error");
      }
    } catch {
      showToast("Network error", "error");
    }
  };

  // ─── AI panel updates ─────────────────────────────────────────────────────

  const buildPrepContext = useCallback(() => {
    const prep = meetingRef.current?.meetingPrepSession;
    if (!prep?.questionnaireContent) return undefined;
    try {
      return { questionnaire: JSON.parse(prep.questionnaireContent) };
    } catch {
      return undefined;
    }
  }, []);

  const fireAIUpdates = useCallback(
    (newText: string) => {
      const m = meetingRef.current;
      const prepContext = buildPrepContext();

      // Always update minutes
      triggerPanel("minutes", newText);

      // Only update BRD if enabled for this meeting
      if (m?.brdMakerEnabled) {
        triggerPanel("brd", newText);
      }
    },
    [buildPrepContext] // eslint-disable-line
  );

  const triggerPanel = async (
    panel: "minutes" | "brd",
    textToSend?: string,
    stateOverride?: any,
    isFullSync = false
  ) => {
    if (panel === "minutes") {
      setIsUpdatingMinutes(true);
      setSyncStatus("syncing");
    } else {
      setIsUpdatingBrd(true);
    }

    const currentTranscript = transcriptRef.current;
    // If textToSend is provided, use it. Otherwise, if isFullSync, use entire transcript. 
    // Otherwise, use slice from lastProcessedIndex.
    const finalText = textToSend !== undefined 
      ? textToSend 
      : (isFullSync 
          ? currentTranscript.map(t => (typeof t === 'string' ? t : t.text)).join("\n")
          : currentTranscript.slice(lastProcessedIndexRef.current).join("\n")
        );
    
    const finalState = stateOverride || (panel === "minutes" ? minutesStateRef.current : brdStateRef.current);
    const prepContext = buildPrepContext();

    try {
      const res = await fetch(`/api/meetings/${meetingId}/live-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panel, newTranscript: finalText, currentState: finalState, prepContext, notes }),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        setSyncStatus("error");
        showToast(errorData.error || `AI update failed for ${panel}`, "error");
        return;
      }
      
      const data = await res.json();
      
      if (data.reason === 'quota' || data.skipped) {
        setSyncStatus(data.reason === 'quota' ? "quota" : "error");
        if (data.reason === 'quota') showToast("AI Quota reached. Content extraction might be incomplete.", "error");
        return;
      }
      
      if (!data.state) {
        setSyncStatus("error");
        return;
      }

      setSyncStatus("success");
      setTimeout(() => setSyncStatus("idle"), 3000);

      if (panel === "minutes") {
        setMinutesState(data.state);
        minutesStateRef.current = data.state;
        setMinutesLastUpdated(Date.now());
        
        // Inject new clarifications - BATCHED for performance
        if (data.state.clarificationsRequired?.length > (finalState?.clarificationsRequired?.length || 0)) {
          const newQuestions = data.state.clarificationsRequired.slice(finalState?.clarificationsRequired?.length || 0);
          if (newQuestions.length > 0) {
            setTranscript(prev => {
              const additions = newQuestions.map((q: string) => ({ type: "ai" as const, text: q }));
              const next = [...prev, ...additions];
              transcriptRef.current = next;
              return next;
            });
          }
        }
      } else {
        setBrdState(data.state);
        brdStateRef.current = data.state;
        setBrdLastUpdated(Date.now());
      }

      // Update index even on full sync to "exhaust" current content
      lastProcessedIndexRef.current = currentTranscript.length;
      if (textToSend === undefined) {
        lastNotesRef.current = notes;
      }
    } catch (err: any) {
      console.error(`${panel} update failed:`, err);
      setSyncStatus("error");
      showToast(err.message || "Network error during AI sync", "error");
    } finally {
      if (panel === "minutes") setIsUpdatingMinutes(false);
      else setIsUpdatingBrd(false);
    }
  };

  // ─── Periodic AI panel update (every 20 seconds) ─────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      // PAUSE BACKGROUND SYNC during verification to save memory and prevent loops
      if (isVerifyingTasks || isEnding) return;

      const current = transcriptRef.current;
      const lastIdx = lastProcessedIndexRef.current;
      const currentNotes = notesRef.current; 
      
      const transcriptChanged = current.length > lastIdx;
      const notesChanged = currentNotes !== lastNotesRef.current;

      if (!transcriptChanged && !notesChanged) return;

      const newItems = transcriptChanged ? current.slice(lastIdx) : [];
      const newText = newItems.map(t => typeof t === 'string' ? t : t.text).join(" ").trim();
      
      // GUARD: Only fire if there is actual content to process
      if (!newText && currentNotes === lastNotesRef.current) return;

      lastProcessedIndexRef.current = current.length;
      lastNotesRef.current = currentNotes;
      
      fireAIUpdates(newText);
    }, 20000);

    return () => clearInterval(id);
  }, [isVerifyingTasks, isEnding, fireAIUpdates]);

  // Manual "Update AI" button — immediately processes all unprocessed transcript
  const handleManualUpdate = () => {
    const current = transcriptRef.current;
    if (current.length === 0) return;

    // Include everything since last processed, or all if nothing processed yet
    const newItems = current.slice(lastProcessedIndexRef.current);
    const text = (newItems.length > 0 ? newItems : current).join(" ").trim();
    lastProcessedIndexRef.current = current.length;
    fireAIUpdates(text);
  };

  // ─── Flowchart generation ─────────────────────────────────────────────────

  const generateFlowchart = async () => {
    const current = transcriptRef.current;
    if (current.length === 0) return;
    setIsGeneratingFlowchart(true);
    setFlowchartResult(null);

    // Use the last 10 utterances for focused context
    const contextLines = current.slice(-10).join(" ");

    try {
      const res = await fetch("/api/architect/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Generate a ${flowContext === 'as-is' ? 'Current State (As-Is)' : 'Future State (To-Be)'} process flowchart based on this live meeting discussion:\n\n${contextLines}`,
          diagramType: "flowchart",
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      // The architect API can return mermaid text or react-flow JSON
      const display =
        data.mermaid ||
        data.diagram ||
        (data.nodes ? JSON.stringify(data, null, 2) : null) ||
        "No diagram generated.";
      setFlowchartResult(display);
      if (data.id) setSavedFlowchartId(data.id);
    } catch (err) {
      console.error("Flowchart generation failed:", err);
    } finally {
      setIsGeneratingFlowchart(false);
    }
  };

  // ─── End meeting ──────────────────────────────────────────────────────────

  const endMeeting = async () => {
    setIsEnding(true);

    try {
      const res = await fetch(`/api/meetings/${meetingId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes,
          flowchartResult,
          flowContext,
          verifiedTasks // Send the array (empty or not)
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to process meeting");
      }

      showToast("Meeting finalized successfully", "success");
      router.push(`/meetings/${meetingId}/review`);
    } catch (err: any) {
      console.error("Meeting process error:", err);
      showToast(err.message || "An error occurred while finalizing the meeting. Please try again.", "error");
      setIsEnding(false);
    }
  };

  const startVerification = async () => {
    setIsVerifying(true);
    
    // Always perform a fresh full sync before entering verification to ensure no content is missed
    try {
      await triggerPanel("minutes", undefined, undefined, true);
    } catch (err) {
      console.error("Verification sync failed:", err);
    }

    const now = new Date().toISOString().split('T')[0];
    setVerifiedTasks((minutesStateRef.current.actionItems || []).map(a => ({
      ...a,
      plannedStart: now,
      plannedEnd: now
    })));
    setVerificationStep("minutes");
    setIsVerifyingTasks(true);
    setIsVerifying(false);
  };


  // ─── Helpers ──────────────────────────────────────────────────────────────

  const toggleChecklist = (id: string) => {
    setChecklistItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    );
  };

  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<number>>(new Set());

  const acceptSuggestion = (index: number, text: string) => {
    // Add to BRD requirements locally
    const newReq = { text, type: "functional" };
    const nextBrd = { 
      ...brdState, 
      requirements: [...brdState.requirements, newReq] 
    };
    setBrdState(nextBrd);
    brdStateRef.current = nextBrd;
    
    // Mark as accepted to hide button
    setAcceptedSuggestions(prev => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });

    showToast("Requirement accepted and added to BRD", "success");
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0)
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const timeSince = (ts: number) => {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60) return `${secs}s ago`;
    return `${Math.floor(secs / 60)}m ago`;
  };

  const hasMinutes =
    minutesState.keyAgreements.length > 0 ||
    minutesState.discussionPoints.length > 0 ||
    minutesState.actionItems.length > 0 ||
    minutesState.openQuestions.length > 0;

  // ─── Loading state ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fixed inset-0 bg-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-[13px] text-[#717680]">
          <Loader2 className="w-4 h-4 animate-spin" />
          Starting live meeting room…
        </div>
      </div>
    );
  }

  if (!meeting) return null;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="relative flex flex-col h-full overflow-hidden bg-white"
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      {/* ━━━ HEADER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div
        className="h-10 flex-shrink-0 flex items-center gap-3 px-4 border-b"
        style={{ borderColor: "#E9EAEB", background: "#FFFFFF" }}
      >
        {/* Live pill */}
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-red-500 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          LIVE
        </span>

        {/* Meeting title */}
        <div className="flex-1 flex flex-col min-w-0">
          <span
            className="text-[13px] font-semibold truncate"
            style={{ color: "#252B37" }}
          >
            {meeting.title}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
              {formatRef(meetingId, "MTG")}
            </span>
            {meeting.companyName && (
              <>
                <span className="w-0.5 h-0.5 rounded-full bg-slate-300" />
                <span
                  className="text-[10px] font-medium hidden sm:inline"
                  style={{ color: "#717680" }}
                >
                  {meeting.companyName}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Timer */}
        <div
          className="flex items-center gap-1 text-[12px] font-mono flex-shrink-0"
          style={{ color: "#535862" }}
        >
          <Timer className="w-3.5 h-3.5" />
          {formatTime(elapsedSeconds)}
        </div>

        {/* Attendee count */}
        <div
          className="flex items-center gap-1 text-[12px] flex-shrink-0"
          style={{ color: "#535862" }}
        >
          <Users className="w-3.5 h-3.5" />
          {meeting.attendees?.length ?? 0}
        </div>

        {/* Tour trigger */}
        <button
          onClick={() => setShowTour(true)}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-primary transition-colors"
          title="Show walkthrough"
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>

        {/* Sync Status Badge */}
        {syncStatus !== "idle" && (
          <div
            className={`h-6 px-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider rounded border transition-all animate-in fade-in slide-in-from-right-2`}
            style={{
              background:
                syncStatus === "syncing" ? "#F5F8FF" :
                syncStatus === "success" ? "#ECFDF5" :
                syncStatus === "quota" ? "#FFF7ED" : "#FEF2F2",
              color:
                syncStatus === "syncing" ? "#2162F9" :
                syncStatus === "success" ? "#059669" :
                syncStatus === "quota" ? "#EA580C" : "#DC2626",
              borderColor:
                syncStatus === "syncing" ? "#D1E0FF" :
                syncStatus === "success" ? "#A7F3D0" :
                syncStatus === "quota" ? "#FFEDD5" : "#FECACA",
            }}
          >
            {syncStatus === "syncing" && (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Syncing AI...
              </>
            )}
            {syncStatus === "success" && (
              <>
                <Check className="w-3 h-3" />
                Updated
              </>
            )}
            {syncStatus === "quota" && (
              <>
                <Lightbulb className="w-3 h-3" />
                Memory Full
              </>
            )}
            {syncStatus === "error" && (
              <>
                <X className="w-3 h-3" />
                Sync Failed
              </>
            )}
          </div>
        )}

        {/* Manual AI update */}
        <button
          id="tour-update"
          onClick={handleManualUpdate}
          disabled={transcript.length === 0 || isUpdatingMinutes || isUpdatingBrd}
          title="Trigger AI panel update now (also runs automatically every 20s)"
          className="h-6 px-2.5 flex items-center gap-1 text-[11px] font-medium rounded border transition-colors flex-shrink-0 disabled:opacity-40"
          style={{
            color: "#535862",
            borderColor: "#E9EAEB",
            background: "#FFFFFF",
          }}
        >
          <RefreshCw
            className={`w-3 h-3 ${
              isUpdatingMinutes || isUpdatingBrd ? "animate-spin" : ""
            }`}
          />
          Update AI
        </button>

        {/* End meeting */}
        {!confirmEnd ? (
          <button
            id="tour-end"
            onClick={() => setConfirmEnd(true)}
            disabled={isEnding}
            className="h-6 px-3 flex items-center gap-1.5 text-[11px] font-semibold text-white rounded transition-colors flex-shrink-0 disabled:opacity-60"
            style={{ background: "#EF4444" }}
          >
            <Square className="w-3 h-3 fill-current" />
            End Meeting
          </button>
        ) : (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[11px] text-slate-500 font-medium">Verify completion?</span>
            <button
              onClick={startVerification}
              disabled={isVerifying}
              className="h-6 px-3 text-[11px] font-semibold bg-red-500 text-white rounded hover:bg-red-600 transition-all active:scale-95 flex items-center gap-1.5 disabled:opacity-60"
            >
              {isVerifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {isVerifying ? "Processing..." : "Start Verification"}
            </button>
            <button
              id="tour-wait"
              onClick={() => setConfirmEnd(false)}
              className="h-6 px-2.5 text-[11px] font-medium border border-slate-200 rounded hover:bg-slate-50 transition-colors"
            >
              Wait
            </button>
          </div>
        )}
      </div>

      {/* ━━━ BODY (3 columns) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT: Prep Checklist ─────────────────────────────────────────── */}
        <div
          className="w-64 flex-shrink-0 flex flex-col overflow-hidden border-r"
          style={{ borderColor: "#E9EAEB" }}
        >
          {/* SmartMic */}
          <div
            id="tour-smartmic"
            className="p-3 border-b flex-shrink-0"
            style={{ borderColor: "#E9EAEB" }}
          >
            <SmartMic
              onTranscription={handleTranscription}
              onInterim={handleInterim}
              meetingId={meetingId}
            />
          </div>

          {/* Manual Agenda (if provided) */}
          {meeting?.customAgenda && (
            <div id="tour-agenda" className="p-3 border-b bg-primary/5" style={{ borderColor: "#E9EAEB" }}>
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5 text-primary">Meeting Agenda</p>
              <div className="text-[11px] text-text-primary whitespace-pre-wrap leading-relaxed">
                {meeting?.customAgenda}
              </div>
            </div>
          )}

          {/* Scrollable checklist area */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4" style={{ scrollbarWidth: "thin" }}>
            {checklistItems.length > 0 && (
              <section>
                <p
                  className="text-[10px] font-semibold uppercase tracking-wide mb-2"
                  style={{ color: "#717680" }}
                >
                  Prep Checklist
                </p>
                <div className="space-y-1">
                  {checklistItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => toggleChecklist(item.id)}
                      className="w-full flex items-start gap-2 p-1.5 rounded text-left transition-colors group"
                      style={{ background: "transparent" }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = "#FAFAFA")
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = "transparent")
                      }
                    >
                      {/* Checkbox */}
                      <div
                        className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 rounded flex items-center justify-center border transition-colors"
                        style={{
                          background: item.checked ? "#2162F9" : "#FFFFFF",
                          borderColor: item.checked ? "#2162F9" : "#E9EAEB",
                        }}
                      >
                        {item.checked && (
                          <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                        )}
                      </div>
                      <span
                        className="text-[11px] leading-tight"
                        style={{
                          color: item.checked ? "#717680" : "#252B37",
                          textDecoration: item.checked ? "line-through" : "none",
                        }}
                      >
                        {item.question}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {anticipatedReqs.length > 0 && (
              <section>
                <p
                  className="text-[10px] font-semibold uppercase tracking-wide mb-2"
                  style={{ color: "#717680" }}
                >
                  Anticipated Requirements
                </p>
                <div className="space-y-1">
                  {anticipatedReqs.map((req: any, i: number) => {
                    const text =
                      typeof req === "string"
                        ? req
                        : req.requirement || req.text || String(req);
                    const conf = req.confidence;
                    const dotColor =
                      conf === "HIGH"
                        ? "#22C55E"
                        : conf === "MEDIUM"
                        ? "#EAB308"
                        : "#9CA3AF";
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-2 p-1.5 rounded"
                        style={{ background: "#FAFAFA" }}
                      >
                        <span
                          className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: dotColor }}
                        />
                        <p
                          className="text-[11px] leading-tight"
                          style={{ color: "#252B37" }}
                        >
                          {text}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {checklistItems.length === 0 && anticipatedReqs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-[11px]" style={{ color: "#717680" }}>
                  No prep session linked.
                </p>
                <p className="text-[11px] mt-1" style={{ color: "#717680" }}>
                  Create a Meeting Prep first to see your checklist here.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── CENTER: Live Transcript ───────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden border-r" style={{ borderColor: "#E9EAEB" }}>
          {/* Sub-header */}
          <div
            className="h-8 flex-shrink-0 flex items-center px-4 border-b"
            style={{ borderColor: "#E9EAEB" }}
          >
            <p
              className="text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: "#717680" }}
            >
              Live Transcript
            </p>
          </div>

          {/* Transcript lines */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5 select-text" style={{ scrollbarWidth: "thin" }}>
            <TranscriptList 
              transcript={transcript} 
              interimText={interimText} 
              acceptedSuggestions={acceptedSuggestions}
              onAccept={acceptSuggestion}
            />
            <div ref={transcriptEndRef} />
          </div>

          {/* Status bar */}
          <div
            className="h-7 flex-shrink-0 flex items-center gap-3 px-4 border-t"
            style={{ borderColor: "#E9EAEB" }}
          >
            <span className="text-[10px]" style={{ color: "#717680" }}>
              {transcript.length} utterance{transcript.length !== 1 ? "s" : ""}
            </span>
            {(isUpdatingMinutes || isUpdatingBrd) && (
              <span className="flex items-center gap-1 text-[10px]" style={{ color: "#2162F9" }}>
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                AI updating panels…
              </span>
            )}
          </div>
        </div>

        {/* ── RIGHT: AI Agent Panels ────────────────────────────────────────── */}
        <div id="tour-panels" className="w-[400px] flex-shrink-0 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div
            className="h-8 flex-shrink-0 flex items-end border-b px-1"
            style={{ borderColor: "#E9EAEB" }}
          >
            {(
              [
                { id: "minutes", label: "Minutes", Icon: FileText },
                { id: "brd", label: "BRD", Icon: CheckSquare2 },
                { id: "flowchart", label: "Flowchart", Icon: GitBranch },
                { id: "insights", label: "Insights", Icon: Lightbulb },
              ] as const
            ).map(({ id, label, Icon }) => {
              // Notification logic
              let count = 0;
              if (id === "insights") count = (minutesState.clarificationsRequired?.length || 0) - (lastSeenCounts.insights || 0);
              else if (id === "brd") count = ((brdState.requirements?.length || 0) + (brdState.suggestedQuestions?.length || 0)) - (lastSeenCounts.brd || 0);

              return (
                <button
                  key={id}
                  onClick={() => setActivePanel(id)}
                  className="relative h-full px-3 flex items-center gap-1.5 text-[11px] font-medium transition-colors"
                  style={{
                    color: activePanel === id ? "#252B37" : "#717680",
                  }}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                  {activePanel !== id && count > 0 && (
                    <span className="absolute -top-1.5 -right-0.5 min-w-[14px] h-[14px] px-1 bg-red-500 text-white text-[8px] font-black rounded-full flex items-center justify-center border-2 border-white animate-in zoom-in duration-300">
                      {count}
                    </span>
                  )}
                  {activePanel === id && (
                    <span
                      className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                      style={{ background: "#252B37" }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Panel body */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3" style={{ scrollbarWidth: "thin" }}>

            {/* ── Minutes panel ── */}
            {activePanel === "minutes" && (
              <>
                {isUpdatingMinutes && (
                  <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "#2162F9" }}>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Updating minutes…
                  </div>
                )}

                {!hasMinutes && !isUpdatingMinutes ? (
                  <EmptyState
                    Icon={FileText}
                    title="Minutes will appear here"
                    subtitle={'AI updates every 20s. Or click \u201cUpdate AI\u201d above.'}
                  />
                ) : (
                  <>
                    {minutesState?.keyAgreements?.length > 0 && (
                      <MinutesSection
                        title="Key Agreements"
                        items={minutesState.keyAgreements}
                        dotColor="#22C55E"
                        labelColor="#16A34A"
                      />
                    )}
                    {minutesState?.actionItems?.length > 0 && (
                      <section>
                        <SectionLabel label="Action Items" color="#535862" />
                        <div className="space-y-1">
                          {minutesState.actionItems.map((item, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-2 p-2 rounded-md border"
                              style={{
                                background: "#FAFAFA",
                                borderColor: "#E9EAEB",
                              }}
                            >
                              <CheckSquare2
                                className="w-3 h-3 mt-0.5 flex-shrink-0"
                                style={{ color: "#2162F9" }}
                              />
                              <div className="min-w-0">
                                <p className="text-[11px]" style={{ color: "#252B37" }}>
                                  {item.task}
                                </p>
                                {item.owner && (
                                  <p className="text-[10px]" style={{ color: "#717680" }}>
                                    {item.owner}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    {minutesState?.discussionPoints?.length > 0 && (
                      <MinutesSection
                        title="Discussion Points"
                        items={minutesState.discussionPoints}
                        dotColor="#60A5FA"
                        labelColor="#2563EB"
                      />
                    )}
                    {minutesState?.openQuestions?.length > 0 && (
                      <MinutesSection
                        title="Open Questions"
                        items={minutesState.openQuestions}
                        dotColor="#FBBF24"
                        labelColor="#D97706"
                      />
                    )}
                    {minutesState?.parkingLot?.length > 0 && (
                      <MinutesSection
                        title="Parking Lot"
                        items={minutesState.parkingLot}
                        dotColor="#9CA3AF"
                        labelColor="#6B7280"
                      />
                    )}
                  </>
                )}

                {minutesLastUpdated && (
                  <p
                    className="text-[10px] text-right pt-1"
                    style={{ color: "#717680" }}
                  >
                    Updated {timeSince(minutesLastUpdated)}
                  </p>
                )}
              </>
            )}

            {/* ── BRD panel ── */}
            {activePanel === "brd" && (
              <>
                {!meeting?.activeApps?.includes("brd-maker") ? (
                  <EmptyState
                    Icon={CheckSquare2}
                    title="BRD Maker not enabled"
                    subtitle="Enable it now to capture requirements in real-time."
                    actionLabel="Enable BRD Maker"
                    onAction={() => enableTool("brd-maker")}
                  />
                ) : (
                  <>
                    {isUpdatingBrd && (
                      <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "#2162F9" }}>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Updating BRD…
                      </div>
                    )}

                    {brdState.suggestedQuestions.length === 0 &&
                    brdState.requirements.length === 0 &&
                    !isUpdatingBrd ? (
                      <EmptyState
                        Icon={CheckSquare2}
                        title="BRD will populate from discussion"
                        subtitle="AI also suggests questions for you to ask."
                      />
                    ) : (
                      <>
                        {brdState.suggestedQuestions.filter(q => {
                          const text = typeof q === "string" ? q : (q as any).question;
                          return !dismissedQuestions.has(text);
                        }).length > 0 && (
                          <section>
                            <p
                              className="text-[10px] font-semibold uppercase tracking-wide mb-1.5"
                              style={{ color: "#2162F9" }}
                            >
                              💡 Ask These Now
                            </p>
                            <div className="space-y-1.5">
                              {brdState.suggestedQuestions
                                .filter(q => {
                                  if (typeof q === "string") return !dismissedQuestions.has(q);
                                  return !dismissedQuestions.has(q.question);
                                })
                                .map((q, i) => {
                                  const isObject = typeof q !== "string";
                                  const text = isObject ? (q as any).question : (q as string);
                                  const options = isObject ? (q as any).options : [];
                                  const asked = checkedQuestions.has(text);

                                  return (
                                    <div
                                      key={i}
                                      className="flex flex-col gap-2 p-2.5 rounded-md border"
                                      style={{
                                        background: asked ? "#F0FDF4" : "#F1F7FF",
                                        borderColor: asked ? "#BBF7D0" : "#BFDBFE",
                                        opacity: asked ? 0.75 : 1,
                                      }}
                                    >
                                      <div className="flex items-start gap-2">
                                        {/* Check button */}
                                        <button
                                          onClick={() => setCheckedQuestions(prev => {
                                            const next = new Set(prev);
                                            asked ? next.delete(text) : next.add(text);
                                            return next;
                                          })}
                                          title={asked ? "Mark as not asked" : "Mark as asked"}
                                          className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors"
                                          style={{
                                            background: asked ? "#22C55E" : "#FFFFFF",
                                            borderColor: asked ? "#22C55E" : "#93C5FD",
                                          }}
                                        >
                                          {asked && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                                        </button>
                                        {/* Question text */}
                                        <p
                                          className="flex-1 text-[12px] leading-snug font-medium"
                                          style={{
                                            color: "#252B37",
                                            textDecoration: asked ? "line-through" : "none",
                                          }}
                                        >
                                          {text}
                                        </p>
                                        {/* Dismiss button */}
                                        <button
                                          onClick={() => setDismissedQuestions(prev => new Set(prev).add(text))}
                                          title="Dismiss this question"
                                          className="flex-shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center rounded hover:bg-red-100 transition-colors"
                                        >
                                          <X className="w-3 h-3" style={{ color: "#9CA3AF" }} />
                                        </button>
                                      </div>

                                      {/* Interactive options */}
                                      {!asked && options?.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 pl-6">
                                          {options.map((opt: string) => (
                                            <button
                                              key={opt}
                                              onClick={() => {
                                                // Handle selection
                                                handleTranscription(`Facilitator Selection for "${text}": ${opt}`);
                                                setCheckedQuestions(prev => new Set(prev).add(text));
                                                showToast(`Selected ${opt}`, "success");
                                              }}
                                              className="px-2.5 py-1 bg-white border border-blue-200 text-[#2162F9] text-[10px] font-bold rounded-lg hover:bg-blue-50 transition-all shadow-sm active:scale-95"
                                            >
                                              {opt}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          </section>
                        )}

                        {brdState.requirements.length > 0 && (
                          <section>
                            <SectionLabel label="Captured Requirements" color="#535862" />
                            <div className="space-y-1">
                              {brdState.requirements.map((req, i) => (
                                <div
                                  key={i}
                                  className="flex items-start gap-2 p-2 rounded-md border"
                                  style={{
                                    background: "#FAFAFA",
                                    borderColor: "#E9EAEB",
                                  }}
                                >
                                  <span
                                    className="mt-0.5 text-[9px] font-bold px-1 py-0.5 rounded flex-shrink-0"
                                    style={
                                      req.type === "functional"
                                        ? { background: "#DCFCE7", color: "#15803D" }
                                        : { background: "#F3E8FF", color: "#7E22CE" }
                                    }
                                  >
                                    {req.type === "functional" ? "F" : "NF"}
                                  </span>
                                  <p
                                    className="text-[11px] leading-tight"
                                    style={{ color: "#252B37" }}
                                  >
                                    {req.text}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}
                      </>
                    )}

                    {brdLastUpdated && (
                      <p
                        className="text-[10px] text-right pt-1"
                        style={{ color: "#717680" }}
                      >
                        Updated {timeSince(brdLastUpdated)}
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Flowchart panel ── */}
            {activePanel === "flowchart" && (
              <div className="space-y-3">
                {!meeting?.activeApps?.includes("architect-flow") ? (
                  <EmptyState
                    Icon={GitBranch}
                    title="Architect Flow not enabled"
                    subtitle="Enable it to generate process flows from this meeting."
                    actionLabel="Enable Architect Flow"
                    onAction={() => enableTool("architect-flow")}
                  />
                ) : (
                  <>
                    <p className="text-[11px] leading-relaxed" style={{ color: "#717680" }}>
                      Generates a flowchart from the last part of the discussion.
                    </p>
                    <div className="flex bg-surface-muted rounded-md border border-border-default p-0.5">
                      <button onClick={() => setFlowContext("as-is")} className={`flex-1 text-[11px] font-medium py-1 rounded ${flowContext === "as-is" ? "bg-white shadow-sm border border-border-default text-text-primary" : "text-text-secondary hover:text-text-primary"}`}>As-Is</button>
                      <button onClick={() => setFlowContext("to-be")} className={`flex-1 text-[11px] font-medium py-1 rounded ${flowContext === "to-be" ? "bg-white shadow-sm border border-border-default text-text-primary" : "text-text-secondary hover:text-text-primary"}`}>To-Be</button>
                    </div>
                    <button
                      onClick={generateFlowchart}
                      disabled={transcript.length === 0 || isGeneratingFlowchart}
                      className="w-full py-2.5 px-4 text-white text-[12px] font-semibold rounded-md transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                      style={{ background: "#2162F9" }}
                    >
                      {isGeneratingFlowchart ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Generating…
                        </>
                      ) : (
                        <>
                          <GitBranch className="w-3.5 h-3.5" />
                          Generate Flowchart
                        </>
                      )}
                    </button>

                    {flowchartResult && (
                      <div className="space-y-2">
                        <SectionLabel label="Generated Diagram" color="#535862" />
                        <div
                          className="p-3 rounded-md border overflow-auto max-h-64"
                          style={{ background: "#FAFAFA", borderColor: "#E9EAEB" }}
                        >
                          <pre
                            className="text-[10px] whitespace-pre-wrap"
                            style={{ color: "#535862" }}
                          >
                            {flowchartResult}
                          </pre>
                        </div>
                        <a
                          href="/architect"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-[11px]"
                          style={{ color: "#2162F9" }}
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open in Architect Flow
                        </a>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Insights panel ── */}
            {activePanel === "insights" && (
              <div className="space-y-4">
                {minutesState.clarificationsRequired?.length === 0 ? (
                  <EmptyState
                    Icon={Lightbulb}
                    title="No clarifications needed yet"
                    subtitle="AI will surface questions here if something is ambiguous."
                  />
                ) : (
                  <section>
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wide mb-2 text-primary flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3 h-3" />
                      Clarify with Participants
                    </p>
                    <div className="space-y-2">
                      {minutesState.clarificationsRequired.map((q, i) => (
                        <div
                          key={i}
                          className="p-3 rounded-md border bg-blue-50/50 border-blue-100 flex gap-2.5 shadow-sm"
                        >
                          <div className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                            ?
                          </div>
                          <p className="text-[12px] leading-relaxed text-text-primary">
                            {q}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

          </div>
          
          {/* ── Persistent Notes Area ── */}
          <div className="h-48 border-t border-border-default flex flex-col bg-surface-subtle p-3 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-text-secondary">
                <PenLine className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium uppercase tracking-wider">Live Notes</span>
              </div>
              <p className="text-[10px]" style={{ color: "#9CA3AF" }}>
                {notes.length} characters
              </p>
            </div>
            <textarea
              value={notes}
              onChange={e => {
                setNotes(e.target.value);
                localStorage.setItem(`meeting-notes-${meetingId}`, e.target.value);
              }}
              placeholder="Jot down important notes here... They will be included in the AI processing."
              className="flex-1 w-full bg-white resize-none rounded-md border p-2.5 text-[12px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary"
              style={{
                borderColor: "#E9EAEB",
                color: "#252B37",
              }}
            />
          </div>
        </div>
      </div>

      {/* Verification Overlay */}
      {isVerifyingTasks && (
        <div className="fixed inset-0 z-[100000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <div className="w-full max-w-[1400px] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[90vh] border border-slate-200 animate-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-[#F1F7FF] flex items-center justify-center text-[#2162F9] shadow-sm">
                   {verificationStep === "minutes" ? <FileText className="w-5 h-5" /> : <CheckSquare2 className="w-5 h-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2162F9]">CST Meeting Finalizer</p>
                    <span className="w-1 h-1 rounded-full bg-slate-300" />
                    <p className="text-[10px] font-bold text-slate-400 uppercase">
                      {verificationStep === "minutes" ? "Step 1: Minutes Review" : "Step 2: Action Items Review"}
                    </p>
                  </div>
                  <h2 className="text-xl font-black text-slate-800 tracking-tight">
                    {verificationStep === "minutes" ? "REVIEW MINUTES OF MEETING" : "VERIFY ACTION NEXT STEPS"}
                  </h2>
                </div>
              </div>
              <button 
                onClick={() => setIsVerifyingTasks(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-50 text-slate-400 transition-colors"
                disabled={isEnding}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-6 styled-scroll bg-[#F9FAFB]">
              {verificationStep === "minutes" ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  {/* Minutes Preview */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
                    {minutesState.keyAgreements.length > 0 && (
                      <section>
                        <SectionLabel label="Key Agreements" color="#16A34A" />
                        <ul className="space-y-2">
                          {minutesState.keyAgreements.map((item, i) => (
                            <li key={i} className="flex items-start gap-3">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                              <p className="text-[13px] text-slate-700 leading-relaxed font-medium">{item}</p>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {minutesState.discussionPoints.length > 0 && (
                      <section>
                        <SectionLabel label="Discussion Points" color="#2563EB" />
                        <ul className="space-y-2">
                          {minutesState.discussionPoints.map((item, i) => (
                            <li key={i} className="flex items-start gap-3">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                              <p className="text-[13px] text-slate-700 leading-relaxed font-medium">{item}</p>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {(!minutesState.keyAgreements.length && !minutesState.discussionPoints.length) && (
                      <div className="py-12 flex flex-col items-center justify-center text-center">
                        <p className="text-sm font-bold text-slate-400 tracking-tight uppercase">No minutes points extracted yet</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  {verifiedTasks.length === 0 ? (
                    <div className="py-20 flex flex-col items-center justify-center text-center">
                      <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center mb-4">
                        <Sparkles className="w-6 h-6 text-slate-300" />
                      </div>
                      <p className="text-sm font-bold text-slate-400 tracking-tight uppercase">No tasks identified yet</p>
                      <p className="text-xs text-slate-400 max-w-[240px] mt-1 leading-relaxed">You can add tasks manually after completion or continue with zero identified tasks.</p>
                    </div>
                  ) : (
                    verifiedTasks.map((item, idx) => (
                      <div key={idx} className="group relative bg-white p-4 rounded-xl border border-slate-100 hover:border-[#2162F9]/20 hover:bg-white hover:shadow-lg hover:shadow-blue-500/5 transition-all">
                        <div className="grid grid-cols-12 gap-4 items-start">
                          <div className="col-span-12 md:col-span-6 space-y-3">
                            <div className="flex items-start gap-3">
                              <div className="w-5 h-5 rounded-md bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 font-bold text-[10px] shrink-0 mt-0.5">
                                {idx + 1}
                              </div>
                              <div className="flex-1">
                                <label className="text-[9px] font-black uppercase tracking-widest text-[#717680] mb-1 block">Task Description</label>
                                <textarea 
                                  rows={2}
                                  value={item.task}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setVerifiedTasks(prev => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], task: value };
                                      return next;
                                    });
                                  }}
                                  className="w-full bg-transparent text-xs font-semibold text-[#252B37] outline-none border-b border-transparent focus:border-[#2162F9] transition-colors resize-none py-0.5"
                                  placeholder="Describe the task..."
                                />
                              </div>
                            </div>
                          </div>
                          <div className="col-span-12 md:col-span-6 grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                               <label className="text-[9px] font-black uppercase tracking-widest text-[#717680] mb-1 block">Owner</label>
                               <select 
                                value={item.owner}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setVerifiedTasks(prev => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], owner: value };
                                    return next;
                                  });
                                }}
                                className="w-full bg-white text-[11px] font-bold text-[#2162F9] outline-none px-3 h-8 rounded-lg border border-slate-200 focus:border-[#2162F9] transition-colors appearance-none"
                              >
                                <option value="">— Unassigned —</option>
                                <optgroup label="System Roles">
                                  {members.roles.map(r => <option key={r.id} value={r.name}>{r.name.toUpperCase()}</option>)}
                                </optgroup>
                                <optgroup label="Approved Users">
                                  {members.users.map(u => <option key={u.id} value={u.name || u.email}>{u.name?.toUpperCase() || u.email}</option>)}
                                </optgroup>
                              </select>
                            </div>
                            <div>
                               <label className="text-[9px] font-black uppercase tracking-widest text-[#717680] mb-1 block">Start Date</label>
                               <input 
                                 type="date"
                                 value={item.plannedStart}
                                 onChange={(e) => {
                                   const value = e.target.value;
                                   setVerifiedTasks(prev => {
                                     const next = [...prev];
                                     next[idx] = { ...next[idx], plannedStart: value };
                                     return next;
                                   });
                                 }}
                                 className="w-full bg-white text-[10px] font-bold text-[#535862] outline-none px-2 h-8 rounded-lg border border-slate-200 focus:border-[#2162F9] transition-colors"
                               />
                            </div>
                            <div>
                               <label className="text-[9px] font-black uppercase tracking-widest text-[#717680] mb-1 block">End Date</label>
                               <input 
                                 type="date"
                                 value={item.plannedEnd}
                                 onChange={(e) => {
                                   const value = e.target.value;
                                   setVerifiedTasks(prev => {
                                     const next = [...prev];
                                     next[idx] = { ...next[idx], plannedEnd: value };
                                     return next;
                                   });
                                 }}
                                 className="w-full bg-white text-[10px] font-bold text-[#535862] outline-none px-2 h-8 rounded-lg border border-slate-200 focus:border-[#2162F9] transition-colors"
                               />
                            </div>
                          </div>
                        </div>
                        <button 
                          onClick={() => {
                            setVerifiedTasks(prev => {
                              const next = [...prev];
                              next.splice(idx, 1);
                              return next;
                            });
                          }}
                          className="absolute -right-2 -top-2 opacity-0 group-hover:opacity-100 w-6 h-6 bg-rose-500 text-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110 active:scale-90 z-20"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-5 border-t border-slate-100 bg-white flex items-center justify-between sticky bottom-0 z-10 font-sans">
              <div className="flex items-center gap-2">
                 {verificationStep === "minutes" ? (
                   <>
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Step 1 of 2: Content Approval</p>
                   </>
                 ) : (
                   <>
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Step 2 of 2: Task Assignment</p>
                   </>
                 )}
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    if (verificationStep === "tasks") setVerificationStep("minutes");
                    else setIsVerifyingTasks(false);
                  }}
                  disabled={isEnding}
                  className="px-5 h-10 rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-40"
                >
                  {verificationStep === "tasks" ? "Back to Minutes" : "Return to Meeting"}
                </button>
                
                {verificationStep === "minutes" ? (
                  <button 
                    onClick={() => setVerificationStep("tasks")}
                    className="px-8 h-10 bg-[#2162F9] text-white rounded-xl text-[11px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/20 hover:bg-blue-600 transition-all flex items-center gap-2 group active:scale-95"
                  >
                    Next: Review Action Items
                    <RefreshCw className="w-3.5 h-3.5 transition-transform group-hover:rotate-12" />
                  </button>
                ) : (
                  <button 
                    onClick={endMeeting}
                    disabled={isEnding}
                    className="px-8 h-10 bg-[#2162F9] text-white rounded-xl text-[11px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/20 hover:bg-blue-600 transition-all flex items-center gap-2 group active:scale-95 disabled:opacity-60"
                  >
                    {isEnding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    {isEnding ? "Processing Meeting..." : "Finalize & Record"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Meeting Tour Overlay */}
      {showTour && (
        <MeetingTour 
          steps={tourSteps} 
          onComplete={() => {
            setShowTour(false);
            localStorage.setItem("cst-live-tour-seen", "true");
            showToast("Tour completed! Click the Sparkle icon if you need help again.", "success");
          }}
          onClose={() => setShowTour(false)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptyState({
  Icon,
  title,
  subtitle,
  onAction,
  actionLabel,
}: {
  Icon: React.ElementType;
  title: string;
  subtitle: string;
  onAction?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <Icon className="w-7 h-7 mb-3" style={{ color: "#E9EAEB" }} />
      <div className="space-y-1">
        <p className="text-[12px] font-bold" style={{ color: "#252B37" }}>
          {title}
        </p>
        <p className="text-[11px] px-6 leading-relaxed" style={{ color: "#717680" }}>
          {subtitle}
        </p>
      </div>
      {onAction && (
        <button 
          onClick={onAction}
          className="mt-5 px-4 py-2 bg-[#2162F9] text-white text-[11px] font-black uppercase tracking-widest rounded-xl shadow-lg shadow-blue-500/10 hover:bg-blue-600 transition-all active:scale-95"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function SectionLabel({ label, color }: { label: string; color: string }) {
  return (
    <p
      className="text-[10px] font-semibold uppercase tracking-wide mb-1.5"
      style={{ color }}
    >
      {label}
    </p>
  );
}

function MinutesSection({
  title,
  items,
  dotColor,
  labelColor,
}: {
  title: string;
  items: string[];
  dotColor: string;
  labelColor: string;
}) {
  return (
    <section>
      <SectionLabel label={title} color={labelColor} />
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span
              className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: dotColor }}
            />
            <p
              className="text-[11px] leading-tight"
              style={{ color: "#252B37" }}
            >
              {item}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
// ─── Sub-components ──────────────────────────────────────────────────────────

const TranscriptList = React.memo(({ 
  transcript, 
  interimText, 
  acceptedSuggestions, 
  onAccept 
}: { 
  transcript: (string | { type: "ai"; text: string })[];
  interimText: string;
  acceptedSuggestions: Set<number>;
  onAccept: (idx: number, text: string) => void;
}) => {
  if (transcript.length === 0 && !interimText) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <div
          className="w-10 h-10 rounded-full border-2 flex items-center justify-center mb-3"
          style={{ borderColor: "#E9EAEB" }}
        >
          <Mic className="w-5 h-5" style={{ color: "#717680" }} />
        </div>
        <p className="text-[12px]" style={{ color: "#717680" }}>
          Listening for speech…
        </p>
        <p className="text-[11px] mt-1" style={{ color: "#717680" }}>
          Transcript appears here as you speak
        </p>
      </div>
    );
  }

  return (
    <>
      {transcript.map((line, i) => {
        const isAi = typeof line !== "string";
        const text = isAi ? (line as any).text : (line as string);
        
        if (isAi) {
          return (
            <div key={i} className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 my-2 shadow-sm animate-in slide-in-from-left duration-500">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-3 h-3 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-widest text-primary">CST AI Suggestion</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <p className="text-[12px] leading-relaxed text-slate-800">
                  {text}
                </p>
                {!acceptedSuggestions.has(i) ? (
                  <button
                    onClick={() => onAccept(i, text)}
                    className="px-2 py-0.5 rounded text-[9px] font-bold bg-primary text-white hover:bg-primary-hover transition-colors flex-shrink-0"
                  >
                    Accept
                  </button>
                ) : (
                  <span className="flex items-center gap-0.5 text-[9px] font-bold text-emerald-600 flex-shrink-0 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                    <Check className="w-2.5 h-2.5" /> Accepted
                  </span>
                )}
              </div>
            </div>
          );
        }

        return (
          <p
            key={i}
            className="text-[13px] leading-relaxed pl-2 border-l-2 transition-colors select-text"
            style={{
              color: "#252B37",
              borderColor: i === transcript.length - 1 && !interimText ? "#2162F9" : "transparent",
            }}
          >
            {text}
          </p>
        );
      })}
      {interimText && (
        <p
          className="text-[13px] leading-relaxed pl-2 border-l-2 italic select-text"
          style={{ color: "#9CA3AF", borderColor: "#2162F9" }}
        >
          {interimText}
        </p>
      )}
    </>
  );
});

TranscriptList.displayName = "TranscriptList";
