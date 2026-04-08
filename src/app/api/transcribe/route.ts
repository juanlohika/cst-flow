import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { readAIConfig } from "@/lib/ai";

/**
 * Transcription API using Groq Whisper
 * Capture: multipart/form-data with 'audio' blob
 */
export async function POST(req: Request) {
  try {
    const config = await readAIConfig();
    if (!config.groqApiKey) {
      return NextResponse.json({ error: "Groq API key not configured" }, { status: 500 });
    }

    const formData = await req.formData();
    const audioBlob = formData.get("audio") as Blob;

    if (!audioBlob) {
      return NextResponse.json({ error: "No audio blob provided" }, { status: 400 });
    }

    // Convert Blob to File for Groq SDK
    const audioFile = new File([audioBlob], "audio.webm", { type: audioBlob.type });

    const groq = new Groq({ apiKey: config.groqApiKey });

    // Whisper supports Taglish best when auto-detecting or when hint is provided
    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3",
      prompt: "This is a business meeting for Tarkie. Please ensure product names are captured correctly.", // Context hint
      response_format: "json",
    });

    let text = transcription.text || "";

    // ─── Branding Integrity Logic ─────────────────────────────────────────────
    // Non-negotiable rule: Turkey/Starkey -> Tarkie
    const cleanText = text.replace(/\b(Turkey|Starkey|starkey|turkey)\b/g, "Tarkie");

    return NextResponse.json({ text: cleanText });
  } catch (error: any) {
    console.error("Transcription Error:", error);
    return NextResponse.json({ error: error.message || "Transcription failed" }, { status: 500 });
  }
}
