import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dbPath = path.resolve(process.cwd(), "dev.db");
    const testCount = await prisma.user.count();
    return NextResponse.json({ 
      status: "HEALTHY", 
      dbPath, 
      userCount: testCount,
      now: new Date().toISOString()
    });
  } catch (err: any) {
    return NextResponse.json({ 
      status: "ERROR", 
      message: err.message, 
      stack: err.stack,
      cwd: process.cwd(),
      envDbUrl: process.env.DATABASE_URL
    }, { status: 500 });
  }
}
