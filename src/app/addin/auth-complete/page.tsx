"use client";

import { useEffect, useState } from "react";
import { PublicClientApplication } from "@azure/msal-browser";

const MSAL_CONFIG = {
  auth: {
    clientId: "d35494c1-a8b2-4877-b6ba-e7e580768b72",
    authority: "https://login.microsoftonline.com/common",
    redirectUri: typeof window !== "undefined" ? window.location.origin + "/addin/auth-complete" : "",
  },
  cache: { cacheLocation: "localStorage", storeAuthStateInCookie: false },
};

/**
 * Handles both:
 * 1. Google OAuth popup callback — closes itself after session settles
 * 2. MSAL redirect callback — processes the auth response then closes/redirects back to /addin
 */
export default function AuthCompletePage() {
  const [status, setStatus] = useState("Completing sign-in...");

  useEffect(() => {
    const handleAuth = async () => {
      // Handle MSAL redirect response if hash/search contains auth params
      const hasAuthParams =
        window.location.hash.includes("access_token") ||
        window.location.hash.includes("code=") ||
        window.location.search.includes("code=") ||
        window.location.search.includes("error=");

      if (hasAuthParams) {
        try {
          const msal = new PublicClientApplication(MSAL_CONFIG);
          await msal.initialize();
          const result = await msal.handleRedirectPromise();
          if (result) {
            setStatus("Microsoft connected! Returning to add-in...");
            // Redirect back to the task pane
            setTimeout(() => {
              window.location.href = "/addin";
            }, 1000);
            return;
          }
        } catch (e) {
          console.error("MSAL redirect handling failed:", e);
          setStatus("Sign-in failed. Returning...");
          setTimeout(() => { window.location.href = "/addin"; }, 2000);
          return;
        }
      }

      // Default: Google OAuth popup — close this window
      setStatus("Signed in! Closing...");
      setTimeout(() => {
        window.close();
      }, 1000);
    };

    handleAuth();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-white p-8 text-center">
      <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 className="text-xl font-black text-slate-800 mb-2">Signed In!</h1>
      <p className="text-sm text-slate-500">{status}</p>
    </div>
  );
}
