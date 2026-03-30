import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    console.log("Web Seeding: Creating mock admin...");
    
    const data = {
        id: "mock-admin-id",
        name: "CST Admin (Mock)",
        email: "admin@cst.com",
        role: "admin",
        status: "approved",
    } as any;

    const admin = await prisma.user.upsert({
      where: { email: "admin@cst.com" },
      update: {},
      create: data,
    });

    return NextResponse.json({ 
      success: true, 
      message: "Admin seeded successfully", 
      user: admin 
    });
  } catch (error: any) {
    console.error("Web Seed Error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
