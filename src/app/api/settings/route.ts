import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const SETTINGS_FILE = path.join(process.cwd(), "config.json");

export async function GET() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, "utf-8");
    return NextResponse.json(JSON.parse(data));
  } catch {
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

    let existing: Record<string, any> = {};
    try {
      const data = await fs.readFile(SETTINGS_FILE, "utf-8");
      existing = JSON.parse(data);
    } catch {}

    const updated = { ...existing, ...body };

    // Keep legacy apiKey in sync with the active provider key
    if (updated.primaryProvider === "groq" && updated.groqApiKey) {
      updated.apiKey = updated.groqApiKey;
    } else if (updated.primaryProvider === "gemini" && updated.geminiApiKey) {
      updated.apiKey = updated.geminiApiKey;
    } else if (updated.primaryProvider === "claude" && updated.anthropicApiKey) {
      updated.apiKey = updated.anthropicApiKey;
    }

    await fs.writeFile(SETTINGS_FILE, JSON.stringify(updated, null, 2), "utf-8");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save settings", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
