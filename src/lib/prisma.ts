import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function createPrisma() {
  try {
    console.log('🔌 Initializing Prisma Client...');
    const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
    const adapter = new PrismaLibSql({ url: dbUrl });
    return new PrismaClient({ adapter });
  } catch (error) {
    console.error('❌ Prisma Initialization Failed:', error);
    throw error;
  }
}

export const prisma = globalForPrisma.prisma || createPrisma();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
