"use client";

import { useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { Upload, Download, CheckCircle, AlertTriangle, XCircle, Loader2, FileSpreadsheet, ArrowRight, Info } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";

interface RowReport {
  sheet: "Accounts" | "InternalTeam";
  rowNumber: number;
  status: "ok" | "warn" | "error";
  message: string;
}
interface ValidationResult {
  accounts: any[];
  team: any[];
  report: RowReport[];
  totals: {
    totalRows: number;
    okRows: number;
    warnRows: number;
    errorRows: number;
  };
}

export default function AccountsImportPage() {
  return (
    <AuthGuard>
      <Content />
    </AuthGuard>
  );
}

function Content() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === "admin";

  const [validating, setValidating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [filename, setFilename] = useState<string>("");
  const [applyResult, setApplyResult] = useState<{ batchId: string; appliedAccounts: number; appliedTeam: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <div className="bg-white border border-rose-200 rounded-2xl p-6 text-rose-700">
          <p className="font-bold">Admin only</p>
          <p className="text-sm mt-1">You need an admin role to access bulk account import.</p>
        </div>
      </div>
    );
  }

  const downloadTemplate = () => {
    window.location.href = "/api/admin/accounts/import/template";
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setApplyResult(null);
    setValidation(null);
    setValidating(true);
    setFilename(file.name);

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/accounts/import/validate", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Validation failed.");
      } else {
        setValidation(data.validation);
      }
    } catch (err: any) {
      setError(err?.message || "Validation failed.");
    } finally {
      setValidating(false);
      // Reset file input so the same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const applyImport = async () => {
    if (!validation) return;
    if (validation.totals.errorRows > 0) {
      if (!confirm(`${validation.totals.errorRows} row(s) had errors and will be skipped. Apply the ${validation.totals.okRows + validation.totals.warnRows} valid row(s)?`)) return;
    }
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/accounts/import/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validation, filename }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Apply failed.");
      } else {
        setApplyResult({
          batchId: data.batchId,
          appliedAccounts: data.appliedAccounts,
          appliedTeam: data.appliedTeam,
          skipped: data.skipped,
        });
        setValidation(null);
      }
    } catch (err: any) {
      setError(err?.message || "Apply failed.");
    } finally {
      setApplying(false);
    }
  };

  const reset = () => {
    setValidation(null);
    setApplyResult(null);
    setError(null);
    setFilename("");
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-5 h-5 text-rose-500" />
        <h1 className="text-lg font-black text-slate-900">Accounts — Bulk Import</h1>
      </div>
      <p className="text-[12px] text-slate-500">
        Upload accounts and internal-team assignments from an XLSX file. The system pre-fills the template with your current data — edit it offline, then re-upload. Re-running the same file is safe (idempotent).
      </p>

      {/* Step 1: Download template */}
      <section className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-[13px] font-black text-slate-800">1. Download the template</h2>
            <p className="text-[11px] text-slate-500 mt-1 max-w-xl">
              The template includes every existing account + current internal team assignments. Edit it in Excel or Google Sheets, then upload below.
            </p>
          </div>
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 text-white text-[11px] font-black uppercase tracking-widest shadow-md hover:opacity-90"
          >
            <Download className="w-3.5 h-3.5" />
            Download Template
          </button>
        </div>
      </section>

      {/* Step 2: Upload */}
      <section className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-[13px] font-black text-slate-800">2. Upload the edited file</h2>
            <p className="text-[11px] text-slate-500 mt-1 max-w-xl">
              We'll validate every row first and show you a report. Nothing is changed until you confirm.
            </p>
          </div>
          <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-[11px] font-black uppercase tracking-widest hover:border-rose-300 cursor-pointer">
            {validating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {validating ? "Validating…" : "Choose XLSX"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFile}
              className="hidden"
              disabled={validating || applying}
            />
          </label>
        </div>
        {filename && (
          <p className="text-[10px] text-slate-400 mt-2">📄 {filename}</p>
        )}
      </section>

      {error && (
        <section className="bg-rose-50 border border-rose-200 rounded-2xl p-4">
          <p className="text-[12px] font-black text-rose-700">Error</p>
          <p className="text-[11px] text-rose-600 mt-1">{error}</p>
        </section>
      )}

      {/* Step 3: Validation report */}
      {validation && (
        <section className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-[13px] font-black text-slate-800">3. Review validation report</h2>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
              <Pill icon={<CheckCircle className="w-3 h-3" />} count={validation.totals.okRows} label="ok" color="emerald" />
              <Pill icon={<AlertTriangle className="w-3 h-3" />} count={validation.totals.warnRows} label="warn" color="amber" />
              <Pill icon={<XCircle className="w-3 h-3" />} count={validation.totals.errorRows} label="error" color="rose" />
            </div>
          </div>

          {validation.totals.errorRows > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 flex gap-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Rows with errors will be skipped. You can apply the valid rows and re-upload a fixed version of the rejected rows.</span>
            </div>
          )}

          <ReportTable report={validation.report} />

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={reset}
              className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-[11px] font-black uppercase tracking-widest hover:border-rose-300"
            >
              Cancel
            </button>
            <button
              onClick={applyImport}
              disabled={applying || (validation.totals.okRows + validation.totals.warnRows === 0)}
              className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 text-white text-[11px] font-black uppercase tracking-widest shadow-md disabled:opacity-50 hover:opacity-90"
            >
              {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
              Apply {validation.totals.okRows + validation.totals.warnRows} valid row(s)
            </button>
          </div>
        </section>
      )}

      {/* Step 4: Success */}
      {applyResult && (
        <section className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
            <h2 className="text-[13px] font-black text-emerald-800">Import applied</h2>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3 text-[11px]">
            <Stat label="Accounts upserted" value={applyResult.appliedAccounts} />
            <Stat label="Team rows upserted" value={applyResult.appliedTeam} />
            <Stat label="Skipped (errors)" value={applyResult.skipped} />
          </div>
          <p className="text-[10px] text-emerald-700 mt-3">Batch ID: <code className="font-mono">{applyResult.batchId}</code></p>
          <button
            onClick={reset}
            className="mt-3 px-3 py-2 rounded-xl border border-emerald-300 text-emerald-700 text-[11px] font-black uppercase tracking-widest hover:bg-emerald-100"
          >
            Run another import
          </button>
        </section>
      )}
    </div>
  );
}

