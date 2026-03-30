import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  // BOOTSTRAP: Automatically create missing tables in production via raw SQL
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS User (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        emailVerified DATETIME,
        image TEXT,
        role TEXT DEFAULT 'user',
        isSuperAdmin BOOLEAN DEFAULT 0,
        status TEXT DEFAULT 'pending'
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS App (
        id TEXT PRIMARY KEY,
        name TEXT,
        slug TEXT UNIQUE,
        description TEXT,
        icon TEXT,
        href TEXT,
        isActive BOOLEAN DEFAULT 1,
        isBuiltIn BOOLEAN DEFAULT 0,
        sortOrder INTEGER DEFAULT 0
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS GlobalSetting (
        id TEXT PRIMARY KEY,
        [key] TEXT UNIQUE,
        value TEXT
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ClientProfile (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        companyName TEXT NOT NULL,
        industry TEXT NOT NULL,
        modulesAvailed TEXT NOT NULL,
        engagementStatus TEXT DEFAULT 'confirmed',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
      );
    `);
  } catch (e) {
    console.error("Bootstrap Error:", e);
  }

  let dbStatus = false;
  try {
    await prisma.user.count();
    dbStatus = true;
  } catch (e) {
    dbStatus = false;
  }

  // SECURE: We only return whether the variable IS PRESENT (true/false)
  return NextResponse.json({
    hasGoogleId: !!process.env.AUTH_GOOGLE_ID,
    hasGoogleSecret: !!process.env.AUTH_GOOGLE_SECRET,
    hasAuthSecret: !!process.env.AUTH_SECRET,
    hasAuthUrl: !!process.env.AUTH_URL,
    hasTrustHost: !!process.env.AUTH_TRUST_HOST,
    hasDatabase: dbStatus,
    timestamp: new Date().toISOString(),
  });
}
