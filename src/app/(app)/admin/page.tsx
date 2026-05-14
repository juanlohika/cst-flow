"use client";

import { useState, useEffect } from "react";
import { Key, LayoutTemplate, Users, Calendar, Plus, Trash2, GripVertical, Save, Loader2, ChevronDown, ChevronRight, BookOpen, Pencil, X, RefreshCw, ToggleLeft, ToggleRight, Shield, Sparkles, ExternalLink, Tag, Download, Upload, Building2, AlertCircle, CheckCircle2, Network, KeyRound, UserCircle, Send, Server, Zap, Brain, Lock } from "lucide-react";
import * as XLSX from "xlsx";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface TemplateTask {
  id?: string;
  taskCode: string;
  subject: string;
  defaultDuration: number;
  sortOrder: number;
}

interface TimelineTemplate {
  id: string;
  name: string;
  description: string;
  restDays: string;
  type: string; // "project" | "account-maintenance"
  tasks: TemplateTask[];
}

interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory: string | null;
  slug: string | null;
  content: string;
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
}

// Category labels are derived dynamically from the App Builder — see categoryLabels() below

export default function AdminSettings() {
  const [activeTab, setActiveTab] = useState<"company" | "auth" | "apps" | "templates" | "users" | "skills" | "roles" | "org-chart">("company");
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Settings", href: "/admin" },
      { label: "Console" }
    ]);
  }, [setBreadcrumbs]);

  // App Builder state
  const [appList, setAppList] = useState<any[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appSeeding, setAppSeeding] = useState(false);
  const [editingApp, setEditingApp] = useState<any | null>(null);
  const [appSaving, setAppSaving] = useState(false);
  const [showNewAppForm, setShowNewAppForm] = useState(false);
  const [newApp, setNewApp] = useState({ name: "", slug: "", description: "", icon: "", href: "", provider: null as string | null });

  // Derived from appList — used by Skills category dropdowns
  const categoryLabels: Record<string, string> = {
    ...Object.fromEntries(appList.map((a: any) => [a.slug, a.name])),
    general: "General",
  };

  // AI provider state
  const [primaryProvider, setPrimaryProvider] = useState<"ollama" | "groq" | "gemini" | "claude">("groq");
  const [ollamaEndpoint, setOllamaEndpoint] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("llama3.2");
  const [groqApiKey, setGroqApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [providerStatus, setProviderStatus] = useState<Record<string, "idle"|"testing"|"ok"|"error">>({});

  // SMTP State
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpTestStatus, setSmtpTestStatus] = useState<"idle"|"testing"|"ok"|"error">("idle");
  const [smtpTestMsg, setSmtpTestMsg] = useState("");

  // Legacy single key (kept for prompt-saving compat)
  const [apiKey, setApiKey] = useState("");
  const [promptSwimlane, setPromptSwimlane] = useState("");
  const [promptRegular, setPromptRegular] = useState("");
  const [promptBrd, setPromptBrd] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  // Skills State
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillSeeding, setSkillSeeding] = useState(false);
  const [showNewSkillForm, setShowNewSkillForm] = useState(false);
  const [newSkill, setNewSkill] = useState({ name: "", description: "", category: "", subcategory: "", slug: "", content: "" });

  // Roles Masterfile State
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [roleSaving, setRoleSaving] = useState(false);

  // User Management State
  const [userList, setUserList] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: "", email: "" });
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok?: boolean; error?: string; emailError?: string } | null>(null);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [userSaving, setUserSaving] = useState(false);
  const [showEmailPreview, setShowEmailPreview] = useState(false);

  // Timeline Templates State
  const [templates, setTemplates] = useState<TimelineTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<TimelineTemplate | null>(null);
  const [templateStatus, setTemplateStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [dbAvailable, setDbAvailable] = useState(true);
  const [importingTemplate, setImportingTemplate] = useState(false);
  
  // Branding state
  const [branding, setBranding] = useState({ app_name: "Team OS", bottom_logo_url: "" });
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingStatus, setBrandingStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [appStatus, setAppStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(res => res.json())
      .then(data => { if (data) setBranding(prev => ({ ...prev, ...data })); })
      .catch(console.error)
      .finally(() => setBrandingLoading(false));
  }, []);

  const handleSaveBranding = async () => {
    setBrandingSaving(true);
    setBrandingStatus(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: branding }),
      });
      if (!res.ok) throw new Error("Failed to save branding");
      setBrandingStatus({ type: "success", message: "Branding saved!" });
      setTimeout(() => setBrandingStatus(null), 3000);
    } catch (error: any) {
      setBrandingStatus({ type: "error", message: error.message });
    } finally {
      setBrandingSaving(false);
    }
  };

  const DEFAULT_SWIMLANE = `Additional rules for Mermaid swimlane diagrams:
- Identify every distinct role, department, or actor and create a separate \`subgraph\` for each lane.
- Assign each process step to the correct subgraph based on who performs it.
- Keep decision labels as short questions (max 6 words).
- Use standard node shapes: Start/End: \`id([Label])\`, Process: \`id(Label)\`, Decision: \`id{Label}\`.
- Ensure every decision node has exactly two labeled outgoing edges: \`A -->|Yes| B\` and \`A -->|No| C\`.
- Connect steps logically using arrow edges (\`-->\`).`;

  const DEFAULT_BRD = `You are an expert Business Analyst writing a comprehensive Business Requirements Document (BRD).
Base it on the following transcribed process. Provide a professional Markdown format including:
1. Executive Summary & Context
2. Business Objectives
3. Key Stakeholders / User Roles
4. Detailed Process Steps
5. Technical Integrations & Dependencies
Keep it concise, strictly professional, and exceptionally formatted.`;

  useEffect(() => {
    // Load AI provider config from server
    fetch("/api/settings").then(r => r.json()).then(cfg => {
      if (cfg.primaryProvider) setPrimaryProvider(cfg.primaryProvider);
      if (cfg.ollamaEndpoint) setOllamaEndpoint(cfg.ollamaEndpoint);
      if (cfg.ollamaModel) setOllamaModel(cfg.ollamaModel);
      if (cfg.groqApiKey) setGroqApiKey(cfg.groqApiKey);
      if (cfg.geminiApiKey) setGeminiApiKey(cfg.geminiApiKey);
      if (cfg.anthropicApiKey) setAnthropicApiKey(cfg.anthropicApiKey);
      if (cfg.smtpHost) setSmtpHost(cfg.smtpHost);
      if (cfg.smtpPort) setSmtpPort(String(cfg.smtpPort));
      if (cfg.smtpSecure != null) setSmtpSecure(cfg.smtpSecure);
      if (cfg.smtpUser) setSmtpUser(cfg.smtpUser);
      if (cfg.smtpPass) setSmtpPass(cfg.smtpPass);
      if (cfg.smtpFrom) setSmtpFrom(cfg.smtpFrom);
    }).catch(() => {});

    // Prompts from localStorage
    const pSwimlane = localStorage.getItem("prompt_swimlane");
    if (pSwimlane && pSwimlane.includes("Mermaid")) {
      setPromptSwimlane(pSwimlane);
    } else {
      setPromptSwimlane(DEFAULT_SWIMLANE);
      localStorage.setItem("prompt_swimlane", DEFAULT_SWIMLANE);
    }
    const pRegular = localStorage.getItem("prompt_regular");
    if (pRegular) setPromptRegular(pRegular);
    const pBrd = localStorage.getItem("prompt_brd");
    if (pBrd) setPromptBrd(pBrd);
    else setPromptBrd(DEFAULT_BRD);
  }, []);

  // Load apps on mount so Skills tab can use them for the category dropdown
  useEffect(() => { loadApps(); }, []);

  // Load templates / skills / roles when tab activates
  useEffect(() => {
    if (activeTab === "templates") loadTemplates();
    if (activeTab === "skills") loadSkills();
    if (activeTab === "roles") loadRoles();
    if (activeTab === "apps") loadApps();
    if (activeTab === "users" || activeTab === "org-chart") {
      fetch("/api/users/ensure-admin", { method: "POST" }).catch(() => {});
      loadUsers();
      loadRoles();
    }
  }, [activeTab]);

  const loadApps = async () => {
    setAppsLoading(true);
    try {
      const res = await fetch("/api/apps");
      if (res.ok) setAppList(await res.json());
    } catch {}
    setAppsLoading(false);
  };

  const handleSeedApps = async () => {
    setAppSeeding(true);
    try {
      await fetch("/api/apps/seed", { method: "POST" });
      await loadApps();
    } catch {}
    setAppSeeding(false);
  };

  const handleSaveApp = async () => {
    if (!editingApp) return;
    setAppSaving(true);
    try {
      await fetch(`/api/apps/${editingApp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingApp.name,
          description: editingApp.description,
          icon: editingApp.icon,
          href: editingApp.href,
          isActive: editingApp.isActive,
          sortOrder: editingApp.sortOrder,
          provider: editingApp.provider ?? null,
        }),
      });
      setEditingApp(null);
      setAppStatus({ type: "success", message: "App updated successfully!" });
      setTimeout(() => setAppStatus(null), 5000);
      await loadApps();
    } catch (error: any) {
      setAppStatus({ type: "error", message: error.message });
      setTimeout(() => setAppStatus(null), 5000);
    }
    setAppSaving(false);
  };

  const handleCreateApp = async () => {
    if (!newApp.name || !newApp.slug || !newApp.href) return;
    try {
      await fetch("/api/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newApp),
      });
      setShowNewAppForm(false);
      setNewApp({ name: "", slug: "", description: "", icon: "", href: "", provider: null });
      await loadApps();
    } catch {}
  };

  const handleDeleteApp = async (id: string) => {
    if (!confirm("Delete this app?")) return;
    try {
      await fetch(`/api/apps/${id}`, { method: "DELETE" });
      await loadApps();
    } catch {}
  };

  const handleToggleApp = async (app: any) => {
    try {
      await fetch(`/api/apps/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !app.isActive }),
      });
      await loadApps();
    } catch {}
  };

  const loadRoles = async () => {
    setRolesLoading(true);
    try {
      const res = await fetch("/api/settings/roles");
      if (res.ok) setRoles(await res.json());
    } catch (err) { console.error(err); }
    setRolesLoading(false);
  };

  const addRole = async () => {
    if (!newRoleName.trim()) return;
    setRoleSaving(true);
    try {
      const res = await fetch("/api/settings/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newRoleName.trim() }),
      });
      if (res.ok) { setNewRoleName(""); await loadRoles(); }
    } catch (err) { console.error(err); }
    setRoleSaving(false);
  };

  const deleteRole = async (id: string) => {
    try {
      await fetch(`/api/settings/roles/${id}`, { method: "DELETE" });
      setRoles(prev => prev.filter(r => r.id !== id));
    } catch (err) { console.error(err); }
  };

  // ── User Management ─────────────────────────────────────────
  const loadUsers = async () => {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) setUserList(await res.json());
    } catch (err) { console.error(err); }
    setUsersLoading(false);
  };

  const sendInvite = async () => {
    if (!inviteForm.email.trim()) return;
    setInviteSending(true);
    setInviteResult(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inviteForm),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteResult({ ok: true, emailError: data.emailError });
        setInviteForm({ name: "", email: "" });
        setShowInviteForm(false);
        await loadUsers();
      } else {
        setInviteResult({ error: data.error });
      }
    } catch (err: any) {
      setInviteResult({ error: err.message });
    }
    setInviteSending(false);
  };

  const resendInvite = async (userId: string) => {
    try {
      const res = await fetch(`/api/users/${userId}/invite`, { method: "POST" });
      const data = await res.json();
      if (res.ok) alert("Invite resent successfully!");
      else alert(`Error: ${data.error}`);
    } catch (err: any) { alert(err.message); }
  };

  const updateUserField = async (userId: string, field: string, value: any) => {
    try {
      await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      setUserList(prev => prev.map(u => u.id === userId ? { ...u, [field]: value } : u));
    } catch (err) { console.error(err); }
  };

  const saveUserEdits = async () => {
    if (!editingUser) return;
    setUserSaving(true);
    try {
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingUser.name,
          role: editingUser.role,
          status: editingUser.status,
          profileRole: editingUser.profileRole || null,
          canAccessArchitect: editingUser.canAccessArchitect,
          canAccessBRD: editingUser.canAccessBRD,
          canAccessTimeline: editingUser.canAccessTimeline,
          canAccessTasks: editingUser.canAccessTasks,
          canAccessCalendar: editingUser.canAccessCalendar,
          canAccessMeetings: editingUser.canAccessMeetings,
          canAccessAccounts: editingUser.canAccessAccounts,
          canAccessSolutions: editingUser.canAccessSolutions,
          supervisorId: editingUser.supervisorId || null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setUserList(prev => prev.map(u => u.id === updated.id ? updated : u));
        setEditingUser(null);
      }
    } catch (err) { console.error(err); }
    setUserSaving(false);
  };

  const blockUser = async (userId: string) => {
    if (!confirm("Block this user? They will lose access to the system.")) return;
    await updateUserField(userId, "status", "blocked");
  };

  const approveUser = async (userId: string) => {
    await updateUserField(userId, "status", "active");
  };

  const MODULE_FLAGS = [
    { key: "canAccessTasks", label: "Tasks" },
    { key: "canAccessCalendar", label: "Calendar" },
    { key: "canAccessTimeline", label: "Timeline" },
    { key: "canAccessMeetings", label: "Meetings" },
    { key: "canAccessArchitect", label: "Architect" },
    { key: "canAccessBRD", label: "BRD" },
    { key: "canAccessAccounts", label: "Accounts" },
    { key: "canAccessSolutions", label: "Solutions" },
  ] as const;

  const loadSkills = async () => {
    setSkillsLoading(true);
    try {
      const res = await fetch("/api/skills?activeOnly=false");
      if (res.ok) setSkills(await res.json());
    } catch (err) { console.error(err); }
    setSkillsLoading(false);
  };

  const seedSkills = async () => {
    setSkillSeeding(true);
    try {
      const res = await fetch("/api/skills/seed", { method: "POST" });
      if (res.ok) { await loadSkills(); }
    } catch (err) { console.error(err); }
    setSkillSeeding(false);
  };

  const saveSkill = async (skill: Skill) => {
    setSkillSaving(true);
    try {
      const res = await fetch(`/api/skills/${skill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skill),
      });
      if (res.ok) { setEditingSkill(null); await loadSkills(); }
    } catch (err) { console.error(err); }
    setSkillSaving(false);
  };

  const toggleSkillActive = async (skill: Skill) => {
    try {
      await fetch(`/api/skills/${skill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !skill.isActive }),
      });
      await loadSkills();
    } catch (err) { console.error(err); }
  };

  const deleteSkill = async (skill: Skill) => {
    if (skill.isSystem) return;
    if (!confirm(`Delete skill "${skill.name}"? This cannot be undone.`)) return;
    try {
      await fetch(`/api/skills/${skill.id}`, { method: "DELETE" });
      await loadSkills();
    } catch (err) { console.error(err); }
  };

  const createSkill = async () => {
    if (!newSkill.name || !newSkill.category || !newSkill.content) return;
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSkill),
      });
      if (res.ok) {
        setShowNewSkillForm(false);
        setNewSkill({ name: "", description: "", category: "meeting-prep", subcategory: "", slug: "", content: "" });
        await loadSkills();
      }
    } catch (err) { console.error(err); }
  };

  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch("/api/templates");
      if (res.status === 503) {
        setDbAvailable(false);
        setTemplatesLoading(false);
        return;
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        setTemplates(data);
        setDbAvailable(true);
      }
    } catch {
      setDbAvailable(false);
    }
    setTemplatesLoading(false);
  };

  // Save a specific provider key directly — bypasses the form entirely
  const [cardSaving, setCardSaving] = useState<string | null>(null);
  const [cardSaved, setCardSaved] = useState<string | null>(null);

  const saveCard = async (cardId: string, patch: Record<string, string>) => {
    setCardSaving(cardId);
    try {
      // Read current config first so we don't overwrite other fields
      const existing = await fetch("/api/settings").then(r => r.json()).catch(() => ({}));
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...existing, ...patch }),
      });
      if (!res.ok) throw new Error("Save failed");
      setCardSaved(cardId);
      setTimeout(() => setCardSaved(null), 3000);
    } catch {
      alert("Failed to save. Check the browser console for details.");
    } finally {
      setCardSaving(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");

    try {
      if (promptSwimlane) localStorage.setItem("prompt_swimlane", promptSwimlane);
      if (promptRegular) localStorage.setItem("prompt_regular", promptRegular);
      if (promptBrd) localStorage.setItem("prompt_brd", promptBrd);
      // Keep legacy key in sync for timeline/architect pages
      const activeKey = primaryProvider === "groq" ? groqApiKey : primaryProvider === "gemini" ? geminiApiKey : primaryProvider === "claude" ? anthropicApiKey : "";
      if (activeKey) localStorage.setItem("gemini_api_key", activeKey);

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryProvider,
          ollamaEndpoint: ollamaEndpoint.trim(),
          ollamaModel: ollamaModel.trim(),
          groqApiKey: groqApiKey.trim(),
          geminiApiKey: geminiApiKey.trim(),
          anthropicApiKey: anthropicApiKey.trim(),
          smtpHost: smtpHost.trim(),
          smtpPort: smtpPort.trim(),
          smtpSecure,
          smtpUser: smtpUser.trim(),
          smtpPass: smtpPass.trim(),
          smtpFrom: smtpFrom.trim(),
        }),
      });
      if (!res.ok) throw new Error("Save failed");

      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 5000);
    }
  };

  const saveTemplate = async (tmpl: TimelineTemplate) => {
    setTemplateStatus("saving");
    try {
      const res = await fetch(`/api/templates/${tmpl.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tmpl),
      });
      if (res.ok) {
        setTemplateStatus("saved");
        setTimeout(() => setTemplateStatus("idle"), 2000);
        loadTemplates();
        setEditingTemplate(null);
      } else {
        setTemplateStatus("error");
      }
    } catch {
      setTemplateStatus("error");
    }
  };

  const createNewTemplate = async () => {
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `New Template ${Date.now()}`,
          description: "Custom timeline template",
          type: "project",
          tasks: [{ taskCode: "TASK-0001", subject: "First Task", defaultDuration: 8 }],
        }),
      });
      if (res.ok) {
        const created = await res.json();
        await loadTemplates();
        // Auto-open the new template for editing
        setExpandedTemplate(created.id);
        setEditingTemplate(created);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm("Delete this template and all its tasks?")) return;
    try {
      await fetch(`/api/templates/${id}`, { method: "DELETE" });
      loadTemplates();
    } catch (err) {
      console.error(err);
    }
  };

  // ── Excel Download / Import helpers ──
  const downloadTemplateExcel = () => {
    const wb = XLSX.utils.book_new();
    // Instructions sheet
    const instrData = [
      ["Timeline Template — Import Instructions"],
      [""],
      ["1. Go to the 'Template' sheet tab"],
      ["2. Fill in row 2: Template Name (required), Description, Rest Days, Type"],
      ["3. Fill in the tasks starting from row 5 — one row per task"],
      ["4. Save this file as .xlsx and upload it via Admin → Templates → Import"],
      [""],
      ["Type must be either: project  OR  account-maintenance"],
      ["Rest Days example: Saturday,Sunday"],
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instrData);
    wsInstr["!cols"] = [{ wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, "Instructions");
    // Template sheet
    const tmplData = [
      ["Template Name", "Description", "Rest Days", "Type"],
      ["My New Template", "Template description here", "Saturday,Sunday", "project"],
      [""],
      ["Task Code", "Subject", "Default Duration (hrs)"],
      ["CST-0001", "Kickoff Meeting", 8],
      ["CST-0002", "Requirements Gathering", 16],
      ["CST-0003", "Configuration", 24],
      ["CST-0004", "Testing & QA", 16],
      ["CST-0005", "Training", 8],
      ["CST-0006", "Go-Live", 4],
    ];
    const wsTmpl = XLSX.utils.aoa_to_sheet(tmplData);
    wsTmpl["!cols"] = [{ wch: 20 }, { wch: 40 }, { wch: 22 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsTmpl, "Template");
    XLSX.writeFile(wb, "timeline_template_import.xlsx");
  };

  const handleImportTemplate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingTemplate(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      // Find the "Template" sheet, or fall back to the second sheet, or the first
      const wsName = wb.SheetNames.find(n => n.toLowerCase() === "template") || wb.SheetNames[1] || wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

      if (rows.length < 5) {
        alert("The file does not match the expected format. Please download the template first and follow the instructions.");
        setImportingTemplate(false);
        return;
      }

      // Row 0: header [Template Name, Description, Rest Days, Type]
      // Row 1: values
      const templateName = String(rows[1]?.[0] || "").trim();
      const description = String(rows[1]?.[1] || "").trim();
      const restDays = String(rows[1]?.[2] || "Saturday,Sunday").trim();
      const type = String(rows[1]?.[3] || "project").trim();

      if (!templateName) {
        alert("Template Name (row 2, column A) is required.");
        setImportingTemplate(false);
        return;
      }

      // Row 3: task headers [Task Code, Subject, Default Duration (hrs)]
      // Row 4+: task data
      const tasks: { taskCode: string; subject: string; defaultDuration: number }[] = [];
      for (let i = 4; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0] || !row[1]) continue; // skip empty rows
        tasks.push({
          taskCode: String(row[0]).trim(),
          subject: String(row[1]).trim(),
          defaultDuration: parseFloat(row[2]) || 8,
        });
      }

      if (tasks.length === 0) {
        alert("No tasks found in the file. Tasks should start from row 5.");
        setImportingTemplate(false);
        return;
      }

      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: templateName, description, restDays, type, tasks }),
      });

      if (res.ok) {
        await loadTemplates();
        const created = await res.json();
        setExpandedTemplate(created.id);
        alert(`Template "${templateName}" imported with ${tasks.length} tasks!`);
      } else {
        const err = await res.json();
        alert(`Import failed: ${err.error || "Unknown error"}`);
      }
    } catch (err: any) {
      console.error(err);
      alert("Failed to parse the Excel file. Make sure it follows the template format.");
    }
    setImportingTemplate(false);
    // Reset the file input so the same file can be re-uploaded
    e.target.value = "";
  };

  // ── Editing helpers ──
  const startEditing = (tmpl: TimelineTemplate) => {
    setEditingTemplate(JSON.parse(JSON.stringify(tmpl)));
    setExpandedTemplate(tmpl.id);
  };

  const updateEditingTask = (idx: number, field: string, value: any) => {
    if (!editingTemplate) return;
    const tasks = [...editingTemplate.tasks];
    (tasks[idx] as any)[field] = value;
    setEditingTemplate({ ...editingTemplate, tasks });
  };

  const addEditingTask = () => {
    if (!editingTemplate) return;
    const next = editingTemplate.tasks.length + 1;
    setEditingTemplate({
      ...editingTemplate,
      tasks: [...editingTemplate.tasks, {
        taskCode: `TASK-${String(next).padStart(4, "0")}`,
        subject: "",
        defaultDuration: 8,
        sortOrder: next,
      }],
    });
  };

  const removeEditingTask = (idx: number) => {
    if (!editingTemplate) return;
    const tasks = editingTemplate.tasks.filter((_, i) => i !== idx);
    setEditingTemplate({ ...editingTemplate, tasks });
  };

  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── Tabs Bar ────────────────────────────────────────────── */}
      <div className="flex items-end px-4 flex-shrink-0"
        style={{ height: 40, borderBottom: '1px solid #E9EAEB', background: '#fff' }}>
        {([
          { id: "company",   label: "Company",      Icon: Building2 },
          { id: "users",     label: "Users",        Icon: Users    },
          { id: "org-chart", label: "Org Chart",    Icon: Network  },
          { id: "roles",     label: "Roles",        Icon: Shield   },
          { id: "auth",      label: "Credentials",  Icon: Key      },
          { id: "apps",      label: "App Builder",  Icon: Sparkles },
          { id: "templates", label: "Templates",    Icon: Calendar },
          { id: "skills",    label: "Skills",       Icon: BookOpen },
        ] as const).map(tab => (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id as any)}
            className="flex items-center gap-1.5 px-3 h-full whitespace-nowrap transition-colors"
            style={{
              fontSize: 12,
              fontWeight: activeTab === tab.id ? 500 : 400,
              color: activeTab === tab.id ? '#252B37' : '#717680',
              borderBottom: activeTab === tab.id ? '2px solid #252B37' : '2px solid transparent',
            }}>
            <tab.Icon size={14} strokeWidth={2} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <form onSubmit={handleSave} className="h-full flex flex-col">
          <div className={activeTab !== "users" && activeTab !== "company" ? "p-8 max-w-4xl mx-auto w-full space-y-6 flex flex-col flex-1" : "flex flex-col flex-1 h-full"}>
            
            {activeTab === "company" && (
              <div className="p-8 max-w-2xl mx-auto w-full space-y-8 animate-in fade-in duration-300">
                <header className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 tracking-tight flex items-center gap-2">
                       <Building2 className="w-5 h-5 text-primary" />
                       Company Branding
                    </h2>
                    <p className="text-xs text-slate-500 font-medium">Identity settings for the system UI.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveBranding}
                    disabled={brandingSaving}
                    className="px-6 py-2 bg-primary text-white rounded-xl text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {brandingSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    {brandingSaving ? "Saving..." : "Save Branding"}
                  </button>
                </header>

                {brandingStatus && (
                  <div className={`p-3 rounded-xl border flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-top-1 ${
                    brandingStatus.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700'
                  }`}>
                    {brandingStatus.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {brandingStatus.message}
                  </div>
                )}

                <div className="space-y-6 bg-slate-50/50 p-6 rounded-2xl border border-slate-100">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Application Name</label>
                    <input
                      value={branding.app_name}
                      onChange={e => setBranding(prev => ({ ...prev, app_name: e.target.value }))}
                      className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                      placeholder="e.g. FlowDesk"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Sidebar Bottom Logo URL</label>
                    <input
                      value={branding.bottom_logo_url}
                      onChange={e => setBranding(prev => ({ ...prev, bottom_logo_url: e.target.value }))}
                      className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                      placeholder="https://example.com/logo.svg"
                    />
                  </div>

                  {branding.bottom_logo_url && (
                    <div className="pt-4 border-t border-slate-200">
                       <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 ml-1 text-center">Preview</p>
                       <div className="flex items-center justify-center p-6 bg-white rounded-xl border border-slate-100 shadow-sm min-h-[80px]">
                         <img src={branding.bottom_logo_url} alt="Logo Preview" className="max-h-10 w-auto object-contain" />
                       </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {activeTab === "auth" && (
              <div className="space-y-6 flex-1 animate-in fade-in zoom-in-95 duration-200">
                {/* Access Codes callout */}
                <a
                  href="/admin/access-codes"
                  className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <KeyRound className="w-4 h-4 text-slate-600" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">Account Access Codes</p>
                    <p className="text-[11px] text-slate-500">
                      Manage Client Codes + Access Tokens for every account in one place.
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </a>

                {/* Portal Contacts callout */}
                <a
                  href="/admin/portal-contacts"
                  className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4 text-slate-600" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">ARIMA · Portal Contacts</p>
                    <p className="text-[11px] text-slate-500">
                      Invite external client contacts to chat with ARIMA via magic link.
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </a>

                {/* Channels callout */}
                <a
                  href="/admin/telegram"
                  className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Send className="w-4 h-4 text-slate-600" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">ARIMA · Telegram Channel</p>
                    <p className="text-[11px] text-slate-500">
                      Configure the Telegram bot for ARIMA: bot token, webhook, group bindings.
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </a>

                {/* Tools callout */}
                <a
                  href="/admin/arima-tools"
                  className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-slate-600" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">ARIMA · Tools Registry</p>
                    <p className="text-[11px] text-slate-500">
                      Control which actions ARIMA can take (read profile, capture request, schedule meeting, etc.) and require approval for sensitive ones.
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </a>

                {/* Check-ins callout */}
                <a
                  href="/admin/arima-checkins"
                  className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4 text-slate-600" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">ARIMA · Proactive Check-ins</p>
                    <p className="text-[11px] text-slate-500">
                      Set cadence rules, view scheduled clients, run the daily check-in job, and review the history.
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </a>

                {/* Analytics callout */}
                <a
                  href="/admin/arima-analytics"
                  className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Network className="w-4 h-4 text-slate-600" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">ARIMA · Analytics</p>
                    <p className="text-[11px] text-slate-500">
                      Conversation volume, request flow, check-in response rate, tool usage, and channel coverage.
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </a>

                {/* Guardrails callout */}
                <a
                  href="/admin/arima-guardrails"
                  className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Shield className="w-4 h-4 text-slate-600" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">ARIMA · Guardrails</p>
                    <p className="text-[11px] text-slate-500">
                      Safety rules: forbidden topics, forbidden phrases, escalation triggers, off-hours behavior, and required disclosures.
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </a>

                {/* Phase 20: Knowledge Repository — shared brain for every agent */}
                <a
                  href="/admin/knowledge"
                  className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4 text-slate-600" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">Knowledge Repository</p>
                    <p className="text-[11px] text-slate-500">
                      Shared brain for ARIMA · Eliana · future agents. Upload playbooks (PDF/MD), post product updates, maintain the Tarkie module catalog.
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </a>

                {/* Phase 21.1: Agent debug — raw I/O per turn */}
                <a
                  href="/admin/arima-debug"
                  className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <ExternalLink className="w-4 h-4 text-slate-600" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">Agent Debug · Raw I/O</p>
                    <p className="text-[11px] text-slate-500">
                      Per-turn diagnostic log: system prompt sent, raw model output, function calls attempted, whether a BRD/request was emitted. Use this to debug why an agent did or didn't capture something.
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </a>

                <h3 className="font-semibold text-base flex items-center gap-2 border-b pb-4 text-slate-800">
                  <Lock className="w-4 h-4 text-slate-500" strokeWidth={2} />
                  AI Provider Settings
                </h3>

                {/* Provider selector */}
                <div className="space-y-2">
                  <label className="text-sm font-bold">Primary AI Provider</label>
                  <p className="text-xs text-muted-foreground">The system will use this provider for all AI features. Falls back to the next if unavailable.</p>
                  <div className="grid grid-cols-4 gap-3 pt-1">
                    {([
                      { id: "ollama", label: "Ollama",  badge: "Local · Private · Free",        color: "green"  },
                      { id: "groq",   label: "Groq",    badge: "Cloud · Free tier",              color: "purple" },
                      { id: "gemini", label: "Gemini",  badge: "Cloud · Free (no billing)",      color: "blue"   },
                      { id: "claude", label: "Claude",  badge: "Best quality · Anthropic",       color: "orange" },
                    ] as const).map(p => (
                      <button key={p.id} type="button" onClick={() => setPrimaryProvider(p.id)}
                        className={`flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 transition-all text-center ${primaryProvider === p.id ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40"}`}>
                        <span className="text-sm font-bold">{p.label}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${p.color === "green" ? "bg-green-100 text-green-700" : p.color === "purple" ? "bg-purple-100 text-purple-700" : p.color === "orange" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>{p.badge}</span>
                        {primaryProvider === p.id && <span className="text-[10px] font-bold text-primary">● ACTIVE</span>}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ollama config */}
                <div className={`space-y-3 rounded-xl border p-4 transition-all ${primaryProvider === "ollama" ? "border-green-200 bg-green-50/30" : "border-border opacity-60"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                        <Server className="w-3.5 h-3.5 text-slate-500" strokeWidth={2} />
                        Ollama (Local AI)
                      </span>
                      <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">100% Private · No internet needed</span>
                    </div>
                    <button type="button" onClick={() => saveCard("ollama", { ollamaEndpoint, ollamaModel })} disabled={cardSaving === "ollama"}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-all">
                      {cardSaving === "ollama" ? <Loader2 className="h-3 w-3 animate-spin" /> : cardSaved === "ollama" ? "✓ Saved!" : "Save"}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Endpoint</label>
                      <input value={ollamaEndpoint} onChange={e => setOllamaEndpoint(e.target.value)}
                        className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm"
                        placeholder="http://localhost:11434" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Model</label>
                      <input value={ollamaModel} onChange={e => setOllamaModel(e.target.value)}
                        className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm"
                        placeholder="llama3.2" />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Install: <strong>ollama.com</strong> → then run <code className="bg-muted px-1 rounded">ollama pull llama3.2</code> in Terminal</p>
                </div>

                {/* Groq config */}
                <div className={`space-y-3 rounded-xl border p-4 transition-all ${primaryProvider === "groq" ? "border-purple-200 bg-purple-50/30" : "border-border opacity-60"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-slate-500" strokeWidth={2} />
                        Groq
                      </span>
                      <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">Free tier · Fast · console.groq.com</span>
                    </div>
                    <button type="button" onClick={() => saveCard("groq", { groqApiKey })} disabled={cardSaving === "groq" || !groqApiKey}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-all">
                      {cardSaving === "groq" ? <Loader2 className="h-3 w-3 animate-spin" /> : cardSaved === "groq" ? "✓ Saved!" : "Save Key"}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">API Key</label>
                    <input type="password" value={groqApiKey} onChange={e => setGroqApiKey(e.target.value)}
                      className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm font-mono"
                      placeholder="gsk_..." />
                  </div>
                </div>

                {/* Gemini config */}
                <div className={`space-y-3 rounded-xl border p-4 transition-all ${primaryProvider === "gemini" ? "border-blue-200 bg-blue-50/30" : "border-border opacity-60"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-slate-500" strokeWidth={2} />
                        Google Gemini
                      </span>
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Free only on non-billing projects · aistudio.google.com</span>
                    </div>
                    <button type="button" onClick={() => saveCard("gemini", { geminiApiKey })} disabled={cardSaving === "gemini" || !geminiApiKey}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-all">
                      {cardSaving === "gemini" ? <Loader2 className="h-3 w-3 animate-spin" /> : cardSaved === "gemini" ? "✓ Saved!" : "Save Key"}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">API Key</label>
                    <input type="password" value={geminiApiKey} onChange={e => setGeminiApiKey(e.target.value)}
                      className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm font-mono"
                      placeholder="AIza..." />
                  </div>
                </div>

                {/* Claude config */}
                <div className={`space-y-3 rounded-xl border p-4 transition-all ${primaryProvider === "claude" ? "border-orange-200 bg-orange-50/30" : "border-border opacity-60"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                        <Brain className="w-3.5 h-3.5 text-slate-500" strokeWidth={2} />
                        Claude (Anthropic)
                      </span>
                      <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">Best quality · console.anthropic.com</span>
                    </div>
                    <button type="button" onClick={() => saveCard("claude", { anthropicApiKey })} disabled={cardSaving === "claude" || !anthropicApiKey}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-all">
                      {cardSaving === "claude" ? <Loader2 className="h-3 w-3 animate-spin" /> : cardSaved === "claude" ? "✓ Saved!" : "Save Key"}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">API Key</label>
                    <input type="password" value={anthropicApiKey} onChange={e => setAnthropicApiKey(e.target.value)}
                      className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm font-mono"
                      placeholder="sk-ant-..." />
                  </div>
                  {anthropicApiKey && <p className="text-[11px] text-green-600 font-medium">✓ Key saved</p>}
                  <p className="text-[11px] text-muted-foreground">
                    Even if another provider is primary, <strong>Mockup Maker always uses Claude</strong> when this key is set — it produces significantly better HTML output.
                  </p>
                </div>

                {/* ─── SMTP / Email ───────────────────────────────────── */}
                <div className="space-y-4 rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                        📧 Email / SMTP Configuration
                      </h4>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Required for sending invite emails to new users. Works with Gmail, SendGrid, Resend, Brevo, or any SMTP provider.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={smtpTestStatus === "testing"}
                      onClick={async () => {
                        setSmtpTestStatus("testing"); setSmtpTestMsg("");
                        try {
                          const res = await fetch("/api/settings/test-email", { method: "POST" });
                          const d = await res.json();
                          if (res.ok) { setSmtpTestStatus("ok"); setSmtpTestMsg(`Test sent to ${d.to}`); }
                          else { setSmtpTestStatus("error"); setSmtpTestMsg(d.error); }
                        } catch (e: any) { setSmtpTestStatus("error"); setSmtpTestMsg(e.message); }
                        setTimeout(() => setSmtpTestStatus("idle"), 6000);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                        smtpTestStatus === "ok" ? "bg-green-50 text-green-700 border-green-200" :
                        smtpTestStatus === "error" ? "bg-red-50 text-red-600 border-red-200" :
                        "hover:bg-slate-50 text-slate-600 border-border"}`}>
                      {smtpTestStatus === "testing" ? <><Loader2 className="w-3 h-3 animate-spin" /> Testing…</> :
                       smtpTestStatus === "ok" ? "✓ Sent!" :
                       smtpTestStatus === "error" ? "✖ Failed" :
                       <><Sparkles className="w-3 h-3" /> Send Test Email</>}
                    </button>
                  </div>

                  {smtpTestMsg && (
                    <p className={`text-[11px] px-3 py-1.5 rounded-lg ${smtpTestStatus === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                      {smtpTestMsg}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">SMTP Host</label>
                      <input value={smtpHost} onChange={e => setSmtpHost(e.target.value)}
                        placeholder="smtp.gmail.com"
                        className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm font-mono" />
                    </div>
                    <div className="grid grid-cols-[1fr_80px_auto] gap-2 items-end">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Port</label>
                        <input value={smtpPort} onChange={e => setSmtpPort(e.target.value)}
                          placeholder="587"
                          className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm font-mono" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">SSL</label>
                        <button type="button" onClick={() => setSmtpSecure(v => !v)}
                          className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-all ${smtpSecure ? "bg-green-50 border-green-300 text-green-700" : "bg-slate-50 border-slate-200 text-slate-500"}`}>
                          {smtpSecure ? "TLS On" : "Off"}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Username / Email</label>
                      <input value={smtpUser} onChange={e => setSmtpUser(e.target.value)}
                        placeholder="your@gmail.com"
                        className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm font-mono" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Password / App Password</label>
                      <input type="password" value={smtpPass} onChange={e => setSmtpPass(e.target.value)}
                        placeholder="xxxx xxxx xxxx xxxx"
                        className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm font-mono" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">From Address (displayed in inbox)</label>
                      <input value={smtpFrom} onChange={e => setSmtpFrom(e.target.value)}
                        placeholder='"Tarkie Team OS" <your@gmail.com>'
                        className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm font-mono" />
                    </div>
                  </div>

                  <div className="text-[11px] text-muted-foreground space-y-0.5 bg-slate-50 rounded-lg p-3">
                    <p className="font-semibold text-slate-600">Quick setup guides:</p>
                    <p>• <strong>Gmail</strong>: Enable 2FA → myaccount.google.com/apppasswords → create App Password. Use port 587, SSL off.</p>
                    <p>• <strong>Brevo (free 300/day)</strong>: brevo.com → SMTP & API → SMTP tab. Use smtp-relay.brevo.com port 587.</p>
                    <p>• <strong>Resend</strong>: resend.com → API Keys → use smtp.resend.com port 465, SSL on, user = resend.</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "apps" && (
              <div className="space-y-6 flex-1 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between border-b pb-4">
                  <div>
                    <h3 className="font-bold text-xl flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> App Builder</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">Manage AI apps available in the system. Each app&apos;s slug maps to its Skills (category = slug).</p>
                    {appStatus && (
                      <div className={`mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium animate-in fade-in slide-in-from-top-1 ${
                        appStatus.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
                      }`}>
                        {appStatus.type === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                        {appStatus.message}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={handleSeedApps} disabled={appSeeding}
                      className="flex items-center gap-1.5 px-3 py-2 border border-border-default rounded-lg text-sm font-medium hover:bg-muted transition-all disabled:opacity-50">
                      <RefreshCw className={`h-3.5 w-3.5 ${appSeeding ? "animate-spin" : ""}`} /> Seed Built-ins
                    </button>
                    <button type="button" onClick={() => setShowNewAppForm(true)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-all">
                      <Plus className="h-4 w-4" /> New App
                    </button>
                  </div>
                </div>

                {/* New app form */}
                {showNewAppForm && (
                  <div className="border border-primary/30 rounded-xl p-4 bg-primary/5 space-y-3">
                    <p className="text-sm font-bold text-primary">New App</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">Name *</label>
                        <input value={newApp.name} onChange={e => setNewApp({ ...newApp, name: e.target.value })}
                          placeholder="e.g. BRD Maker" className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">Slug * <span className="font-normal text-muted-foreground">(matches Skill.category)</span></label>
                        <input value={newApp.slug} onChange={e => setNewApp({ ...newApp, slug: e.target.value })}
                          placeholder="e.g. brd" className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">Route (href) *</label>
                        <input value={newApp.href} onChange={e => setNewApp({ ...newApp, href: e.target.value })}
                          placeholder="e.g. /brd" className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">Icon (lucide name)</label>
                        <input value={newApp.icon} onChange={e => setNewApp({ ...newApp, icon: e.target.value })}
                          placeholder="e.g. FileText" className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">Description</label>
                        <input value={newApp.description} onChange={e => setNewApp({ ...newApp, description: e.target.value })}
                          placeholder="What this app does…" className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">AI Provider</label>
                        <select value={newApp.provider ?? ""} onChange={e => setNewApp({ ...newApp, provider: e.target.value || null })}
                          className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white">
                          <option value="">Global default</option>
                          <option value="claude">Claude (Anthropic)</option>
                          <option value="gemini">Gemini</option>
                          <option value="groq">Groq</option>
                          <option value="ollama">Ollama</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={() => setShowNewAppForm(false)} className="px-3 py-1.5 text-sm text-slate-500 hover:bg-muted rounded-lg transition-all">Cancel</button>
                      <button type="button" onClick={handleCreateApp} disabled={!newApp.name || !newApp.slug || !newApp.href}
                        className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50">Create App</button>
                    </div>
                  </div>
                )}

                {appsLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading apps...
                  </div>
                ) : appList.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Sparkles className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">No apps yet. Click &quot;Seed Built-ins&quot; to load the default apps.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {appList.map(app => (
                      <div key={app.id} className={`border rounded-xl p-4 transition-all ${app.isActive ? "bg-white border-slate-200" : "bg-slate-50 border-slate-100 opacity-60"}`}>
                        {editingApp?.id === app.id ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs font-medium text-slate-600 mb-1 block">Name</label>
                                <input value={editingApp.name} onChange={e => setEditingApp({ ...editingApp, name: e.target.value })}
                                  className="w-full px-2 py-1.5 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                              </div>
                              <div>
                                <label className="text-xs font-medium text-slate-600 mb-1 block">Route (href)</label>
                                <input value={editingApp.href} onChange={e => setEditingApp({ ...editingApp, href: e.target.value })}
                                  className="w-full px-2 py-1.5 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                              </div>
                              <div>
                                <label className="text-xs font-medium text-slate-600 mb-1 block">Icon</label>
                                <input value={editingApp.icon ?? ""} onChange={e => setEditingApp({ ...editingApp, icon: e.target.value })}
                                  className="w-full px-2 py-1.5 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                              </div>
                              <div>
                                <label className="text-xs font-medium text-slate-600 mb-1 block">Sort Order</label>
                                <input type="number" value={editingApp.sortOrder} onChange={e => setEditingApp({ ...editingApp, sortOrder: parseInt(e.target.value) || 0 })}
                                  className="w-full px-2 py-1.5 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs font-medium text-slate-600 mb-1 block">Description</label>
                                <input value={editingApp.description ?? ""} onChange={e => setEditingApp({ ...editingApp, description: e.target.value })}
                                  className="w-full px-2 py-1.5 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                              </div>
                              <div>
                                <label className="text-xs font-medium text-slate-600 mb-1 block">AI Provider</label>
                                <select value={editingApp.provider ?? ""} onChange={e => setEditingApp({ ...editingApp, provider: e.target.value || null })}
                                  className="w-full px-2 py-1.5 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white">
                                  <option value="">Global default</option>
                                  <option value="claude">Claude (Anthropic)</option>
                                  <option value="gemini">Gemini</option>
                                  <option value="groq">Groq</option>
                                  <option value="ollama">Ollama</option>
                                </select>
                              </div>
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button type="button" onClick={() => setEditingApp(null)} className="px-3 py-1.5 text-sm text-slate-500 hover:bg-muted rounded-lg">Cancel</button>
                              <button type="button" onClick={handleSaveApp} disabled={appSaving}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">
                                <Save className="h-3.5 w-3.5" /> {appSaving ? "Saving…" : "Save"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm text-slate-800">{app.name}</span>
                                <code className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">{app.slug}</code>
                                {app.isBuiltIn && <span className="text-[9px] font-bold bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full uppercase">built-in</span>}
                                {!app.isActive && <span className="text-[9px] font-bold bg-slate-200 text-slate-400 px-1.5 py-0.5 rounded-full uppercase">inactive</span>}
                              </div>
                              {app.description && <p className="text-xs text-slate-500 mt-0.5">{app.description}</p>}
                              <div className="flex items-center gap-3 mt-1">
                                <span className="text-[10px] text-slate-400 flex items-center gap-1"><ExternalLink className="h-2.5 w-2.5" />{app.href}</span>
                                <span className="text-[10px] text-slate-400 flex items-center gap-1"><Tag className="h-2.5 w-2.5" />Skills: category=&quot;{app.slug}&quot;</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button type="button" onClick={() => handleToggleApp(app)} title={app.isActive ? "Deactivate" : "Activate"}
                                className="p-1.5 rounded-md hover:bg-slate-100 transition-all text-slate-400">
                                {app.isActive ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4" />}
                              </button>
                              <button type="button" onClick={() => setEditingApp({ ...app })} className="p-1.5 rounded-md hover:bg-slate-100 transition-all text-slate-400">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {!app.isBuiltIn && (
                                <button type="button" onClick={() => handleDeleteApp(app.id)} className="p-1.5 rounded-md hover:bg-red-50 transition-all text-slate-300 hover:text-red-500">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-4 border-t">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" />
                    To manage the knowledge base for each app, go to the <button type="button" onClick={() => setActiveTab("skills")} className="text-primary underline underline-offset-2">Skills</button> tab and filter by the app&apos;s slug as category.
                  </p>
                </div>
              </div>
            )}

            {activeTab === "templates" && (
              <div className="space-y-6 flex-1 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between border-b pb-4">
                  <h3 className="font-bold text-xl flex items-center gap-2">
                    📋 Timeline Templates
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={downloadTemplateExcel}
                      className="flex items-center gap-1.5 px-3 py-2 border border-border-default rounded-lg text-sm font-medium hover:bg-muted transition-all"
                    >
                      <Download className="h-3.5 w-3.5" /> Download Template
                    </button>
                    <label
                      className={`flex items-center gap-1.5 px-3 py-2 border border-border-default rounded-lg text-sm font-medium hover:bg-muted transition-all cursor-pointer ${importingTemplate ? "opacity-50 pointer-events-none" : ""}`}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {importingTemplate ? "Importing…" : "Import Excel"}
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleImportTemplate}
                        className="sr-only"
                        disabled={importingTemplate}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={createNewTemplate}
                      className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-all shadow-sm"
                    >
                      <Plus className="h-4 w-4" /> Add Template
                    </button>
                  </div>
                </div>

                {!dbAvailable ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center space-y-3">
                    <Calendar className="h-12 w-12 text-amber-300 mx-auto" />
                    <h4 className="font-bold text-amber-700">Database Connection Issue</h4>
                    <p className="text-sm text-amber-600 max-w-md mx-auto">
                      Could not reach the database. Please ensure your <strong>DATABASE_URL</strong> is correctly configured.
                    </p>
                  </div>
                ) : templatesLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading templates...
                  </div>
                ) : templates.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p>No templates yet. Click &quot;Add Template&quot; to get started.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {templates.map((tmpl) => {
                      const isExpanded = expandedTemplate === tmpl.id;
                      const isEditing = editingTemplate?.id === tmpl.id;
                      const displayTmpl = isEditing ? editingTemplate! : tmpl;

                      return (
                        <div key={tmpl.id} className="border rounded-xl overflow-hidden bg-white shadow-sm">
                          {/* Header */}
                          <div
                            className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                            onClick={() => setExpandedTemplate(isExpanded ? null : tmpl.id)}
                          >
                            <div className="flex items-center gap-3">
                              {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                              <div>
                                {isEditing ? (
                                  <input
                                    value={editingTemplate!.name}
                                    onChange={(e) => setEditingTemplate({ ...editingTemplate!, name: e.target.value })}
                                    onClick={(e) => e.stopPropagation()}
                                    className="font-bold text-base border-b border-primary/50 focus:outline-none bg-transparent"
                                  />
                                ) : (
                                  <h4 className="font-bold text-base">{tmpl.name}</h4>
                                )}
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {tmpl.tasks.length} tasks • Rest: {tmpl.restDays}
                                  {" • "}
                                  {isEditing ? (
                                    <select
                                      value={editingTemplate!.type || "project"}
                                      onChange={(e) => setEditingTemplate({ ...editingTemplate!, type: e.target.value })}
                                      onClick={(e) => e.stopPropagation()}
                                      className="border rounded px-1 py-0.5 text-xs bg-white ml-1"
                                    >
                                      <option value="project">Project</option>
                                      <option value="account-maintenance">Account Maintenance</option>
                                    </select>
                                  ) : (
                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${tmpl.type === "account-maintenance" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                                      {tmpl.type === "account-maintenance" ? "Account Maintenance" : "Project"}
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              {isEditing ? (
                                <>
                                  <button type="button" onClick={() => saveTemplate(editingTemplate!)} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700">
                                    <Save className="h-3 w-3" /> {templateStatus === "saving" ? "Saving..." : "Save"}
                                  </button>
                                  <button type="button" onClick={() => setEditingTemplate(null)} className="px-3 py-1.5 bg-muted text-muted-foreground rounded-lg text-xs font-bold hover:bg-muted/80">
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button type="button" onClick={() => startEditing(tmpl)} className="px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-xs font-bold hover:bg-primary/20">
                                    Edit
                                  </button>
                                  <button type="button" onClick={() => deleteTemplate(tmpl.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Tasks Table */}
                          {isExpanded && (
                            <div className="border-t px-4 pb-4">
                              <table className="w-full text-sm mt-3">
                                <thead>
                                  <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
                                    <th className="pb-2 w-8">#</th>
                                    <th className="pb-2 w-48">Task Code</th>
                                    <th className="pb-2">Subject</th>
                                    <th className="pb-2 w-32 text-right">Duration (hrs)</th>
                                    {isEditing && <th className="pb-2 w-8"></th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {displayTmpl.tasks.map((task, idx) => (
                                    <tr key={idx} className="border-t border-dashed hover:bg-muted/20">
                                      <td className="py-2 text-muted-foreground">{idx + 1}</td>
                                      <td className="py-2">
                                        {isEditing ? (
                                          <input value={task.taskCode} onChange={(e) => updateEditingTask(idx, "taskCode", e.target.value)} className="w-full border rounded px-2 py-1 text-xs font-mono bg-muted/30" />
                                        ) : (
                                          <span className="font-mono text-xs text-muted-foreground">{task.taskCode}</span>
                                        )}
                                      </td>
                                      <td className="py-2">
                                        {isEditing ? (
                                          <input value={task.subject} onChange={(e) => updateEditingTask(idx, "subject", e.target.value)} className="w-full border rounded px-2 py-1 text-sm" />
                                        ) : (
                                          <span>{task.subject}</span>
                                        )}
                                      </td>
                                      <td className="py-2 text-right">
                                        {isEditing ? (
                                          <input type="number" value={task.defaultDuration} onChange={(e) => updateEditingTask(idx, "defaultDuration", parseFloat(e.target.value) || 0)} className="w-20 border rounded px-2 py-1 text-sm text-right ml-auto block" />
                                        ) : (
                                          <span className="text-muted-foreground">{task.defaultDuration}h</span>
                                        )}
                                      </td>
                                      {isEditing && (
                                        <td className="py-2">
                                          <button type="button" onClick={() => removeEditingTask(idx)} className="p-1 text-red-400 hover:text-red-600">
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {isEditing && (
                                <button type="button" onClick={addEditingTask} className="mt-3 flex items-center gap-1 text-xs text-primary font-bold hover:underline">
                                  <Plus className="h-3 w-3" /> Add Task
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === "users" && (
              <div className="flex flex-col h-full">

                {/* ── Filter / Action Bar ───────────────────────────────── */}
                <div className="flex items-center justify-between px-4 flex-shrink-0"
                  style={{ height: 40, borderBottom: '1px solid #E9EAEB', background: '#fff' }}>
                  <div className="flex items-center gap-3">
                    <span style={{ fontSize: 12, color: '#717680' }}>
                      {usersLoading ? 'Loading…' : `${userList.length} member${userList.length !== 1 ? 's' : ''}`}
                    </span>
                    {inviteResult?.ok && !showInviteForm && (
                      <span style={{ fontSize: 12, color: '#15803D', background: '#DCFCE7', border: '1px solid #bbf7d0', borderRadius: 4, padding: '2px 8px' }}>
                        {inviteResult.emailError ? '✓ Created — configure SMTP to send emails' : '✓ Invite sent'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setShowEmailPreview(v => !v)}
                      style={{ height: 28, padding: '0 10px', fontSize: 12, borderRadius: 6, border: '1px solid #E9EAEB', background: showEmailPreview ? '#F5F5F5' : '#fff', color: '#535862', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <ExternalLink size={12} /> Email Preview
                    </button>
                    <button type="button" onClick={() => { setShowInviteForm(v => !v); setInviteResult(null); }}
                      style={{ height: 28, padding: '0 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, background: '#2162F9', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <Plus size={12} /> Invite User
                    </button>
                  </div>
                </div>

                {/* ── Email Preview Panel ───────────────────────────────── */}
                {showEmailPreview && (
                  <div style={{ borderBottom: '1px solid #E9EAEB', flexShrink: 0 }}>
                    <div className="flex items-center justify-between px-4"
                      style={{ height: 36, borderBottom: '1px solid #E9EAEB', background: '#FAFAFA' }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#535862' }}>Invite Email Preview</span>
                      <button type="button" onClick={() => setShowEmailPreview(false)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#717680', display: 'flex', alignItems: 'center' }}>
                        <X size={14} />
                      </button>
                    </div>
                    <div style={{ padding: 16, background: '#f7f7f5' }}>
                      <iframe
                        title="Email preview"
                        srcDoc={`<!DOCTYPE html><html><head><style>body{font-family:Inter,sans-serif;background:#f7f7f5;padding:32px 16px;margin:0}.card{max-width:520px;margin:0 auto;background:white;border-radius:12px;border:1px solid #E9EAEB;overflow:hidden;box-shadow: 0 4px 12px rgba(0,0,0,0.03)}.card-header{padding:20px 28px;border-bottom:1px solid #F5F5F5;display:flex;align-items:center;gap:10px}.logo-mark{width:28px;height:28px;background:#2162F9;border-radius:7px;display:inline-flex;align-items:center;justify-content:center}.dot{width:7px;height:7px;background:#44EB7C;border-radius:50%;display:inline-block}.logo-name{font-size:15px;font-weight:700;color:#252B37}.logo-sub{font-size:12px;color:#717680;margin-left:4px}.card-body{padding:32px 28px}.eyebrow{font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#2162F9;margin-bottom:10px}.heading{font-size:24px;font-weight:700;color:#252B37;margin-bottom:14px;line-height:1.25}.text{font-size:14px;color:#535862;line-height:1.6;margin-bottom:10px}.pills{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}.pill{background:#F1F7FF;border:1px solid #DBEAFE;border-radius:20px;padding:6px 14px;font-size:12px;font-weight:500;color:#2162F9;display:inline-flex;align-items:center;gap:6px}.pill svg{width:13px;height:13px;stroke-width:2.5}.cta{display:inline-block;background:#2162F9;color:white;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;margin:20px 0}.card-footer{padding:18px 28px;background:#FAFAFA;border-top:1px solid #F5F5F5;font-size:11px;color:#717680;line-height:1.6}</style></head><body><div class="card"><div class="card-header">${branding.bottom_logo_url ? `<img src="${branding.bottom_logo_url}" alt="${branding.app_name}" style="height: 28px; width: auto; object-fit: contain;" />` : `<span class="logo-mark"><span class="dot"></span></span><span><span class="logo-name">Tarkie</span><span class="logo-sub">${branding.app_name}</span></span>`}</div><div class="card-body"><p class="eyebrow">Team Invitation</p><h1 class="heading">You're invited to<br/>join the workspace</h1><p class="text"><strong>Jane Admin</strong> has invited <strong>New Member</strong> to collaborate on <strong>${branding.app_name}</strong>.</p><p class="text">Click below to accept your invitation and get started. Your account will be set up automatically on first login.</p><div class="pills"><span class="pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Tasks</span><span class="pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Timelines</span><span class="pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><path d="m9 16 2 2 4-4"/></svg> Meetings</span><span class="pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg> Dashboard</span><span class="pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg> AI Tools</span></div><a href="#" class="cta">Accept Invitation →</a></div><div class="card-footer">This invitation expires in <strong>7 days</strong>. If you weren't expecting this, you can safely ignore it.<br/>${branding.app_name} · Built for modern teams</div></div></body></html>`}
                        style={{ width: '100%', border: 0, height: 400, display: 'block' }}
                      />
                    </div>
                  </div>
                )}

                {/* ── Invite Form Panel ─────────────────────────────────── */}
                {showInviteForm && (
                  <div style={{ borderBottom: '1px solid #E9EAEB', background: '#F8FAFF', padding: 16, flexShrink: 0 }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#252B37' }}>Invite New Member</span>
                      <button type="button" onClick={() => { setShowInviteForm(false); setInviteResult(null); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#717680', display: 'flex', alignItems: 'center' }}>
                        <X size={14} />
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#717680', marginBottom: 4 }}>Full Name</div>
                        <input style={{ width: '100%', height: 32, border: '1px solid #E9EAEB', borderRadius: 6, padding: '0 10px', fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
                          placeholder="Jane Smith" value={inviteForm.name}
                          onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#717680', marginBottom: 4 }}>Email Address *</div>
                        <input style={{ width: '100%', height: 32, border: '1px solid #E9EAEB', borderRadius: 6, padding: '0 10px', fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
                          type="email" placeholder="jane@company.com" value={inviteForm.email}
                          onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} />
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" onClick={sendInvite} disabled={inviteSending || !inviteForm.email.trim()}
                          style={{ height: 32, padding: '0 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, background: inviteSending || !inviteForm.email.trim() ? '#93a5e8' : '#2162F9', color: '#fff', border: 'none', cursor: inviteSending ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {inviteSending ? <><Loader2 size={12} className="animate-spin" /> Sending…</> : <>Send Invite</>}
                        </button>
                        <button type="button" onClick={() => { setShowInviteForm(false); setInviteResult(null); }}
                          style={{ height: 32, padding: '0 10px', fontSize: 12, borderRadius: 6, border: '1px solid #E9EAEB', background: '#fff', color: '#535862', cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                    {inviteResult?.error && (
                      <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px' }}>
                        {inviteResult.error}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Table ─────────────────────────────────────────────── */}
                <div className="flex-1 overflow-auto">
                  {usersLoading ? (
                    <div className="flex items-center justify-center" style={{ height: 120 }}>
                      <Loader2 size={18} className="animate-spin" style={{ color: '#717680' }} />
                    </div>
                  ) : userList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center" style={{ height: 120, gap: 8 }}>
                      <Users size={24} style={{ color: '#E9EAEB' }} />
                      <span style={{ fontSize: 12, color: '#717680' }}>No users yet. Invite someone to get started.</span>
                    </div>
                  ) : (
                    <>
                      {/* Sticky Header */}
                      <div style={{
                        position: 'sticky', top: 0, zIndex: 2,
                        display: 'grid',
                        gridTemplateColumns: '44px 180px 1fr 140px 88px 90px 96px',
                        height: 36,
                        alignItems: 'center',
                        padding: '0 16px',
                        gap: 8,
                        background: '#FCFCFC',
                        borderBottom: '1px solid #E9EAEB',
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: '#717680',
                      }}>
                        <span></span>
                        <span>Name</span>
                        <span>Email</span>
                        <span>Job Role</span>
                        <span>Access</span>
                        <span>Status</span>
                        <span>Actions</span>
                      </div>

                      {/* Rows */}
                      {userList.map(u => (
                        <div key={u.id} style={{ borderBottom: '1px solid #E9EAEB', opacity: u.status === 'blocked' ? 0.5 : 1 }}>
                          {/* Main Row */}
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: '44px 180px 1fr 140px 88px 90px 96px',
                            height: 40,
                            alignItems: 'center',
                            padding: '0 16px',
                            gap: 8,
                            background: editingUser?.id === u.id ? '#F8FAFF' : '#fff',
                          }}
                            onMouseEnter={e => { if (editingUser?.id !== u.id) (e.currentTarget as HTMLDivElement).style.background = '#FAFAFA'; }}
                            onMouseLeave={e => { if (editingUser?.id !== u.id) (e.currentTarget as HTMLDivElement).style.background = '#fff'; }}>

                            {/* Avatar */}
                            <div>
                              {u.image
                                ? <img src={u.image} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                                : <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#EBF0FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#2162F9' }}>
                                    {(u.name || u.email || '?')[0].toUpperCase()}
                                  </div>
                              }
                            </div>
                            {/* Name */}
                            <span style={{ fontSize: 12, fontWeight: 500, color: '#252B37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {u.name || <span style={{ color: '#D2D6DB' }}>—</span>}
                            </span>
                            {/* Email */}
                            <span style={{ fontSize: 12, color: '#535862', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {u.email}
                            </span>
                            {/* Job Role */}
                            <span style={{ fontSize: 12, color: '#717680', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {u.profileRole || <span style={{ color: '#D2D6DB' }}>—</span>}
                            </span>
                            {/* System Role */}
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                              background: u.role === 'admin' ? '#EDE9FE' : '#F3F4F6',
                              color: u.role === 'admin' ? '#7C3AED' : '#4B5563',
                              display: 'inline-block', whiteSpace: 'nowrap',
                            }}>
                              {u.role === 'admin' ? 'Admin' : 'Member'}
                            </span>
                            {/* Status */}
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                              background: u.status === 'active' ? '#DCFCE7' : u.status === 'blocked' ? '#FEE2E2' : '#FEF9C3',
                              color: u.status === 'active' ? '#15803D' : u.status === 'blocked' ? '#DC2626' : '#A16207',
                              display: 'inline-block', whiteSpace: 'nowrap',
                            }}>
                              {u.status === 'active' ? 'Active' : u.status === 'blocked' ? 'Blocked' : 'Pending'}
                            </span>
                            {/* Actions */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              <button type="button" onClick={() => setEditingUser(editingUser?.id === u.id ? null : { ...u })}
                                style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: editingUser?.id === u.id ? '#EBF0FF' : 'transparent', color: editingUser?.id === u.id ? '#2162F9' : '#717680', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                title="Edit">
                                <Pencil size={13} />
                              </button>
                              {u.status === 'pending' && (
                                <button type="button" onClick={() => resendInvite(u.id)}
                                  style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: '#717680', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                  title="Resend invite">
                                  <RefreshCw size={13} />
                                </button>
                              )}
                              {u.status !== 'blocked' && (
                                <button type="button" onClick={() => blockUser(u.id)}
                                  style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: '#D2D6DB', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                  title="Block user"
                                  onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#DC2626')}
                                  onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#D2D6DB')}>
                                  <Trash2 size={13} />
                                </button>
                              )}
                              {u.status === 'blocked' && (
                                <button type="button" onClick={() => approveUser(u.id)}
                                  style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: '#D2D6DB', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                  title="Reactivate"
                                  onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#16a34a')}
                                  onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#D2D6DB')}>
                                  <ToggleRight size={13} />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Edit Panel */}
                          {editingUser?.id === u.id && (
                            <div style={{ borderTop: '1px solid #E9EAEB', background: '#F8FAFF', padding: 16 }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 120px', gap: 12, marginBottom: 12 }}>
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#717680', marginBottom: 4 }}>Full Name</div>
                                  <input style={{ width: '100%', height: 32, border: '1px solid #E9EAEB', borderRadius: 6, padding: '0 10px', fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
                                    value={editingUser.name || ''}
                                    onChange={e => setEditingUser((eu: any) => ({ ...eu, name: e.target.value }))} />
                                </div>
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#717680', marginBottom: 4 }}>Job Role</div>
                                  <select style={{ width: '100%', height: 32, border: '1px solid #E9EAEB', borderRadius: 6, padding: '0 8px', fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
                                    value={editingUser.profileRole || ''}
                                    onChange={e => setEditingUser((eu: any) => ({ ...eu, profileRole: e.target.value || null }))}>
                                    <option value="">— none —</option>
                                    {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#717680', marginBottom: 4 }}>System Role</div>
                                  <select style={{ width: '100%', height: 32, border: '1px solid #E9EAEB', borderRadius: 6, padding: '0 8px', fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
                                    value={editingUser.role}
                                    onChange={e => setEditingUser((eu: any) => ({ ...eu, role: e.target.value }))}>
                                    <option value="user">Member</option>
                                    <option value="admin">Admin</option>
                                  </select>
                                </div>
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#717680', marginBottom: 4 }}>Status</div>
                                  <select style={{ width: '100%', height: 32, border: '1px solid #E9EAEB', borderRadius: 6, padding: '0 8px', fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
                                    value={editingUser.status}
                                    onChange={e => setEditingUser((eu: any) => ({ ...eu, status: e.target.value }))}>
                                    <option value="pending">Pending</option>
                                    <option value="active">Active</option>
                                    <option value="blocked">Blocked</option>
                                  </select>
                                </div>
                                <div className="col-span-2">
                                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#717680', marginBottom: 4 }}>Supervisor</div>
                                  <select style={{ width: '100%', height: 32, border: '1px solid #E9EAEB', borderRadius: 6, padding: '0 8px', fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box' }}
                                    value={editingUser.supervisorId || ''}
                                    onChange={e => setEditingUser((eu: any) => ({ ...eu, supervisorId: e.target.value || null }))}>
                                    <option value="">— No Supervisor (Root) —</option>
                                    {userList.filter(u_item => u_item.id !== editingUser.id && u_item.status === 'active').map(u_item => (
                                      <option key={u_item.id} value={u_item.id}>{u_item.name || u_item.email}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              {/* Module toggles */}
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#717680', marginBottom: 8 }}>Module Access</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {MODULE_FLAGS.map(m => {
                                    const on = !!editingUser[m.key];
                                    return (
                                      <button key={m.key} type="button"
                                        onClick={() => setEditingUser((eu: any) => ({ ...eu, [m.key]: !eu[m.key] }))}
                                        style={{
                                          height: 28, padding: '0 10px', fontSize: 12, fontWeight: 500, borderRadius: 6,
                                          border: on ? '1px solid rgba(33,98,249,0.3)' : '1px solid #E9EAEB',
                                          background: on ? 'rgba(33,98,249,0.08)' : '#fff',
                                          color: on ? '#2162F9' : '#717680',
                                          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                                        }}>
                                        {on ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
                                        {m.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              {/* Save / Cancel */}
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button type="button" onClick={saveUserEdits} disabled={userSaving}
                                  style={{ height: 32, padding: '0 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, background: userSaving ? '#93a5e8' : '#2162F9', color: '#fff', border: 'none', cursor: userSaving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {userSaving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><Save size={12} /> Save Changes</>}
                                </button>
                                <button type="button" onClick={() => setEditingUser(null)}
                                  style={{ height: 32, padding: '0 10px', fontSize: 12, borderRadius: 6, border: '1px solid #E9EAEB', background: '#fff', color: '#535862', cursor: 'pointer' }}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
            
            {/* ─── Skills Tab ─────────────────────────────────────────── */}
            {activeTab === "skills" && (
              <div className="space-y-4 flex-1">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-800">Skills</h2>
                    <p className="text-xs text-slate-500 mt-0.5">AI knowledge base entries injected into prompts across all apps. Edit content to refine AI behavior.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={seedSkills}
                      disabled={skillSeeding}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg hover:bg-slate-50 text-slate-600 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${skillSeeding ? "animate-spin" : ""}`} />
                      {skillSeeding ? "Seeding…" : "Load Default Skills"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowNewSkillForm(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90"
                    >
                      <Plus className="w-3.5 h-3.5" /> New Skill
                    </button>
                  </div>
                </div>

                {/* New skill form */}
                {showNewSkillForm && (
                  <div className="border rounded-lg p-4 bg-blue-50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-700">New Skill</span>
                      <button type="button" onClick={() => setShowNewSkillForm(false)}><X className="w-4 h-4 text-slate-400" /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input className="border rounded px-2 py-1.5 text-xs" placeholder="Name *" value={newSkill.name} onChange={e => setNewSkill(s => ({ ...s, name: e.target.value }))} />
                      <select className="border rounded px-2 py-1.5 text-xs" value={newSkill.category} onChange={e => setNewSkill(s => ({ ...s, category: e.target.value }))}>
                        {Object.entries(categoryLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <input className="border rounded px-2 py-1.5 text-xs" placeholder="Subcategory (e.g. industry)" value={newSkill.subcategory} onChange={e => setNewSkill(s => ({ ...s, subcategory: e.target.value }))} />
                      <input className="border rounded px-2 py-1.5 text-xs" placeholder="Slug (e.g. retail)" value={newSkill.slug} onChange={e => setNewSkill(s => ({ ...s, slug: e.target.value }))} />
                    </div>
                    <input className="w-full border rounded px-2 py-1.5 text-xs" placeholder="Description" value={newSkill.description} onChange={e => setNewSkill(s => ({ ...s, description: e.target.value }))} />
                    <textarea className="w-full border rounded px-2 py-1.5 text-xs font-mono" rows={6} placeholder="Skill content (markdown) *" value={newSkill.content} onChange={e => setNewSkill(s => ({ ...s, content: e.target.value }))} />
                    <button type="button" onClick={createSkill} disabled={!newSkill.name || !newSkill.content} className="px-4 py-1.5 text-xs font-semibold bg-primary text-white rounded-lg disabled:opacity-40">
                      Create Skill
                    </button>
                  </div>
                )}

                {skillsLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                ) : skills.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-sm">
                    No skills yet. Click <strong>Load Default Skills</strong> to seed the initial set.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(
                      skills.reduce((acc: Record<string, Skill[]>, s) => {
                        const cat = s.category;
                        if (!acc[cat]) acc[cat] = [];
                        acc[cat].push(s);
                        return acc;
                      }, {})
                    ).map(([cat, catSkills]) => (
                      <div key={cat}>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1 mt-3">{categoryLabels[cat] ?? cat}</div>
                        <div className="space-y-1.5">
                          {catSkills.map(skill => (
                            editingSkill?.id === skill.id ? (
                              <div key={skill.id} className="border-2 border-primary rounded-lg p-4 space-y-3 bg-white">
                                <div className="grid grid-cols-2 gap-2">
                                  <input className="border rounded px-2 py-1.5 text-xs" value={editingSkill.name} onChange={e => setEditingSkill(s => s ? { ...s, name: e.target.value } : s)} placeholder="Name" />
                                  <select className="border rounded px-2 py-1.5 text-xs" value={editingSkill.category} onChange={e => setEditingSkill(s => s ? { ...s, category: e.target.value } : s)}>
                                    {Object.entries(categoryLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                  </select>
                                  <input className="border rounded px-2 py-1.5 text-xs" value={editingSkill.subcategory ?? ""} onChange={e => setEditingSkill(s => s ? { ...s, subcategory: e.target.value } : s)} placeholder="Subcategory" />
                                  <input className="border rounded px-2 py-1.5 text-xs" value={editingSkill.slug ?? ""} onChange={e => setEditingSkill(s => s ? { ...s, slug: e.target.value } : s)} placeholder="Slug" />
                                </div>
                                <input className="w-full border rounded px-2 py-1.5 text-xs" value={editingSkill.description} onChange={e => setEditingSkill(s => s ? { ...s, description: e.target.value } : s)} placeholder="Description" />
                                <textarea
                                  className="w-full border rounded px-2 py-1.5 text-xs font-mono resize-y"
                                  rows={12}
                                  value={editingSkill.content}
                                  onChange={e => setEditingSkill(s => s ? { ...s, content: e.target.value } : s)}
                                />
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => saveSkill(editingSkill)} disabled={skillSaving} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-primary text-white rounded-lg disabled:opacity-50">
                                    <Save className="w-3.5 h-3.5" />{skillSaving ? "Saving…" : "Save"}
                                  </button>
                                  <button type="button" onClick={() => setEditingSkill(null)} className="px-3 py-1.5 text-xs border rounded-lg hover:bg-slate-50">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div key={skill.id} className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-sm group ${skill.isActive ? "bg-white" : "bg-slate-50 opacity-60"}`}>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-slate-800 text-xs truncate">{skill.name}</span>
                                    {skill.isSystem && <span className="text-[9px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded font-medium uppercase">System</span>}
                                    {skill.slug && <span className="text-[9px] bg-blue-50 text-blue-400 px-1.5 py-0.5 rounded font-mono">{skill.slug}</span>}
                                  </div>
                                  {skill.description && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{skill.description}</p>}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                  <button type="button" onClick={() => toggleSkillActive(skill)} title={skill.isActive ? "Disable" : "Enable"} className="p-1 rounded hover:bg-slate-100 text-slate-400">
                                    {skill.isActive ? <ToggleRight className="w-4 h-4 text-green-500" /> : <ToggleLeft className="w-4 h-4" />}
                                  </button>
                                  <button type="button" onClick={() => setEditingSkill({ ...skill })} className="p-1 rounded hover:bg-slate-100 text-slate-400">
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  {!skill.isSystem && (
                                    <button type="button" onClick={() => deleteSkill(skill)} className="p-1 rounded hover:bg-red-50 text-red-400">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ─── Roles Tab ──────────────────────────────────────────── */}
            {activeTab === "org-chart" && (
              <div className="flex-1 overflow-auto p-4 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center justify-between border-b pb-4">
                  <div>
                    <h3 className="font-bold text-xl flex items-center gap-2">
                       <Network className="w-5 h-5 text-primary" /> Organizational Chart
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Visual representation of the team reporting structure. Supervisors can see all data related to their subordinates.
                    </p>
                  </div>
                  <button type="button" onClick={loadUsers} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400" title="Refresh Chart">
                    <RefreshCw className={`w-4 h-4 ${usersLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {usersLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="max-w-4xl mx-auto py-8">
                    {(() => {
                      const buildTree = (supervisorId: string | null = null, level = 0): React.ReactNode[] => {
                        // Effective filtering: Only show active users in the actual chart nodes
                        // However, we must allow subordinates of blocked users to "skip up" to the next active ancestor
                        const activeUsers = userList.filter(u => u.status === 'active');
                        
                        // Helper to find the effective supervisor for a user (skipping blocked ones)
                        const getEffectiveSupervisorId = (u: any): string | null => {
                          let currentId = u.supervisorId || null;
                          while (currentId) {
                            const supervisor = userList.find(s => s.id === currentId);
                            if (!supervisor) return null;
                            if (supervisor.status === 'active') return currentId;
                            currentId = supervisor.supervisorId || null;
                          }
                          return null;
                        };

                        const subordinates = activeUsers.filter(u => getEffectiveSupervisorId(u) === supervisorId);
                        
                        return subordinates.map(user => (
                          <div key={user.id} className="relative">
                            {/* Connector Line */}
                            {level > 0 && (
                              <div className="absolute left-[-20px] top-[24px] w-[20px] h-[1px] bg-slate-200" />
                            )}
                            
                            <div className="flex items-center gap-3 p-3 mb-3 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-all group max-w-md">
                              <div className="shrink-0">
                                {user.image ? (
                                  <img src={user.image} alt="" className="w-10 h-10 rounded-full border border-slate-100" />
                                ) : (
                                  <div className="w-10 h-10 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                                    {(user.name || user.email || "?")[0].toUpperCase()}
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-slate-800 text-sm truncate">{user.name || "Unnamed User"}</p>
                                <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">{user.profileRole || "Team Member"}</p>
                                <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
                              </div>
                              <button type="button" onClick={() => { setEditingUser({...user}); setActiveTab("users"); }} className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-slate-100 rounded-md text-slate-400 transition-all">
                                <Pencil size={12} />
                              </button>
                            </div>

                            {/* Children container */}
                            <div className="ml-10 border-l border-slate-200">
                              {buildTree(user.id, level + 1)}
                            </div>
                          </div>
                        ));
                      };

                      const roots = buildTree(null);
                      return roots.length > 0 ? (
                        <div className="space-y-6">
                           {roots}
                        </div>
                      ) : (
                        <div className="text-center py-20 text-slate-400">
                          <Users className="w-12 h-12 mx-auto opacity-20 mb-4" />
                          <p>No reporting structure defined yet.</p>
                          <p className="text-xs mt-2">Go to the Users tab to assign supervisors.</p>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
 
            {activeTab === "roles" && (
              <div className="space-y-4 flex-1 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between border-b pb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                      <Shield className="w-5 h-5 text-primary" /> Roles Masterfile
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">Generic role labels used for task assignment (e.g. Client, Dev, QA). Team member names come from User Management.</p>
                  </div>
                </div>

                {/* Add new role */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Role name (e.g. QA, Client, BA)"
                    value={newRoleName}
                    onChange={e => setNewRoleName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addRole(); } }}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm text-slate-700 bg-slate-50 focus:ring-2 focus:ring-primary outline-none border-slate-200"
                  />
                  <button
                    type="button"
                    onClick={addRole}
                    disabled={roleSaving || !newRoleName.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
                  >
                    {roleSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add
                  </button>
                </div>

                {/* Roles list */}
                {rolesLoading ? (
                  <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                ) : roles.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 text-sm">No roles yet. Add your first role above.</div>
                ) : (
                  <div className="space-y-1.5">
                    {roles.map(role => (
                      <div key={role.id} className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-slate-100 bg-white hover:bg-slate-50">
                        <div className="flex items-center gap-2">
                          <Shield className="w-3.5 h-3.5 text-primary opacity-60" />
                          <span className="text-sm font-medium text-slate-700">{role.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteRole(role.id)}
                          className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(activeTab === "auth" || activeTab === "apps") && (
              <div className="flex items-center gap-3 pt-6 border-t mt-auto">
                <button type="submit" disabled={status === "loading"}
                  className="h-9 px-5 bg-[#2162F9] text-white text-[12px] font-semibold rounded-md hover:bg-blue-700 transition-colors disabled:opacity-40">
                  {status === "loading" ? "Saving…" : "Save Settings"}
                </button>
                {status === "success" && <span className="text-[11px] text-green-600 font-semibold bg-green-50 px-2.5 py-1 rounded border border-green-200">✓ Saved</span>}
                {status === "error" && <span className="text-[11px] text-red-600 font-semibold bg-red-50 px-2.5 py-1 rounded border border-red-200">Failed</span>}
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
