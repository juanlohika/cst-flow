"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

interface RecurringConfigProps {
  isRecurringTemplate: boolean;
  recurringFrequency: string | null;
  recurringUntil: string | null; // ISO date or null
  onChange: (patch: {
    isRecurringTemplate: boolean;
    recurringFrequency: string | null;
    recurringUntil: string | null;
  }) => void;
}

export default function RecurringConfig({
  isRecurringTemplate,
  recurringFrequency,
  recurringUntil,
  onChange,
}: RecurringConfigProps) {
  const [indefinite, setIndefinite] = useState(!recurringUntil);

  function toggle(enabled: boolean) {
    onChange({
      isRecurringTemplate: enabled,
      recurringFrequency: enabled ? (recurringFrequency ?? "monthly") : null,
      recurringUntil: enabled && !indefinite ? recurringUntil : null,
    });
  }

  function setFreq(freq: string) {
    onChange({ isRecurringTemplate, recurringFrequency: freq, recurringUntil });
  }

  function setUntil(val: string) {
    onChange({ isRecurringTemplate, recurringFrequency, recurringUntil: val || null });
  }

  function toggleIndefinite(val: boolean) {
    setIndefinite(val);
    if (val) {
      onChange({ isRecurringTemplate, recurringFrequency, recurringUntil: null });
    }
  }

  return (
    <div className="space-y-4 py-2">
      {/* Enable toggle */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => toggle(!isRecurringTemplate)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
            isRecurringTemplate ? "bg-blue-600" : "bg-gray-200"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              isRecurringTemplate ? "translate-x-4" : "translate-x-1"
            }`}
          />
        </button>
        <div className="flex items-center gap-1.5">
          <RefreshCw size={13} className={isRecurringTemplate ? "text-blue-600" : "text-gray-400"} />
          <span className="text-[11px] font-medium text-gray-700">
            {isRecurringTemplate ? "Recurring enabled" : "Enable recurring"}
          </span>
        </div>
      </div>

      {isRecurringTemplate && (
        <>
          {/* Frequency pills */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Frequency</p>
            <div className="flex gap-1.5 flex-wrap">
              {FREQUENCIES.map(f => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFreq(f.value)}
                  className={`px-3 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    recurringFrequency === f.value
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-blue-400"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* End date */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Recurs until</p>
            <div className="flex gap-4 items-start">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  checked={indefinite}
                  onChange={() => toggleIndefinite(true)}
                  className="accent-blue-600"
                />
                <span className="text-[11px] text-gray-700">Indefinitely (no end date)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  checked={!indefinite}
                  onChange={() => toggleIndefinite(false)}
                  className="accent-blue-600"
                />
                <span className="text-[11px] text-gray-700">Until date</span>
              </label>
            </div>
            {!indefinite && (
              <input
                type="date"
                value={recurringUntil ? recurringUntil.split("T")[0] : ""}
                onChange={e => setUntil(e.target.value)}
                className="mt-2 h-8 rounded-md border border-gray-200 px-2 text-[11px] text-gray-700 focus:outline-none focus:border-blue-400"
              />
            )}
          </div>

          <p className="text-[10px] text-gray-400">
            This task will auto-appear at the selected frequency. You can complete individual occurrences
            without affecting the template.
          </p>
        </>
      )}
    </div>
  );
}
