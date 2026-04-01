import { NextResponse } from "next/server";
import { getModelForApp } from "@/lib/ai";

export async function POST(req: Request) {
  try {
    const { templateName, tasks, startDate, restDays, customInstructions } = await req.json();
    const headerKey = req.headers.get("x-gemini-key") || "";

    if (!tasks || tasks.length === 0) return NextResponse.json({ error: "No tasks provided" }, { status: 400 });
    if (!startDate) return NextResponse.json({ error: "Start date required" }, { status: 400 });

    const model = await getModelForApp("timeline");

    const timelineInstruction = `You are an expert strict Project Manager AI.
I am providing you a list of template tasks, a project start date, and days of the week that are considered 'rest days' (weekends/holidays).
Your job is to generate a chronological timeline and calculate the exact Start Date and End Date (YYYY-MM-DD) for each task.

RULES:
1. Calculate the start and end dates chronologically based on the 'defaultDuration' (in hours). Assume 1 workday = 8 hours.
2. If a task takes 8 hours, it ends on the same day it starts. If it takes 16 hours, it ends the next working day.
3. DO NOT schedule any work on the provided 'restDays'. Skip over them.
4. If there are 'customInstructions' provided by the user, adjust the plan accordingly (e.g. skip a task, expedite another).
5. Output MUST be ONLY a raw JSON array. Do not include markdown formatting or backticks.

OUTPUT JSON SCHEMA ARRAY:
[
  {
    "subject": "Task Name",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "durationHours": Number,
    "owner": "Who usually handles this (e.g. BA, Dev, Client, PM)",
    "description": "Short reasoning or detail"
  }
]`;

    const userPrompt = `
TEMPLATE: ${templateName}
PROJECT START DATE: ${startDate}
REST DAYS (SKIP THESE): ${restDays || 'None'}
CUSTOM INSTRUCTIONS: ${customInstructions || 'None'}

TASKS TO SCHEDULE (in chronological order):
${JSON.stringify(tasks, null, 2)}
    `;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { role: "system", parts: [{ text: timelineInstruction }] },
      generationConfig: {
         temperature: 0.1 // Low temp for deterministic calculations
      }
    });

    const text = result.response.text();
    
    try {
      const cleanJson = text.replace(/```json/i, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      return NextResponse.json(parsed);
    } catch (parseErr) {
      console.error("Timeline Parse Error:", parseErr, "Raw Text:", text);
      return NextResponse.json({ error: "Timeline payload was not valid JSON. Check server logs." }, { status: 500 });
    }
  } catch (error: any) {
    console.error("Timeline Generation Root Error:", error);
    return NextResponse.json({ error: `AI Generation Failed: ${error.message}` }, { status: 500 });
  }
}
