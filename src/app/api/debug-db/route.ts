import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    // 1. Check environment variables (redacted)
    const dbUrl = process.env.DATABASE_URL;
    const hasToken = !!process.env.DATABASE_AUTH_TOKEN;
    
    // 2. Try a simple query
    const users = await prisma.user.findMany({
      select: { email: true }
    });
    
    // Redact emails for safety
    const redactedUsers = users.map(u => {
      const parts = (u.email || "").split('@');
      if (parts.length < 2) return "invalid";
      return `${parts[0].slice(0, 2)}***@${parts[1]}`;
    });

    // 3. Read canary version
    let deployedVersion = "unknown";
    try {
      const fs = await import('fs');
      const path = await import('path');
      deployedVersion = fs.readFileSync(path.join(process.cwd(), 'public/debug.txt'), 'utf8');
    } catch (e) {
      deployedVersion = "file not found";
    }

    return NextResponse.json({
      status: "connected",
      deployedVersion,
      databaseUrl: dbUrl ? dbUrl.split('@')[0] : "not set", // Redact sensitive parts
      hasAuthToken: hasToken,
      hasAuthSecret: !!process.env.AUTH_SECRET,
      nextAuthUrl: process.env.NEXTAUTH_URL || "not set",
      users: redactedUsers,
      userCount: users.length,
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
