import { prisma } from "./src/lib/prisma";

async function main() {
  console.log("Creating TaskAssignment table...");
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS TaskAssignment (
      id TEXT PRIMARY KEY,
      timelineItemId TEXT NOT NULL,
      userId TEXT NOT NULL,
      FOREIGN KEY (timelineItemId) REFERENCES TimelineItem(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS TaskAssignment_timelineItemId_userId_key ON TaskAssignment(timelineItemId, userId)
  `);

  console.log("Creating MeetingAssignment table...");
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS MeetingAssignment (
      id TEXT PRIMARY KEY,
      meetingId TEXT NOT NULL,
      userId TEXT NOT NULL,
      FOREIGN KEY (meetingId) REFERENCES TarkieMeeting(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS MeetingAssignment_meetingId_userId_key ON MeetingAssignment(meetingId, userId)
  `);

  console.log("Tables created successfully.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
