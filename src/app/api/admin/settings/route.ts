import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET() {
  try {
    const settings = await prisma.$queryRawUnsafe(`SELECT * FROM GlobalSetting`) as any[];
    const config: Record<string, string> = {
      app_name: "CST FlowDesk",
      company_name: "Tarkie",
      company_logo: "/tarkie-logo.svg"
    };
    settings.forEach((s: any) => {
      config[s.key] = s.value;
    });
    return NextResponse.json(config);
  } catch (error: any) {
    return NextResponse.json({
      app_name: "CST FlowDesk",
      company_name: "Tarkie"
    });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const results = [];

    // 1. Process BATCH updates {settings: {key1: val1, key2: val2}}
    if (body.settings) {
      for (const [key, value] of Object.entries(body.settings)) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO GlobalSetting (id, [key], value) VALUES (?, ?, ?) 
           ON CONFLICT([key]) DO UPDATE SET value = excluded.value`,
          `set_${key}_${Math.random().toString(36).substring(7)}`, 
          key, 
          String(value)
        );
        results.push({ key, value });
      }
      return NextResponse.json({ success: true, results });
    }

    // 2. Process SINGLE updates {key, value}
    const { key, value } = body;
    if (key) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO GlobalSetting (id, [key], value) VALUES (?, ?, ?) 
         ON CONFLICT([key]) DO UPDATE SET value = excluded.value`,
        `set_${key}_${Math.random().toString(36).substring(7)}`, 
        key, 
        String(value)
      );
      return NextResponse.json({ key, value });
    }

    return NextResponse.json({ error: "No settings provided" }, { status: 400 });
  } catch (error: any) {
    console.error("PATCH /api/admin/settings error:", error);
    return NextResponse.json({ error: error.message || "Failed to update settings" }, { status: 500 });
  }
}

