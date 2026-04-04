import { NextResponse } from "next/server";
import { db } from "@/db";
import { globalSettings as globalSettingsTable } from "@/db/schema";
import { auth } from "@/auth";

export async function GET() {
  try {
    const settings = await db.select().from(globalSettingsTable);
    const config: Record<string, string> = {};
    
    settings.forEach((s: any) => {
      config[s.key] = s.value;
    });

    // Provide generic fallbacks only if DB is empty
    return NextResponse.json({
      ...config,
      app_name: config.app_name || "FlowDesk",
      app_logo: config.bottom_logo_url || config.company_logo || "",
    });
  } catch (error: any) {
    console.error("GET /api/admin/settings error:", error);
    return NextResponse.json({
      app_name: "FlowDesk",
      app_logo: ""
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
        await db.insert(globalSettingsTable)
          .values({
            id: `set_${key}_${Math.random().toString(36).substring(7)}`,
            key,
            value: String(value),
          })
          .onConflictDoUpdate({
            target: globalSettingsTable.key,
            set: { 
              value: String(value),
              updatedAt: new Date().toISOString()
            },
          });
        results.push({ key, value });
      }
      return NextResponse.json({ success: true, results });
    }

    // 2. Process SINGLE updates {key, value}
    const { key, value } = body;
    if (key) {
      await db.insert(globalSettingsTable)
        .values({
          id: `set_${key}_${Math.random().toString(36).substring(7)}`,
          key,
          value: String(value),
        })
        .onConflictDoUpdate({
          target: globalSettingsTable.key,
          set: { 
            value: String(value),
            updatedAt: new Date().toISOString()
          },
        });
      return NextResponse.json({ key, value });
    }

    return NextResponse.json({ error: "No settings provided" }, { status: 400 });
  } catch (error: any) {
    console.error("PATCH /api/admin/settings error:", error);
    return NextResponse.json({ error: error.message || "Failed to update settings" }, { status: 500 });
  }
}

