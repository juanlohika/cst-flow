import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // SECURE: We only return whether the variable IS PRESENT (true/false)
  // We NEVER return the actual value of a secret.
  return NextResponse.json({
    hasGoogleId: !!process.env.AUTH_GOOGLE_ID,
    hasGoogleSecret: !!process.env.AUTH_GOOGLE_SECRET,
    hasAuthSecret: !!process.env.AUTH_SECRET,
    hasAuthUrl: !!process.env.AUTH_URL,
    hasTrustHost: !!process.env.AUTH_TRUST_HOST,
    timestamp: new Date().toISOString(),
  });
}
