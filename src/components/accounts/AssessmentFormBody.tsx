"use client";

/**
 * Reusable assessment form body — the four sections (B/C/D/E) of the
 * RM Account Assessment. Used by:
 *   - AccountHealthPanel modal (admin quick-edit on account detail page)
 *   - /assessments/[accountId] dedicated page (primary RM flow)
 *
 * State and submit live in the parent. This component only renders the
 * controlled fields and emits a single `value` object back via onChange.
 */
import { useState } from "react";

export interface AssessmentValue {
  satisfaction: number | "";
  ebaDM: number | "";
  ebaDMNote: string;
  ebaAdmin: number | "";
  ebaAdminNote: string;
  contactChange: boolean;
  contactChangeNote: string;
  isTarkieSsot: "" | "yes" | "no";
  thirdPartySsot: string;
  v5Readiness: number | "";
  requestedModules: string;
  b1: string;
  b2: string;
  b3: string;
  d3: string;
  e1: string;
  e4: string;
  e5: string;
}

export const EMPTY_ASSESSMENT: AssessmentValue = {
  satisfaction: "",
  ebaDM: "",
  ebaDMNote: "",
  ebaAdmin: "",
  ebaAdminNote: "",
  contactChange: false,
  contactChangeNote: "",
  isTarkieSsot: "",
  thirdPartySsot: "",
  v5Readiness: "",
  requestedModules: "",
  b1: "",
  b2: "",
  b3: "",
  d3: "",
  e1: "",
  e4: "",
  e5: "",
};

export function buildAssessmentBody(v: AssessmentValue) {
  const responses: any = {};
  if (v.b1.trim()) responses.b1_overall_state = v.b1.trim();
  if (v.b2.trim()) responses.b2_whats_working = v.b2.trim();
  if (v.b3.trim()) responses.b3_gaps_pain_points = v.b3.trim();
  if (v.d3.trim() && v.isTarkieSsot === "no") responses.d3_why_not_ssot = v.d3.trim();
  if (v.e1.trim()) responses.e1_open_requests = v.e1.trim();
  if (v.e4.trim()) responses.e4_single_action = v.e4.trim();
  if (v.e5.trim()) responses.e5_other = v.e5.trim();
  return {
    satisfaction: v.satisfaction || null,
    ebaDecisionMaker: v.ebaDM || null,
    ebaDecisionMakerNote: v.ebaDMNote.trim() || null,
    ebaAdmin: v.ebaAdmin || null,
    ebaAdminNote: v.ebaAdminNote.trim() || null,
    contactChangeRecent: v.contactChange,
    contactChangeNote: v.contactChange ? (v.contactChangeNote.trim() || null) : null,
    isTarkieSsot: v.isTarkieSsot === "yes" ? true : v.isTarkieSsot === "no" ? false : null,
    thirdPartySsot: v.isTarkieSsot === "no" ? (v.thirdPartySsot.trim() || null) : null,
    v5Readiness: v.v5Readiness || null,
    requestedModules: v.requestedModules.split(/[,;]/).map(s => s.trim()).filter(Boolean),
    responses,
  };
}

interface Props {
  value: AssessmentValue;
  onChange: (next: AssessmentValue) => void;
}

