"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}

const TYPE_STYLES: Record<ToastType, { icon: React.ReactNode; accent: string }> = {
  success: {
    icon: <CheckCircle2 size={14} />,
    accent: "#22c55e",
  },
  error: {
    icon: <AlertCircle size={14} />,
    accent: "#ef4444",
  },
  info: {
    icon: <Info size={14} />,
    accent: "#2162F9",
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "success") => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {toasts.map((toast) => {
          const { icon, accent } = TYPE_STYLES[toast.type];
          return (
            <div
              key={toast.id}
              style={{
                pointerEvents: "auto",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                background: "#ffffff",
                border: "1px solid var(--color-border-default, #e5e7eb)",
                borderLeft: `3px solid ${accent}`,
                borderRadius: 6,
                boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
                minWidth: 260,
                maxWidth: 380,
                fontFamily: "Inter, sans-serif",
                animation: "tarkie-toast-in 0.2s ease",
              }}
            >
              <span style={{ color: accent, display: "flex", alignItems: "center", flexShrink: 0 }}>
                {icon}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--color-text-primary, #111827)",
                  lineHeight: 1.4,
                }}
              >
                {toast.message}
              </span>
              <button
                onClick={() => removeToast(toast.id)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 2,
                  color: "var(--color-text-muted, #9ca3af)",
                  display: "flex",
                  alignItems: "center",
                  borderRadius: 4,
                  flexShrink: 0,
                }}
                aria-label="Dismiss"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes tarkie-toast-in {
          from { opacity: 0; transform: translateX(12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
