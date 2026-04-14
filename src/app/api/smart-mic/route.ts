import { NextResponse } from "next/server";
import { getGeminiModel } from "@/lib/ai";

export async function POST(req: Request) {
  try {
    const { rawText } = await req.json();
    if (!rawText) {
      return NextResponse.json({ error: "No text data provided for cleanup" }, { status: 400 });
    }

    const model = await getGeminiModel();

    const promptText = `
You are an expert dictation cleanup assistant. 
1. I am going to provide you with raw text transcribed directly from a user's microphone.
2. Clean up any filler words like "um", "ah", "like", "you know".
3. Remove any obvious off-topic tangents or conversational stutters.
4. Output ONLY the polished, professional text transcript that is ready to be used as a business prompt. Do not add any conversational replies of your own.

RAW TEXT: "${rawText}"
`;

    const result = await generateWithRetry(model, promptText);
    const responseText = result.response.text();

    return NextResponse.json({ text: responseText.trim() });
  } catch (error: any) {
    console.error("Smart Mic Error:", error);
    return NextResponse.json({ error: error.message || "Failed to process text" }, { status: 500 });
  }
}
