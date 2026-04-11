"use client";

import { useEffect } from "react";

/**
 * This page is the OAuth callback target for the Office Add-in popup auth flow.
 * After Google sign-in completes, the user lands here and the popup closes itself.
 * The parent taskpane detects the session via polling and reloads.
 */
export default function AuthCompletePage() {
  useEffect(() => {
    // Give the session cookie a moment to settle, then close the popup
    setTimeout(() => {
      window.close();
    }, 1000);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-white p-8 text-center">
      <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 className="text-xl font-black text-slate-800 mb-2">Signed In!</h1>
      <p className="text-sm text-slate-500">This window will close automatically...</p>
    </div>
  );
}
