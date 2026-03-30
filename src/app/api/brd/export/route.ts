import { NextResponse } from "next/server";
import { marked } from "marked";
import HTMLtoDOCX from "html-to-docx";

export async function POST(req: Request) {
  try {
    const { markdown, title = "Business_Requirements_Document" } = await req.json();

    if (!markdown) {
      return NextResponse.json({ error: "Markdown content is required" }, { status: 400 });
    }

    // Convert Markdown to HTML
    const htmlString = await marked.parse(markdown);

    // Provide standard Word Document styling
    const headerHTML = `
      <div style="font-family: Arial, sans-serif;">
        <h1 style="text-align: center; color: #1e293b; margin-bottom: 2rem;">${title.replace(/_/g, " ")}</h1>
      </div>
    `;
    
    // Wrap the converted markdown in a container for better Word formatting
    const finalHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          <style>
            body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
            h1, h2, h3 { color: #1e293b; margin-top: 24px; margin-bottom: 12px; }
            h1 { border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
            p { margin-bottom: 14px; }
            ul, ol { margin-bottom: 16px; padding-left: 24px; }
            li { margin-bottom: 6px; }
            table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
            th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; }
            th { background-color: #f1f5f9; font-weight: bold; }
            code { background-color: #f1f5f9; padding: 2px 4px; border-radius: 4px; font-family: monospace; }
          </style>
        </head>
        <body>
          ${headerHTML}
          ${htmlString}
        </body>
      </html>
    `;

    // Convert HTML to DOCX Buffer
    const fileBuffer = await HTMLtoDOCX(finalHTML, null, {
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
    });

    // Return as a downloadable DOCX file
    return new NextResponse(fileBuffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${title}.docx"`,
      },
    });
  } catch (error: any) {
    console.error("DOCX Export Error:", error);
    return NextResponse.json(
      { error: "Failed to generate DOCX file", details: error.message },
      { status: 500 }
    );
  }
}
