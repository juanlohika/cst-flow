import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding mock admin user...");
  
  const admin = await prisma.user.upsert({
    where: { email: "admin@cst.com" },
    update: {},
    create: {
      id: "mock-admin-id",
      name: "CST Admin (Mock)",
      email: "admin@cst.com",
      role: "admin",
      status: "approved",
      canAccessTimeline: true,
      canAccessArchitect: true,
      canAccessBRD: true,
    },
  });

  console.log("Seeded Admin:", admin);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