export default function AssessmentFormBody({ value, onChange }: Props) {
  const v = value;
  const update = (patch: Partial<AssessmentValue>) => onChange({ ...v, ...patch });

  return (
    <div className="space-y-8">
      {/* Section B */}
      <Section title="Account Health" letter="B" accent="indigo">
        <LongText
          label="Overall, how would you describe the current state of this account?"
          value={v.b1}
          onChange={s => update({ b1: s })}
          hint="2-3 sentences. Include both wins and concerns."
        />
        <LongText
          label="What is working well for this client on current Tarkie modules?"
          value={v.b2}
          onChange={s => update({ b2: s })}
        />
        <LongText
          label="What gaps or pain points does the client repeatedly raise?"
          value={v.b3}
          onChange={s => update({ b3: s })}
        />
        <Rating
          label="Overall satisfaction with Tarkie today"
          value={v.satisfaction}
          onChange={n => update({ satisfaction: n })}
          hint="1 = very dissatisfied · 5 = champion"
        />
      </Section>

      {/* Section C */}
      <Section title="Relationship Strength (EBA)" letter="C" accent="emerald">
        <p className="text-[11px] text-slate-500 -mt-2 mb-1">
          How strong is your Executive Business Alignment with the two key contacts at this client?
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <Rating
            label="EBA — Decision Maker"
            value={v.ebaDM}
            onChange={n => update({ ebaDM: n })}
            hint="The person who signs off on contracts and budget"
          />
          <ShortText
            label="Describe the Decision Maker relationship"
            value={v.ebaDMNote}
            onChange={s => update({ ebaDMNote: s })}
            placeholder="In 1-2 sentences"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <Rating
            label="EBA — Admin / day-to-day"
            value={v.ebaAdmin}
            onChange={n => update({ ebaAdmin: n })}
            hint="Your primary day-to-day contact"
          />
          <ShortText
            label="Describe the Admin relationship"
            value={v.ebaAdminNote}
            onChange={s => update({ ebaAdminNote: s })}
            placeholder="In 1-2 sentences"
          />
        </div>
        <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 cursor-pointer hover:border-slate-300">
          <input
            type="checkbox"
            checked={v.contactChange}
            onChange={e => update({ contactChange: e.target.checked })}
            className="mt-0.5 w-4 h-4 rounded"
          />
          <div>
            <p className="text-[12px] font-bold text-slate-700">Leadership or admin contact change in the last 6 months?</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Check if a key contact joined, left, or changed roles</p>
          </div>
        </label>
        {v.contactChange && (
          <ShortText
            label="What changed?"
            value={v.contactChangeNote}
            onChange={s => update({ contactChangeNote: s })}
            placeholder="e.g. New CFO took over the relationship in March"
          />
        )}
      </Section>

      {/* Section D */}
      <Section title="System of Record" letter="D" accent="amber">
        <div>
          <label className="text-[12px] font-bold text-slate-800 block mb-1">
            Is Tarkie the Single Source of Truth (SSOT) for this client's field operations data?
          </label>
          <p className="text-[11px] text-slate-500 mb-2">
            SSOT = where their team checks first for the latest field data, not a backup or after-the-fact log
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <RadioOption checked={v.isTarkieSsot === "yes"} onChange={() => update({ isTarkieSsot: "yes" })} label="Yes — Tarkie is SSOT" />
            <RadioOption checked={v.isTarkieSsot === "no"} onChange={() => update({ isTarkieSsot: "no" })} label="No — third-party tool is SSOT" />
          </div>
        </div>
        {v.isTarkieSsot === "no" && (
          <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-4 space-y-3">
            <ShortText
              label="Which third-party tool serves as their SSOT?"
              value={v.thirdPartySsot}
              onChange={s => update({ thirdPartySsot: s })}
              placeholder="e.g. Salesforce, Hubspot, internal spreadsheet…"
            />
            <LongText
              label="Why is Tarkie not the SSOT, and what would it take to make it so?"
              value={v.d3}
              onChange={s => update({ d3: s })}
            />
          </div>
        )}
      </Section>

      {/* Section E */}
      <Section title="Demand Signals & V5 Outlook" letter="E" accent="blue">
        <LongText
          label="What are the client's most notable open requests right now?"
          value={v.e1}
          onChange={s => update({ e1: s })}
          hint="High-level themes, not a ticket list"
        />
        <ShortText
          label="Which Tarkie capabilities does this client most want to expand into?"
          value={v.requestedModules}
          onChange={s => update({ requestedModules: s })}
          placeholder="Attendance, Inventory, Audit Forms…"
          hint="Comma-separated"
        />
        <Rating
          label="How ready is this account for V5 in your judgement?"
          value={v.v5Readiness}
          onChange={n => update({ v5Readiness: n })}
          hint="1 = not now · 5 = ready to migrate"
        />
        <LongText
          label="What single action from Tarkie would most strengthen this account in the next 90 days?"
          value={v.e4}
          onChange={s => update({ e4: s })}
        />
        <LongText
          label="Anything else the CEO should know about this account?"
          value={v.e5}
          onChange={s => update({ e5: s })}
          optional
        />
      </Section>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function Section({ title, letter, accent, children }: { title: string; letter: string; accent: "indigo" | "emerald" | "amber" | "blue"; children: React.ReactNode }) {
  const palette: Record<string, string> = {
    indigo: "bg-indigo-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    blue: "bg-blue-500",
  };
  return (
    <section className="space-y-4">
      <header className="flex items-center gap-3 pb-2 border-b border-slate-200">
        <span className={`w-7 h-7 rounded-full ${palette[accent]} text-white text-[12px] font-black flex items-center justify-center shrink-0`}>{letter}</span>
        <h3 className="text-[14px] font-black text-slate-900 uppercase tracking-wider">{title}</h3>
      </header>
      <div className="space-y-4 pl-1">
        {children}
      </div>
    </section>
  );
}

function ShortText({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <div>
      <label className="text-[12px] font-bold text-slate-800 block mb-0.5">{label}</label>
      {hint && <p className="text-[11px] text-slate-500 mb-1">{hint}</p>}
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] text-slate-800 placeholder:text-slate-300 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
      />
    </div>
  );
}

function LongText({ label, value, onChange, optional, hint }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean; hint?: string }) {
  return (
    <div>
      <label className="text-[12px] font-bold text-slate-800 block mb-0.5">
        {label}
        {optional && <span className="ml-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-widest">optional</span>}
      </label>
      {hint && <p className="text-[11px] text-slate-500 mb-1">{hint}</p>}
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={4}
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] text-slate-800 placeholder:text-slate-300 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 resize-y leading-relaxed"
      />
    </div>
  );
}

function Rating({ label, value, onChange, hint }: { label: string; value: number | ""; onChange: (v: number | "") => void; hint?: string }) {
  return (
    <div>
      <label className="text-[12px] font-bold text-slate-800 block mb-0.5">{label}</label>
      {hint && <p className="text-[11px] text-slate-500 mb-1.5">{hint}</p>}
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? "" : n)}
            className={`w-10 h-10 rounded-lg text-[14px] font-black border-2 transition-all ${value === n ? "bg-indigo-500 text-white border-indigo-500 shadow-md scale-110" : "bg-white text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-700"}`}
          >
            {n}
          </button>
        ))}
        {value && (
          <button type="button" onClick={() => onChange("")} className="ml-2 text-[11px] font-bold text-slate-400 hover:text-rose-500 underline">
            clear
          </button>
        )}
      </div>
    </div>
  );
}

function RadioOption({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-[12px] font-bold transition-all ${checked ? "bg-indigo-50 border-indigo-500 text-indigo-800" : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300"}`}
    >
      <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${checked ? "border-indigo-500" : "border-slate-300"}`}>
        {checked && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
      </span>
      {label}
    </button>
  );
}