function Pill({ icon, count, label, color }: { icon: React.ReactNode; count: number; label: string; color: "emerald" | "amber" | "rose" }) {
  const colors: any = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${colors[color]}`}>
      {icon}
      {count} {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600">{label}</p>
      <p className="text-lg font-black text-emerald-900">{value}</p>
    </div>
  );
}

function ReportTable({ report }: { report: RowReport[] }) {
  if (report.length === 0) {
    return <p className="text-[11px] text-slate-400 italic">No rows in the file.</p>;
  }
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[420px] overflow-y-auto">
      <table className="w-full text-[11px]">
        <thead className="bg-slate-50 sticky top-0">
          <tr>
            <th className="text-left px-2 py-1.5 font-black text-slate-500 uppercase text-[9px] tracking-widest w-24">Sheet</th>
            <th className="text-left px-2 py-1.5 font-black text-slate-500 uppercase text-[9px] tracking-widest w-12">Row</th>
            <th className="text-left px-2 py-1.5 font-black text-slate-500 uppercase text-[9px] tracking-widest w-20">Status</th>
            <th className="text-left px-2 py-1.5 font-black text-slate-500 uppercase text-[9px] tracking-widest">Message</th>
          </tr>
        </thead>
        <tbody>
          {report.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-2 py-1.5 text-slate-500">{r.sheet}</td>
              <td className="px-2 py-1.5 text-slate-400 font-mono">{r.rowNumber}</td>
              <td className="px-2 py-1.5">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-2 py-1.5 text-slate-700">{r.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: "ok" | "warn" | "error" }) {
  if (status === "ok") return <span className="text-emerald-600 font-black uppercase tracking-widest text-[9px]">OK</span>;
  if (status === "warn") return <span className="text-amber-600 font-black uppercase tracking-widest text-[9px]">WARN</span>;
  return <span className="text-rose-600 font-black uppercase tracking-widest text-[9px]">ERROR</span>;
}
