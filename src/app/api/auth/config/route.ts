import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbStatus = false;
  try {
    await prisma.user.count();
    dbStatus = true;
  } catch (e) {
    dbStatus = false;
  }

  // SECURE: We only return whether the variable IS PRESENT (true/false)
  return NextResponse.json({
    hasGoogleId: !!process.env.AUTH_GOOGLE_ID,
    hasGoogleSecret: !!process.env.AUTH_GOOGLE_SECRET,
    hasAuthSecret: !!process.env.AUTH_SECRET,
    hasAuthUrl: !!process.env.AUTH_URL,
    hasTrustHost: !!process.env.AUTH_TRUST_HOST,
    hasDatabase: dbStatus,
    timestamp: new Date().toISOString(),
  });
}
