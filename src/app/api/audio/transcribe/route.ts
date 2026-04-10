import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getGeminiModel } from "@/lib/ai";

/**
 * POST /api/audio/transcribe
 * High-performance server-side transcription using Groq Whisper or Gemini.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file") as Blob;
    
    if (!file) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const model = await getGeminiModel();
    
    if (!model.transcribeAudio) {
        return NextResponse.json({ error: "Transcription not supported by current AI provider" }, { status: 501 });
    }

    const text = await model.transcribeAudio(buffer, file.type || "audio/webm");

    return NextResponse.json({ text });
  } catch (err: any) {
    console.error("POST /api/audio/transcribe error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
