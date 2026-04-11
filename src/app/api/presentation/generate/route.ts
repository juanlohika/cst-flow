import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { clientProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { injectPptxData } from "@/lib/office/pptx-injector";

/**
 * POST /api/presentation/generate
 * Accepts a .pptx template and clientId, returns a populated .pptx
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const clientId = formData.get("clientId") as string;

    if (!file || !clientId) {
      return NextResponse.json({ error: "Missing file or clientId" }, { status: 400 });
    }

    // 1. Fetch Client Intelligence
    const [client] = await db
      .select()
      .from(clientProfiles)
      .where(eq(clientProfiles.id, clientId))
      .limit(1);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // 2. Map Data for Template
    // These keys should match {tags} in the PowerPoint template
    const templateData = {
      client_name: client.companyName,
      industry: client.industry,
      engagement_status: client.engagementStatus,
      contact_person: client.primaryContact || "Valued Client",
      modules: client.modulesAvailed,
      date_generated: new Date().toLocaleDateString(),
      // Add more intelligence fields here
    };

    // 3. Inject Data
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const outputBuffer = await injectPptxData(buffer, templateData);

    // 4. Return the populated PPTX
    return new NextResponse(outputBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="Generated_Presentation_${client.companyName.replace(/\s+/g, "_")}.pptx"`,
      },
    });

  } catch (err: any) {
    console.error("Presentation Generation Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
