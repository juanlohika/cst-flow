import { NextResponse } from "next/server";
import { db } from "@/db";
import { globalSettings as globalSettingsTable } from "@/db/schema";

export async function GET() {
  try {
    const settings = await db.select().from(globalSettingsTable);
    const cfg: Record<string, string> = {};
    settings.forEach(s => { cfg[s.key] = s.value; });

    return NextResponse.json({
      primaryProvider: cfg.primaryProvider || "groq",
      ollamaEndpoint: cfg.ollamaEndpoint || "http://localhost:11434",
      ollamaModel: cfg.ollamaModel || "llama3.2",
      groqApiKey: cfg.groqApiKey || "",
      geminiApiKey: cfg.geminiApiKey || "",
      anthropicApiKey: cfg.anthropicApiKey || "",
      smtpHost: cfg.smtpHost || "",
      smtpPort: cfg.smtpPort || "",
      smtpSecure: cfg.smtpSecure === "true",
      smtpUser: cfg.smtpUser || "",
      smtpPass: cfg.smtpPass || "",
      smtpFrom: cfg.smtpFrom || "",
      app_name: cfg.app_name || "FlowDesk",
      app_logo: cfg.bottom_logo_url || cfg.company_logo || "",
    });
  } catch (err) {
    console.error("GET /api/settings error:", err);
    return NextResponse.json({
      primaryProvider: "groq",
      ollamaEndpoint: "http://localhost:11434",
      ollamaModel: "llama3.2",
      groqApiKey: "",
      geminiApiKey: "",
      anthropicApiKey: "",
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Keep legacy apiKey in sync with the active provider key
    if (body.primaryProvider === "groq" && body.groqApiKey) body.apiKey = body.groqApiKey;
    else if (body.primaryProvider === "gemini" && body.geminiApiKey) body.apiKey = body.geminiApiKey;
    else if (body.primaryProvider === "claude" && body.anthropicApiKey) body.apiKey = body.anthropicApiKey;

    for (const [key, val] of Object.entries(body)) {
      if (val !== undefined && val !== null) {
        await db.insert(globalSettingsTable)
          .values({
            id: `set_${key}_${Math.random().toString(36).substring(7)}`,
            key,
            value: String(val),
          })
          .onConflictDoUpdate({
            target: globalSettingsTable.key,
            set: { 
              value: String(val),
              updatedAt: new Date().toISOString()
            },
          });
      }
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save settings", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
