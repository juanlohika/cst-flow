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
  const session = await auth();
  if (!session || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const globalSetting = (prisma as any).globalSetting;
    
    // Support batch update {settings: {key1: val1, key2: val2}}
    if (body.settings) {
      const results = [];
      for (const [key, value] of Object.entries(body.settings)) {
        let setting;
        if (globalSetting) {
          setting = await globalSetting.upsert({
            where: { key },
            update: { value: String(value) },
            create: { key, value: String(value) },
          });
        } else {
          console.warn("GlobalSetting model missing in Prisma client, falling back to raw SQL for patch");
          // Manual upsert in SQLite
          await prisma.$executeRawUnsafe(
            `INSERT INTO GlobalSetting (id, [key], value) VALUES (?, ?, ?) 
             ON CONFLICT([key]) DO UPDATE SET value = excluded.value`,
            Math.random().toString(36).substring(7), key, String(value)
          );
          setting = { key, value };
        }
        results.push(setting);
      }
      return NextResponse.json({ success: true, results });
    }

    // Support single update {key, value}
    const { key, value } = body;
    if (!key) return NextResponse.json({ error: "Key is required" }, { status: 400 });

    let setting;
    if (globalSetting) {
      setting = await globalSetting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO GlobalSetting (id, [key], value) VALUES (?, ?, ?) 
         ON CONFLICT([key]) DO UPDATE SET value = excluded.value`,
        Math.random().toString(36).substring(7), key, String(value)
      );
      setting = { key, value };
    }

    return NextResponse.json(setting);
  } catch (error: any) {
    console.error("PATCH /api/admin/settings error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

