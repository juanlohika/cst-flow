import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

const ALLOWED_DOMAINS = ["mobileoptima.com", "tarkie.com", "olern.ph", "cst.com"];
const ADMIN_EMAILS = ["lester.alarcon@mobileoptima.com", "admin@cst.com"];

function isDomainAllowed(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return ALLOWED_DOMAINS.includes(domain);
}

const credentialsProvider = Credentials({
  name: "Email Login",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(credentials) {
    const email = String(credentials?.email || "").toLowerCase().trim();
    const password = String(credentials?.password || "").trim();
    const devPassword = (process.env.DEV_PASSWORD || "").trim();

    let userData: any = null;

    if (email === "admin@cst.com") {
      if (password === "admin" || password === "cst2025" || (devPassword && password === devPassword)) {
        // Find existing or use default
        const existing = await prisma.user.findUnique({ where: { email } });
        userData = { 
          id: existing?.id || "dev-admin", 
          name: "Admin", 
          email, 
          role: "admin" 
        };
      } else {
        console.error(`❌ Admin auth mismatch for ${email}`);
      }
    } else if (isDomainAllowed(email) && devPassword && password === devPassword) {
      const existing = await prisma.user.findUnique({ where: { email } });
      const role = ADMIN_EMAILS.includes(email) ? "admin" : "user";
      userData = { 
        id: existing?.id || email, 
        name: email.split("@")[0], 
        email, 
        role 
      };
    }

    if (!userData) {
      return null;
    }

    try {
      // Upsert the user into the DB so FK constraints (projects, tasks, etc.) work
      const isAdmin = ADMIN_EMAILS.includes(userData.email);
      console.log(`💾 Syncing user to DB: ${userData.email}`);
      
      await prisma.user.upsert({
        where: { email: userData.email },
        create: {
          id: userData.id,
          email: userData.email,
          name: userData.name,
          role: userData.role,
          status: isAdmin ? "approved" : "pending",
        },
        update: {
          name: userData.name,
          role: userData.role,
          ...(isAdmin ? { status: "approved" } : {}),
        },
      });
      console.log(`✅ User sync complete: ${userData.email}`);
    } catch (dbError) {
      console.error("❌ Database sync failed during auth:", dbError);
    }

    return userData;
  },
});

const googleProvider =
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
    ? Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
        allowDangerousEmailAccountLinking: true,
      })
    : null;

const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  providers: [
    ...(googleProvider ? [googleProvider] : []),
    credentialsProvider,
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user, account, profile }) {
      const email = (user.email || "").toLowerCase().trim();
      if (account?.provider === "google") {
        if (!isDomainAllowed(email)) {
          // Allow if user has a pending invite for this email
          const invitedUser = await prisma.$queryRawUnsafe<any[]>(
            `SELECT id FROM User WHERE email = ? AND inviteToken IS NOT NULL`, email
          );
          if (!invitedUser.length) return "/auth/signin?error=domain";
        }
      }
      // Auto-approve users who have a pending invite when they sign in
      const pendingInvite = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM User WHERE email = ? AND status = 'pending' AND inviteToken IS NOT NULL`, email
      );
      if (pendingInvite.length) {
        await prisma.$executeRawUnsafe(
          `UPDATE User SET status = 'approved', inviteToken = NULL WHERE email = ?`, email
        );
      }
      // Guarantee admin emails always have admin role + approved status in DB
      if (ADMIN_EMAILS.includes(email)) {
        await prisma.$executeRawUnsafe(
          `UPDATE User SET role = 'admin', status = 'approved' WHERE email = ?`, email
        );
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        const email = user.email?.toLowerCase() || "";
        token.role = ADMIN_EMAILS.includes(email) ? "admin" : ((user as any).role || "user");
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id || token.sub;
        (session.user as any).role = token.role || "user";
      }
      return session;
    },
  },
  pages: { signIn: "/auth/signin" },
});

export { handlers, signIn, signOut, auth };
