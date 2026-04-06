"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { Loader2, Calendar, FileText, Download, Save, Clock, HelpCircle, Image as ImageIcon, Zap, LayoutList, Users } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import GlobalBar from "@/components/layout/GlobalBar";
import mermaid from "mermaid";
import { toPng } from "html-to-image";
import InteractiveGantt from "@/components/timeline/InteractiveGantt";
import Walkthrough from "@/components/timeline/Walkthrough";
import StitchLoading from "@/components/timeline/StitchLoading";
import { PremiumSpinner } from "@/components/ui/PremiumSpinner";
import { useToast } from "@/components/ui/ToastContext";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";
import TaskDetailModal from "@/components/tasks/TaskDetailModal";
import BufferModal from "@/components/timeline/BufferModal";
import { calculateClientEndDate } from "@/lib/utils/business-days";

export default function TimelinePage() {
  return (
    <AuthGuard>
      <TimelineApp />
    </AuthGuard>
  );
}

interface Template {
  id: string;
  name: string;
  description: string;
  restDays: string;
  type?: string;
  tasks: any[];
}

interface TimelineEvent {
  id: string;
  taskCode: string;
  subject: string;
  startDate: string;
  endDate: string;
  durationHours: number;
  owner: string;
  description: string;
  projectName?: string;
  status?: string;
  depth?: number;
  expanded?: boolean;
  hasChildren?: boolean;
  paddingDays?: number;
  externalPlannedEnd?: string;
}

