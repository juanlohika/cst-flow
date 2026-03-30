const { PrismaClient } = require("../src/generated/client");

const prisma = new PrismaClient({
  datasources: { db: { url: "file:./prisma/dev.db" } },
});

async function main() {
  console.log("🌱 Seeding timeline templates...");

  // ── Template 1: New Client Implementation ──
  const coreTemplate = await prisma.timelineTemplate.upsert({
    where: { name: "New Client Implementation" },
    update: {},
    create: {
      name: "New Client Implementation",
      description: "Standard onboarding flow for new clients — from kick-off through 30-day feedback.",
      restDays: "Saturday,Sunday",
      tasks: {
        create: [
          { taskCode: "CST-CORE-TASK-TEMPLATE-0001", subject: "Kick-Off Meeting", defaultDuration: 2, sortOrder: 1 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0002", subject: "Send Initial Master Data", defaultDuration: 4, sortOrder: 2 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0003", subject: "Fit Gap Analysis and Reco Preparation", defaultDuration: 24, sortOrder: 3 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0004", subject: "Scoping Customization Requirements: Platform Enhancement or Client-Specific Customization", defaultDuration: 16, sortOrder: 4 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0005", subject: "Recommendation Deck Presentation - Internal", defaultDuration: 4, sortOrder: 5 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0006", subject: "Recommendation Deck Presentation - External", defaultDuration: 4, sortOrder: 6 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0007", subject: "Recommendation Deck Approval", defaultDuration: 8, sortOrder: 7 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0008", subject: "Contract Sign-Off", defaultDuration: 8, sortOrder: 8 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0009", subject: "Creation of Dashboard", defaultDuration: 16, sortOrder: 9 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0010", subject: "Masterdata Validation", defaultDuration: 8, sortOrder: 10 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0011", subject: "Masterdata Set Up and Configuration", defaultDuration: 24, sortOrder: 11 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0012", subject: "Setup Clearance", defaultDuration: 4, sortOrder: 12 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0013", subject: "Alignment Meeting", defaultDuration: 2, sortOrder: 13 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0014", subject: "User Acceptance Test", defaultDuration: 16, sortOrder: 14 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0015", subject: "Training Material Preparation", defaultDuration: 16, sortOrder: 15 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0016", subject: "Admin Training", defaultDuration: 4, sortOrder: 16 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0017", subject: "User Training", defaultDuration: 8, sortOrder: 17 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0018", subject: "Go Live", defaultDuration: 8, sortOrder: 18 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0019", subject: "Day 1 Launch Update", defaultDuration: 2, sortOrder: 19 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0020", subject: "30-Day Viber Update", defaultDuration: 2, sortOrder: 20 },
          { taskCode: "CST-CORE-TASK-TEMPLATE-0021", subject: "Feedback Meeting", defaultDuration: 2, sortOrder: 21 },
        ],
      },
    },
  });

  // ── Template 2: Customization Project ──
  const customTemplate = await prisma.timelineTemplate.upsert({
    where: { name: "Customization Project" },
    update: {},
    create: {
      name: "Customization Project",
      description: "End-to-end custom development project from requirements gathering through go-live.",
      restDays: "Saturday,Sunday",
      tasks: {
        create: [
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0001", subject: "Requirements Gathering & Customization Identification", defaultDuration: 16, sortOrder: 1 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0002", subject: "Business Requirements Documentation", defaultDuration: 24, sortOrder: 2 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0003", subject: "Wireframes and Mock-ups Preparation & Review", defaultDuration: 24, sortOrder: 3 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0004", subject: "Wireframes and Mock-ups Final Review and Approval", defaultDuration: 8, sortOrder: 4 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0005", subject: "Development", defaultDuration: 80, sortOrder: 5 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0006", subject: "Internal Testing", defaultDuration: 24, sortOrder: 6 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0007", subject: "Setup Clearance", defaultDuration: 4, sortOrder: 7 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0008", subject: "Alignment Meeting with Client", defaultDuration: 2, sortOrder: 8 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0009", subject: "User Acceptance Testing (UAT)", defaultDuration: 24, sortOrder: 9 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0010", subject: "Masterdata Set Up and Configuration", defaultDuration: 16, sortOrder: 10 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0011", subject: "Training Material Preparation", defaultDuration: 16, sortOrder: 11 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0012", subject: "Admin & User Training", defaultDuration: 8, sortOrder: 12 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0013", subject: "Go Live", defaultDuration: 8, sortOrder: 13 },
          { taskCode: "CST-CUSTOM-TASK-TEMPLATE-0014", subject: "Feedback Meeting", defaultDuration: 2, sortOrder: 14 },
        ],
      },
    },
  });

  console.log(`✅ Seeded: "${coreTemplate.name}" (21 tasks)`);
  console.log(`✅ Seeded: "${customTemplate.name}" (14 tasks)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
