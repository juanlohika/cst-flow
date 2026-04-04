"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  Loader2, CheckCircle2, Calendar, Building2, AlertCircle,
  Search, UserCheck, UserPlus, X,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface MeetingInfo {
  id: string;
  title: string;
  companyName?: string;
  meetingType: string;
  scheduledAt: string;
  status: string;
}

interface PublicAttendee {
  id: string;
  fullName: string;
  companyName?: string | null;
  position?: string | null;
  attendanceStatus: string;
}

type Tab = "find" | "register";

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AttendPage() {
  const { id } = useParams<{ id: string }>();

  const [loadingMeeting, setLoadingMeeting] = useState(true);
  const [meeting, setMeeting] = useState<MeetingInfo | null>(null);
  const [meetingError, setMeetingError] = useState("");
  const [settings, setSettings] = useState<Record<string, string>>({});

  const [tab, setTab] = useState<Tab>("find");

  // Load meeting info + settings
  useEffect(() => {
    if (!id) return;
    
    const settingsPromise = fetch(`/api/admin/settings`)
      .then(r => r.ok ? r.json() : {})
      .then(data => { setSettings(data); return data; })
      .catch(() => ({}));

    const meetingPromise = fetch(`/api/meetings/lookup?id=${id}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setMeeting(data); return data; })
      .catch(() => { setMeetingError("Meeting not found. Please check the QR code and try again."); return null; });

    Promise.all([settingsPromise, meetingPromise])
      .finally(() => setLoadingMeeting(false));
  }, [id]);

  if (loadingMeeting) {
    const brandName = settings.app_name || "FlowDesk";
    const logoUrl = settings.app_logo || settings.bottom_logo_url;
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
        {logoUrl ? (
          <img src={logoUrl} alt={brandName} className="h-10 w-auto mb-6 animate-pulse object-contain" />
        ) : (
          <div className="text-2xl font-black text-primary mb-6 tracking-tighter uppercase">{brandName}</div>
        )}
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <p className="text-[11px] text-slate-400 font-black uppercase tracking-widest opacity-60">Loading...</p>
        </div>
      </div>
    );
  }

  if (meetingError || !meeting) {
    return (
      <Shell settings={settings}>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center space-y-3 mx-4">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="text-red-700 text-sm font-medium">
            {meetingError || "Meeting not found."}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell settings={settings}>
      {/* Meeting info card */}
      <div className="mx-4 mb-5 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-1.5">
        <p className="text-[15px] font-semibold text-slate-800 leading-snug">{meeting.title}</p>
        {meeting.companyName && (
          <p className="text-[13px] text-slate-500 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 flex-shrink-0" /> {meeting.companyName}
          </p>
        )}
        <p className="text-[13px] text-slate-500 flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
          {new Date(meeting.scheduledAt).toLocaleDateString("en-US", {
            weekday: "short", month: "long", day: "numeric", year: "numeric",
          })}
        </p>
      </div>

      {/* Tabs */}
      <div className="mx-4 mb-4 flex rounded-xl bg-slate-100 p-1 gap-1">
        <TabBtn active={tab === "find"} onClick={() => setTab("find")} icon={<UserCheck className="w-4 h-4" />}>
          Find My Name
        </TabBtn>
        <TabBtn active={tab === "register"} onClick={() => setTab("register")} icon={<UserPlus className="w-4 h-4" />}>
          Register
        </TabBtn>
      </div>

      {/* Tab content */}
      {tab === "find" ? (
        <FindTab meetingId={id!} />
      ) : (
        <RegisterTab meetingId={id!} meeting={meeting} />
      )}

      <p className="text-center text-[11px] text-slate-300 mt-8 mb-4">
        Powered by {settings.app_name || "FlowDesk"} · Your data is kept confidential
      </p>
    </Shell>
  );
}

// ── Find My Name tab ───────────────────────────────────────────────────────────

function FindTab({ meetingId }: { meetingId: string }) {
  const [attendees, setAttendees] = useState<PublicAttendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Confirm modal
  const [confirming, setConfirming] = useState<PublicAttendee | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Success modal
  const [successName, setSuccessName] = useState("");

  useEffect(() => {
    fetch(`/api/meetings/${meetingId}/attendees/public`)
      .then(r => r.json())
      .then(data => setAttendees(data.attendees ?? []))
      .catch(() => setAttendees([]))
      .finally(() => setLoading(false));
  }, [meetingId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return attendees;
    const q = search.toLowerCase();
    return attendees.filter(a =>
      a.fullName.toLowerCase().includes(q) ||
      (a.companyName ?? "").toLowerCase().includes(q)
    );
  }, [attendees, search]);

  const openConfirm = (a: PublicAttendee) => {
    setConfirming(a);
    setConsent(false);
    setSubmitError("");
  };

  const closeConfirm = () => {
    setConfirming(null);
    setConsent(false);
    setSubmitError("");
  };

  const confirmAttendance = async () => {
    if (!consent) { setSubmitError("Please give your consent to proceed."); return; }
    if (!confirming) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch(`/api/meetings/${meetingId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeId: confirming.id, consentGiven: true }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed");
      }
      // Mark locally as confirmed
      setAttendees(prev =>
        prev.map(a => a.id === confirming.id ? { ...a, attendanceStatus: "confirmed" } : a)
      );
      setSuccessName(confirming.fullName);
      setConfirming(null);
    } catch (err: any) {
      setSubmitError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success state ──────────────────────────────────────────────────────────
  if (successName) {
    return (
      <div className="mx-4">
        <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center space-y-4">
          <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
          <div>
            <p className="text-green-800 text-[17px] font-semibold">You&apos;re checked in!</p>
            <p className="text-green-600 text-sm mt-1">
              <span className="font-medium">{successName}</span> — your attendance has been recorded.
            </p>
          </div>
          <button
            onClick={() => typeof window !== "undefined" && window.close()}
            className="mt-2 w-full py-3 bg-green-600 text-white rounded-xl text-[14px] font-semibold"
          >
            OK — Close Tab
          </button>
        </div>
      </div>
    );
  }

  // ── List ───────────────────────────────────────────────────────────────────
  return (
    <div className="px-4 space-y-3">
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
        </div>
      ) : attendees.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center space-y-2">
          <p className="text-slate-600 text-sm font-medium">No pre-registered attendees yet</p>
          <p className="text-slate-400 text-xs">Use the &quot;Register&quot; tab to add your details.</p>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search your name…"
              className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 bg-white"
            />
          </div>

          {/* Attendee cards */}
          <div className="space-y-2">
            {filtered.length === 0 ? (
              <p className="text-center text-sm text-slate-400 py-6">
                No match for &quot;{search}&quot;
              </p>
            ) : (
              filtered.map(a => {
                const confirmed = a.attendanceStatus === "confirmed" || a.attendanceStatus === "attended";
                return (
                  <div
                    key={a.id}
                    className={`flex items-center justify-between gap-3 p-4 rounded-xl border transition-colors ${
                      confirmed
                        ? "bg-green-50 border-green-200"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-slate-800 truncate">{a.fullName}</p>
                      {(a.position || a.companyName) && (
                        <p className="text-[12px] text-slate-400 truncate mt-0.5">
                          {[a.position, a.companyName].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    {confirmed ? (
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-green-600 flex-shrink-0 whitespace-nowrap">
                        <CheckCircle2 className="w-4 h-4" /> Present
                      </span>
                    ) : (
                      <button
                        onClick={() => openConfirm(a)}
                        className="flex-shrink-0 px-4 py-2 bg-blue-600 text-white text-[12px] font-semibold rounded-lg hover:bg-blue-700 active:scale-95 transition-all"
                      >
                        Mark Present
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Confirmation modal */}
      {confirming && (
        <Modal onClose={closeConfirm}>
          <div className="space-y-4">
            <div className="text-center space-y-1">
              <UserCheck className="w-10 h-10 text-blue-500 mx-auto" />
              <p className="text-[16px] font-semibold text-slate-800">Confirm your attendance</p>
              <p className="text-sm text-slate-500">
                Marking present for:
                <span className="block font-semibold text-slate-800 mt-0.5">{confirming.fullName}</span>
                {(confirming.position || confirming.companyName) && (
                  <span className="text-[12px] text-slate-400">
                    {[confirming.position, confirming.companyName].filter(Boolean).join(" · ")}
                  </span>
                )}
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer bg-slate-50 rounded-xl p-3">
              <input
                type="checkbox"
                checked={consent}
                onChange={e => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              <span className="text-[12px] text-slate-600 leading-relaxed">
                I consent to having my attendance recorded for this meeting in accordance with data privacy regulations.
              </span>
            </label>

            {submitError && (
              <p className="text-[12px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{submitError}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={closeConfirm}
                disabled={submitting}
                className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl text-[13px] font-medium"
              >
                Cancel
              </button>
              <button
                onClick={confirmAttendance}
                disabled={submitting}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-[13px] font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Confirm Attendance"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Register tab ───────────────────────────────────────────────────────────────

function RegisterTab({ meetingId, meeting }: { meetingId: string; meeting: MeetingInfo }) {
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    mobileNumber: "",
    companyName: "",
    position: "",
    consentGiven: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!form.fullName.trim()) { setErrorMsg("Full name is required."); return; }
    if (!form.consentGiven) { setErrorMsg("Please give your consent to proceed."); return; }
    setErrorMsg("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, consentGiven: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      setSuccess(true);
    } catch (err: any) {
      setErrorMsg(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="mx-4">
        <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center space-y-4">
          <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
          <div>
            <p className="text-green-800 text-[17px] font-semibold">You&apos;re registered!</p>
            <p className="text-green-600 text-sm mt-1">Your attendance has been recorded. Thank you for joining.</p>
          </div>
          <div className="bg-white rounded-xl border border-green-200 p-4 text-left space-y-1.5">
            <p className="text-[13px] font-semibold text-slate-800">{meeting.title}</p>
            {meeting.companyName && (
              <p className="text-[12px] text-slate-500 flex items-center gap-1.5">
                <Building2 className="w-3 h-3" /> {meeting.companyName}
              </p>
            )}
            <p className="text-[12px] text-slate-500 flex items-center gap-1.5">
              <Calendar className="w-3 h-3" />
              {new Date(meeting.scheduledAt).toLocaleDateString("en-US", {
                month: "long", day: "numeric", year: "numeric",
              })}
            </p>
          </div>
          <p className="text-[12px] text-green-700 bg-green-100 rounded-xl px-4 py-3">
            You may now close this tab.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <p className="text-[14px] font-semibold text-slate-800">Enter your details</p>

        <Field label="Full Name" required>
          <input
            type="text"
            value={form.fullName}
            onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
            placeholder="Your full name"
            className="input-mobile"
          />
        </Field>

        <Field label="Email Address">
          <input
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="you@company.com"
            className="input-mobile"
          />
        </Field>

        <Field label="Mobile Number">
          <input
            type="tel"
            value={form.mobileNumber}
            onChange={e => setForm(f => ({ ...f, mobileNumber: e.target.value }))}
            placeholder="+63 9XX XXX XXXX"
            className="input-mobile"
          />
        </Field>

        <Field label="Company / Organization">
          <input
            type="text"
            value={form.companyName}
            onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
            placeholder="Your company or organization"
            className="input-mobile"
          />
        </Field>

        <Field label="Designation / Position">
          <input
            type="text"
            value={form.position}
            onChange={e => setForm(f => ({ ...f, position: e.target.value }))}
            placeholder="e.g. Operations Manager"
            className="input-mobile"
          />
        </Field>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.consentGiven}
            onChange={e => setForm(f => ({ ...f, consentGiven: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-blue-600"
          />
          <span className="text-[12px] text-slate-600 leading-relaxed">
            I consent to having my personal information (name, email, mobile, company, designation)
            recorded for attendance purposes in accordance with data privacy regulations.
          </span>
        </label>

        {errorMsg && (
          <p className="text-[12px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{errorMsg}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3 bg-blue-600 text-white rounded-xl text-[14px] font-semibold hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Registering…</> : "Register Attendance"}
        </button>
      </div>
    </div>
  );
}

// ── Shared components ──────────────────────────────────────────────────────────

function Shell({ children, settings = {} }: { children: React.ReactNode; settings?: Record<string, string> }) {
  const logoUrl = settings.app_logo || settings.bottom_logo_url;
  const brandName = settings.app_name || "FlowDesk";
  return (
    <div className="min-h-screen bg-white flex flex-col antialiased">
      {/* Header */}
      <div className="flex flex-col items-center pt-8 pb-5">
        {logoUrl ? (
          <img src={logoUrl} alt={brandName} className="h-10 w-auto object-contain" />
        ) : (
          <div className="text-xl font-black text-primary tracking-tighter uppercase">{brandName}</div>
        )}
        <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-widest opacity-60">Meeting Attendance</p>
      </div>
      {children}
    </div>
  );
}

function TabBtn({
  active, onClick, icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
        active
          ? "bg-white text-blue-600 shadow-sm"
          : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
        >
          <X className="w-4 h-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-slate-600 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}