function TimelineApp() {
  const { data: session } = useSession();
  const { showToast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [projectName, setProjectName] = useState("");

  // STABILITY: Integrated Central Navigation
  useBreadcrumbs([{ label: "Timeline", href: "/timeline" }, { label: projectName || "New Roadmap" }]);
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [customInstructions, setCustomInstructions] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [activeTab, setActiveTab] = useState<"list" | "gantt">("gantt");
  const [viewMode, setViewMode] = useState<"static" | "interactive">("interactive");
  const [scale, setScale] = useState<"day" | "week" | "month">("day");
  const [showWalkthrough, setShowWalkthrough] = useState(false);

  const [accounts, setAccounts] = useState<{ id: string; companyName: string }[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
  const isAccountMaintenance = selectedTemplate?.type === "account-maintenance";
  const [savingToDb, setSavingToDb] = useState(false);
  const [isLaunched, setIsLaunched] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [selectedTask, setSelectedTask] = useState<TimelineEvent | null>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  
  // BUFFER MODAL STATE
  const [bufferTaskId, setBufferTaskId] = useState<string | null>(null);
  const [isBufferModalOpen, setIsBufferModalOpen] = useState(false);
  
  const [shareLink, setShareLink] = useState<string | null>(null);
  const mermaidRef = useRef<HTMLDivElement>(null);
  const interactiveGanttRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTimeout(() => setIsLaunched(true), 150);
  }, []);

  // Wire up the Gantt's + button to add a subtask below the parent
  useEffect(() => {
    (window as any).dispatchAddTask = (parent: { id: string; subject: string; plannedStart: string; plannedEnd: string }) => {
      const parentIdx = events.findIndex(e => e.id === parent.id);
      if (parentIdx === -1) return;
      const parentEvent = events[parentIdx];
      const newSubtask: TimelineEvent = {
        id: `sub-${Date.now()}`,
        taskCode: `${parentEvent.taskCode}-SUB`,
        subject: `Subtask of ${parentEvent.subject}`,
        startDate: parentEvent.startDate,
        endDate: parentEvent.startDate, // same day, 1-day default
        durationHours: 8,
        owner: parentEvent.owner,
        description: "",
        projectName: parentEvent.projectName,
        depth: (parentEvent.depth || 0) + 1,
        hasChildren: false,
        expanded: true,
      };
      const newEvents = [...events];
      newEvents.splice(parentIdx + 1, 0, newSubtask);
      // Mark parent as having children
      newEvents[parentIdx] = { ...newEvents[parentIdx], hasChildren: true, expanded: true };
      setEvents(newEvents);
    };
    return () => { delete (window as any).dispatchAddTask; };
  }, [events]);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: "forest" });
    fetch("/api/accounts")
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setAccounts(data); })
      .catch(console.error);
    fetch("/api/templates")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setTemplates(data);
      })
      .catch(console.error);
    fetch("/api/users/members")
      .then(res => res.json())
      .then(data => { if (data.users) setMembers(data.users); })
      .catch(console.error);

    // Deep-linking: Load project from URL if present
    const params = new URLSearchParams(window.location.search);
    const pId = params.get("projectId");
    if (pId) {
      fetch(`/api/projects?id=${pId}`)
        .then(res => res.json())
        .then(data => {
            if (Array.isArray(data)) {
                const proj = data.find(p => p.id === pId);
                if (proj) {
                    setProjectName(proj.name);
                    setSelectedTemplateId(proj.templateId || "");
                    setStartDate(new Date(proj.startDate).toISOString().split("T")[0]);
                    
                    fetch(`/api/tasks?projectId=${pId}`)
                        .then(r => r.json())
                        .then(items => {
                            if (Array.isArray(items)) {
                                setEvents(items.map((item: any) => ({
                                    id: item.id,
                                    taskCode: item.taskCode,
                                    subject: item.subject,
                                    startDate: item.plannedStart.split('T')[0],
                                    endDate: item.plannedEnd.split('T')[0],
                                    durationHours: item.durationHours,
                                    owner: item.owner || "",
                                    description: item.description || "",
                                    dailyTasks: item.dailyTasks || []
                                })));
                            }
                        });
                }
            }
        });
    }
    
    const seen = localStorage.getItem("timeline_walkthrough_seen");
    if (!seen) {
      setShowWalkthrough(true);
      localStorage.setItem("timeline_walkthrough_seen", "true");
    }
  }, []);

  useEffect(() => {
    if (activeTab === "gantt" && viewMode === "static" && events.length > 0 && mermaidRef.current) {
      const renderGantt = async () => {
        try {
          const mcode = buildMermaidGantt(events, projectName || "Project");
          mermaidRef.current!.innerHTML = mcode;
          mermaidRef.current!.removeAttribute("data-processed");
          await mermaid.run({ nodes: [mermaidRef.current!] });
        } catch (e) {
          console.error("Mermaid error:", e);
        }
      };
      setTimeout(renderGantt, 50);
    }
  }, [activeTab, viewMode, events, projectName]);

  const handleUpdateEvents = (newEvents: TimelineEvent[]) => setEvents(newEvents);

  const handleTaskClick = (id: string) => {
    const ev = events.find(e => e.id === id);
    if (ev) {
      setSelectedTask(ev);
      setIsTaskModalOpen(true);
    }
  };

  const handleAddBuffer = (taskId: string) => {
    setBufferTaskId(taskId);
    setIsBufferModalOpen(true);
  };

  const handleSaveBuffer = (padding: number) => {
    if (!bufferTaskId) return;
    
    setEvents(prev => prev.map(ev => {
      if (ev.id === bufferTaskId) {
        const externalEnd = calculateClientEndDate(ev.endDate, padding);
        return {
          ...ev,
          paddingDays: padding,
          externalPlannedEnd: externalEnd || ev.endDate
        };
      }
      return ev;
    }));
    
    setIsBufferModalOpen(false);
    setBufferTaskId(null);
  };

  const generateTimeline = async (e: React.FormEvent) => {
    e.preventDefault();

    const template = templates.find(t => t.id === selectedTemplateId);
    if (!template) {
      showToast("Please select a template before generating.", "error");
      return;
    }

    setLoading(true);
    setEvents([]);

    try {
      const res = await fetch("/api/timeline/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: template.name,
          tasks: template.tasks,
          startDate,
          restDays: template.restDays,
          customInstructions,
        }),
      });

      const result = await res.json();
      if (res.ok) {
        const rawTasks = Array.isArray(result) ? result : (result.tasks || []);
        
        if (!Array.isArray(rawTasks)) {
          showToast("AI returned invalid task structure. Try again.", "error");
          return;
        }

        const finalEvents: TimelineEvent[] = rawTasks.map((t: any, i: number) => {
          const padding = 0; 
          const externalEnd = calculateClientEndDate(t.endDate, padding);
          
          return {
            ...t,
            id: t.id || `temp-${Date.now()}-${i}`,
            paddingDays: padding,
            externalPlannedEnd: externalEnd || t.endDate,
            depth: t.depth || 0,
            expanded: true
          };
        });
        setEvents(finalEvents);
      } else {
        const raw: string = result.error || "Unknown error";
        let friendly = raw;
        if (raw.includes("429") || raw.includes("quota") || raw.includes("Too Many Requests")) {
          friendly = "AI quota exceeded. Go to Admin → Settings and switch to Groq (free) or check your current provider's limits.";
        } else if (raw.includes("API key") || raw.includes("API Key") || raw.includes("not set")) {
          friendly = "No AI key configured. Go to Admin → Settings and save your Groq or Gemini API key.";
        } else if (raw.includes("403") || raw.includes("Forbidden") || raw.includes("Authentication")) {
          friendly = "Invalid API key. Check Admin → Settings — your key may have expired or been revoked.";
        }
        showToast(friendly, "error");
      }
    } catch (err: any) {
      showToast("Network error — check your connection and try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  const buildMermaidGantt = (data: TimelineEvent[], title: string) => {
    const axisFormats = {
      day: "%m/%d",
      week: "W%W",
      month: "%b %Y"
    };
    const format = axisFormats[scale] || "%m/%d";
    
    let gantt = `%%{init: { 'theme': 'forest', 'gantt': { 'barHeight': 25, 'barGap': 10, 'topPadding': 50, 'sidePadding': 400 } } }%%\ngantt\n  dateFormat YYYY-MM-DD\n  axisFormat ${format}\n`;
    
    data.forEach(e => {
       const taskName = e.subject.replace(/:/g, '-');
       const ownerName = e.owner.replace(/:/g, '-').toUpperCase();
       gantt += `  section ${taskName}\n`;
       gantt += `    ${ownerName} : ${e.taskCode}, ${e.startDate}, ${e.endDate}\n`;
    });
    
    return gantt;
  };

  const saveToDb = async () => {
    if (!session?.user) {
      showToast("Please sign in to save the project.", "error");
      return;
    }
    if (events.length === 0) {
      showToast("Generate a timeline first before saving.", "error");
      return;
    }
    setSavingToDb(true);
    try {
      const selectedAccount = accounts.find(a => a.id === selectedAccountId);
      const effectiveName = isAccountMaintenance
        ? `Acct Maint – ${selectedAccount?.companyName || "General"} – ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
        : projectName;

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: effectiveName,
          templateId: selectedTemplateId,
          clientProfileId: selectedAccountId || null,
          startDate: startDate,
          events: events,
          assignedIds: assignedIds
        }),
      });
      const data = await res.json();
      if (res.ok) {
         showToast("Project successfully saved to Database!", "success");
         if (data.shareToken) {
           setShareLink(`${window.location.origin}/share/${data.shareToken}`);
         }
      } else {
         showToast("Failed to save: " + (data.error || "Unknown"), "error");
      }
    } catch (err: any) {
      console.error(err);
      showToast("Failed to save project to Database.", "error");
    } finally {
      setSavingToDb(false);
    }
  };

  const exportCsv = () => {
    if (events.length === 0) return;
    const headers = "Task Code,Subject,Start Date,End Date,Owner,Hours,Description\n";
    const csv = events.map(e => `"${e.taskCode}","${e.subject}","${e.startDate}","${e.endDate}","${e.owner}","${e.durationHours}","${e.description}"`).join("\n");
    const blob = new Blob([headers + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${projectName || "Timeline"}.csv`;
    link.click();
  };

  const exportPng = async () => {
    if (activeTab !== "gantt" || !mermaidRef.current) {
       showToast("Please switch to the Gantt Chart view to export an image.", "info");
       return;
    }
    try {
      const dataUrl = await toPng(mermaidRef.current, { backgroundColor: '#ffffff', pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `${projectName || 'Gantt_Chart'}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error(err);
      showToast("Failed to export static image.", "error");
    }
  };

  const exportInteractivePng = async () => {
    if (!interactiveGanttRef.current) return;
    try {
      const element = interactiveGanttRef.current;
      
      const scrollContainer = element.querySelector('.overflow-auto') as HTMLElement;
      if (!scrollContainer) return;

      const originalHeight = element.style.height;
      const originalWidth = element.style.width;
      const originalOverflow = scrollContainer.style.overflow;

      element.style.height = `${scrollContainer.scrollHeight}px`;
      element.style.width = `${scrollContainer.scrollWidth}px`;
      scrollContainer.style.overflow = 'visible';

      const dataUrl = await toPng(element, { 
        backgroundColor: '#ffffff', 
        pixelRatio: 2,
        style: {
          borderRadius: '0',
          position: 'relative'
        }
      });

      element.style.height = originalHeight;
      element.style.width = originalWidth;
      scrollContainer.style.overflow = originalOverflow;

      const link = document.createElement('a');
      link.download = `${projectName || 'Interactive_Timeline'}.full.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error(err);
      showToast("Failed to export interactive image.", "error");
    }
  };

  return (
    <div className={`flex flex-col h-full overflow-hidden transition-opacity duration-1000 ${isLaunched ? 'opacity-100' : 'opacity-0'}`}>
      <div className="flex flex-1 overflow-hidden bg-surface-subtle">

      <div className="w-[280px] shrink-0 border-r bg-surface-default flex flex-col shadow-xl z-20">
        <div className="p-4 border-b bg-surface-subtle">
          <h1 className="text-sm font-black tracking-tight text-text-primary flex items-center gap-2 uppercase">
            <Calendar className="w-4 h-4 text-primary" />
            Project Setup
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <form onSubmit={generateTimeline} className="space-y-4 text-text-primary">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-text-secondary tracking-widest">Template</label>
              <select 
                required
                value={selectedTemplateId} 
                onChange={e => setSelectedTemplateId(e.target.value)}
                className="w-full text-sm border rounded-lg p-2.5 bg-surface-muted text-text-primary focus:ring-2 focus:ring-primary outline-none border-border-default"
              >
                 <option value="" disabled>Select a standard process...</option>
                 {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase text-text-secondary tracking-widest">Account</label>
              <select
                value={selectedAccountId}
                onChange={e => setSelectedAccountId(e.target.value)}
                className="w-full text-sm border rounded-lg p-2.5 bg-surface-muted text-text-primary focus:ring-2 focus:ring-primary outline-none border-border-default"
              >
                <option value="">— None / Standalone —</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.companyName}</option>)}
              </select>
            </div>

            {!isAccountMaintenance && (
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-text-muted tracking-wider">Project Name</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. ERP Phase 1 Implementation"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  className="w-full text-sm border rounded-lg p-2.5 bg-surface-default text-text-primary focus:ring-2 focus:ring-primary outline-none border-border-default"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-text-muted tracking-wider">Target Start Date</label>
              <input 
                required
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full text-sm border rounded-lg p-2.5 bg-surface-default text-text-primary focus:ring-2 focus:ring-primary outline-none font-mono border-border-default"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-text-muted tracking-wider flex items-center gap-1">
                 Custom Adjustments <HelpCircle className="w-3 h-3 text-text-secondary" />
              </label>
              <textarea 
                rows={3}
                placeholder="Optional AI constraints (e.g. skip the review phase, expedite by 2 days)..."
                value={customInstructions}
                onChange={e => setCustomInstructions(e.target.value)}
                className="w-full text-xs border rounded-lg p-2.5 bg-surface-default text-text-primary focus:ring-2 focus:ring-primary outline-none resize-none border-border-default"
              />
            </div>

            <div className="space-y-2 border-t pt-3">
              <label className="text-[10px] font-black uppercase text-text-secondary tracking-widest flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-primary" /> Assign Members
              </label>
              <p className="text-[10px] text-text-muted mb-2 font-medium">Who can view this project?</p>
              <div className="max-h-40 overflow-y-auto space-y-1.5 border border-border-default rounded-lg p-2 bg-slate-50/50 styled-scroll">
                {members.map(member => (
                   <label key={member.id} className="flex items-center gap-2 px-1.5 py-1 hover:bg-white rounded border border-transparent hover:border-border-default transition-all cursor-pointer group">
                      <input 
                        type="checkbox" 
                        checked={assignedIds.includes(member.id)}
                        onChange={(e) => {
                          if (e.target.checked) setAssignedIds(prev => [...prev, member.id]);
                          else setAssignedIds(prev => prev.filter(id => id !== member.id));
                        }}
                        className="rounded border-border-default text-primary focus:ring-primary w-3 h-3"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-bold text-text-primary truncate">{member.name || member.email}</span>
                        <span className="text-[9px] text-text-muted uppercase font-bold tracking-tight opacity-60">
                           {member.role === 'admin' ? 'Admin (Auto)' : member.role || 'Member'}
                        </span>
                      </div>
                   </label>
                ))}
              </div>
              <p className="text-[8px] text-slate-400 italic mt-1 font-medium">* Admins automatically see all projects.</p>
            </div>

            <button 
              type="submit" 
              disabled={loading || !selectedTemplateId || (!isAccountMaintenance && !projectName)}
              className="w-full bg-primary hover:bg-primary-hover text-surface-default text-[10px] font-black uppercase tracking-widest py-3 rounded-xl shadow-lg shadow-primary/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
              {loading ? "Calculating..." : "Generate Master Roadmap"}
            </button>
          </form>
        </div>
      </div>

      <div className="flex-1 relative flex flex-col bg-surface-muted overflow-hidden">
        {events.length > 0 ? (
          <div className="h-full flex flex-col">
            <div className="h-12 bg-surface-default border-b border-border-default px-4 flex items-center justify-between shrink-0 shadow-sm z-30">
               <div className="flex bg-surface-muted p-1 rounded-lg border border-border-default">
                 <button onClick={() => setActiveTab("gantt")} className={`px-3 py-1 text-[10px] font-black uppercase tracking-tight rounded-md transition-all ${activeTab === "gantt" ? "bg-surface-default shadow-sm text-primary" : "text-text-secondary hover:text-text-primary"}`}>
                    Gantt
                 </button>
                 <button onClick={() => setActiveTab("list")} className={`px-3 py-1 text-[10px] font-black uppercase tracking-tight rounded-md transition-all ${activeTab === "list" ? "bg-surface-default shadow-sm text-primary" : "text-text-secondary hover:text-text-primary"}`}>
                    List
                 </button>
               </div>

               {activeTab === "gantt" && (
                 <div className="flex bg-surface-muted p-1 rounded-lg">
                   <button onClick={() => setViewMode("interactive")} className={`px-4 py-1.5 text-xs font-medium rounded-md flex items-center gap-2 transition-all ${viewMode === "interactive" ? "bg-surface-default shadow-sm text-primary" : "text-text-secondary hover:text-text-primary"}`}>
                      <Zap className="w-3 h-3" /> Interactive
                   </button>
                   <button onClick={() => setViewMode("static")} className={`px-4 py-1.5 text-xs font-medium rounded-md flex items-center gap-2 transition-all ${viewMode === "static" ? "bg-surface-default shadow-sm text-primary" : "text-text-secondary hover:text-text-primary"}`}>
                      <LayoutList className="w-3 h-3" /> Static
                   </button>
                 </div>
               )}

               {activeTab === "gantt" && viewMode === "interactive" && (
                 <div className="flex bg-surface-muted p-1 rounded-lg">
                   {(["day", "week", "month"] as const).map((s) => (
                     <button
                        key={s}
                        onClick={() => setScale(s)}
                        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${scale === s ? "bg-surface-default shadow-sm text-primary" : "text-text-secondary hover:text-text-primary"}`}
                     >
                       {s}
                     </button>
                   ))}
                 </div>
               )}

               <div className="flex items-center gap-3">
                 <button onClick={() => setShowWalkthrough(true)} className="p-2 text-text-secondary hover:text-primary transition-colors">
                    <HelpCircle className="w-5 h-5" />
                 </button>
                 <button onClick={viewMode === 'static' ? exportPng : exportInteractivePng} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border rounded-md hover:bg-surface-muted text-text-muted bg-surface-default border-border-default shadow-sm">
                   <ImageIcon className="w-3.5 h-3.5" /> PNG
                 </button>
                 <button onClick={exportCsv} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border rounded-md hover:bg-surface-muted text-text-muted bg-surface-default border-border-default shadow-sm">
                   <Download className="w-3.5 h-3.5" /> CSV
                 </button>
                  {shareLink ? (
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(shareLink);
                        showToast("Share link copied to clipboard!", "success");
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold border rounded-md bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm animate-bounce"
                    >
                      <Download className="w-3.5 h-3.5" /> Copy Share Link
                    </button>
                  ) : (
                    <button onClick={saveToDb} disabled={savingToDb} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border rounded-md hover:bg-primary-bg text-primary bg-primary-bg border-primary shadow-sm disabled:opacity-50">
                      {savingToDb ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 
                      {savingToDb ? "Saving..." : "Save Project"}
                    </button>
                  )}
               </div>
            </div>

            <div className="flex-1 overflow-auto p-4 md:p-8 relative min-h-0 bg-surface-muted">
              {activeTab === "gantt" && viewMode === "static" && (
                <div className="w-full bg-surface-default p-12 rounded-[2rem] border border-border-default shadow-2xl flex flex-col items-center min-h-[600px] overflow-x-auto">
                   <h2 className="text-2xl font-black text-text-primary mb-8 uppercase tracking-tight">{projectName || "Project Timeline"}</h2>
                   <div ref={mermaidRef} className="mermaid min-w-[800px] mt-0"></div>
                </div>
              )}

               {activeTab === "gantt" && viewMode === "interactive" && (
                 <div className="h-full">
                    {loading ? (
                       <div className="h-full flex items-center justify-center bg-surface-default/80 backdrop-blur-sm rounded-[2rem] border border-border-default shadow-2xl">
                          <StitchLoading />
                       </div>
                    ) : (
                        <div className="flex-1 min-h-0 bg-white">
                          <InteractiveGantt 
                            events={events} 
                            onUpdateEvents={handleUpdateEvents}
                            onTaskClick={handleTaskClick}
                            onUpdateBuffer={handleAddBuffer}
                            scale={scale}
                            ganttRef={interactiveGanttRef}
                          />
                        </div>
                    )}
                 </div>
               )}

              {activeTab === "list" && (
                <div className="max-w-4xl mx-auto space-y-4">
                  {events.map((e, i) => (
                    <div 
                      key={i} 
                      onClick={() => setSelectedTask(e)}
                      className="bg-surface-default p-5 rounded-xl border border-border-default shadow-sm flex gap-6 hover:shadow-md transition-shadow cursor-pointer group"
                    >
                      <div className="flex flex-col items-center justify-center bg-surface-muted border border-border-default rounded-lg p-3 min-w-[100px] shrink-0 group-hover:border-primary/30 transition-all">
                         <span className="text-[10px] uppercase font-bold text-text-secondary">Owner</span>
                         <span className="text-sm font-semibold text-primary text-center mt-1">{e.owner}</span>
                      </div>
                      <div className="flex-1">
                         <h3 className="text-lg font-bold text-text-primary mb-1 group-hover:text-primary transition-all">{e.subject}</h3>
                         <p className="text-sm text-text-secondary mb-3">{e.description}</p>
                         <div className="flex flex-wrap gap-2">
                           <span className="text-xs font-medium bg-primary-bg text-primary px-2 py-1 rounded border border-primary/20 flex items-center gap-1.5">
                             <Calendar className="w-3 h-3" /> {e.startDate} to {e.endDate}
                           </span>
                           {e.externalPlannedEnd && (
                             <span className="text-xs font-medium bg-orange-50 text-orange-700 px-2 py-1 rounded border border-orange-200 flex items-center gap-1.5">
                               <Zap className="w-3 h-3" /> Client: {e.externalPlannedEnd}
                             </span>
                           )}
                           <span className="text-xs font-medium bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-100 flex items-center gap-1.5">
                             <Clock className="w-3 h-3" /> {e.durationHours} hrs
                           </span>
                           <span className="text-xs font-medium bg-surface-muted text-text-secondary px-2 py-1 rounded font-mono">
                             {e.taskCode}
                           </span>
                         </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedTask && (
              <TaskDetailModal
                task={{
                  ...selectedTask,
                  plannedStart: selectedTask.startDate + "T09:00:00.000Z",
                  plannedEnd: selectedTask.endDate + "T17:00:00.000Z",
                }}
                isLocal={true}
                onClose={() => setSelectedTask(null)}
                onUpdated={() => {}}
                onLocalUpdate={(updates) => {
                  setEvents(prev => prev.map(ev => {
                    if (ev.id === selectedTask.id) {
                      const newEv = { ...ev, ...updates };
                      if (updates.plannedStart) newEv.startDate = updates.plannedStart.split('T')[0];
                      if (updates.plannedEnd) newEv.endDate = updates.plannedEnd.split('T')[0];
                      return newEv;
                    }
                    return ev;
                  }));
                  // If subject changed, we need to update selectedTask too for the modal UI
                  if (updates.subject) setSelectedTask(prev => prev ? ({ ...prev, subject: updates.subject }) : null);
                }}
              />
            )}

          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 opacity-60">
             <div className="w-32 h-32 border-4 border-dashed rounded-xl mb-4 flex items-center justify-center bg-slate-200/50">
                <Calendar className="w-12 h-12" />
             </div>
             <p className="font-medium tracking-wide">Configure project settings to build a Timeline.</p>
          </div>
        )}
      </div>

      {isBufferModalOpen && (
        <BufferModal 
          isOpen={isBufferModalOpen}
          taskId={bufferTaskId || ""}
          taskSubject={events.find(e => e.id === bufferTaskId)?.subject || ""}
          currentPadding={events.find(e => e.id === bufferTaskId)?.paddingDays || 0}
          onClose={() => setIsBufferModalOpen(false)}
          onSave={handleSaveBuffer}
        />
      )}
      </div>
    </div>
  );
}
