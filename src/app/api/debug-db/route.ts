import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // 1. Check environment variables (redacted)
    const dbUrl = process.env.DATABASE_URL;
    const hasToken = !!process.env.DATABASE_AUTH_TOKEN;
    
    // 2. Try a simple query
    const userCount = await prisma.user.count();
    
    return NextResponse.json({
      status: "connected",
      databaseUrl: dbUrl ? dbUrl.split('@')[0] : "not set", // Redact sensitive parts
      hasAuthToken: hasToken,
      hasAuthSecret: !!process.env.AUTH_SECRET,
      nextAuthUrl: process.env.NEXTAUTH_URL || "not set",
      userCount: userCount,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("❌ DB Debug Route Failed:", error);
    return NextResponse.json({
      status: "error",
      message: error.message,
      stack: error.stack,
      env: {
        DATABASE_URL: process.env.DATABASE_URL ? "SET" : "NOT SET",
        DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN ? "SET" : "NOT SET"
      }
    }, { status: 500 });
  }
}
