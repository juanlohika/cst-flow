import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/db";
import { users as usersTable } from "@/db/schema";
import { eq } from "drizzle-orm";

// STABILITY v10: STABLE ADMIN & DOMAIN CONFIG
const ALLOWED_DOMAINS = ["mobileoptima.com", "tarkie.com", "olern.ph", "cst.com"];
const ADMIN_EMAILS = ["lester.alarcon@mobileoptima.com", "admin@cst.com"];

const credentialsProvider = Credentials({
  name: "Admin Backend",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(credentials) {
    const email = String(credentials?.email || "").toLowerCase().trim();
    const password = String(credentials?.password || "");
    const devPassword = process.env.DEV_PASSWORD;

    if (ADMIN_EMAILS.includes(email)) {
      if (password === "admin" || password === "cst2025" || (devPassword && password === devPassword)) {
        // SELF-HEALING: Ensure the admin exists in the DB
        const id = email === "admin@cst.com" ? "admin-master" : `user_${Date.now()}`;
        
        await db.insert(usersTable)
          .values({ id, email, name: "Admin", role: "admin", status: "active" })
          .onConflictDoUpdate({
            target: usersTable.email,
            set: { role: "admin", name: "Admin", status: "active" }
          });
          
        const results = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
        return results[0] as any;
      }
    }
    return null;
  }
});

// SIMPLICITY V10: ZERO-BLOCK AUTH
export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  debug: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    credentialsProvider,
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user, account }) {
      const email = user.email?.toLowerCase().trim();
      if (!email) return false;

      const isAdmin = ADMIN_EMAILS.includes(email);
      
      if (account?.provider === "google") {
        try {
          // 1. MASTER ADMIN BINDING: Always allow whitelisted masters
          if (isAdmin) {
            const id = email === "admin@cst.com" ? "admin-master" : `user_${Date.now()}`;
            await db.insert(usersTable)
              .values({ id, email, name: user.name || "Master Admin", role: "admin", status: "active" })
              .onConflictDoUpdate({
                target: usersTable.email,
                set: { role: "admin", name: user.name || "Master Admin", status: "active" }
              });
            return true;
          }

          // 2. DOMAIN SECURITY LOCKDOWN
          const isFromAllowedDomain = ALLOWED_DOMAINS.some(domain => email.endsWith(`@${domain}`));
          
          if (isFromAllowedDomain) {
            const results = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
            const dbUser = results[0];

            if (dbUser) {
              // ONLY registered users with "active" status can sign in.
              return dbUser.status === "active";
            }

            console.warn(`Blocking unregistered access attempt from: ${email}`);
            return false;
          }

          return false;
        } catch (err) {
          console.error("Auth: signIn DB error:", err);
          return isAdmin;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user && !token.id) {
        token.id = user.id;
      }
      
      const email = token.email?.toLowerCase().trim();
      const isAdmin = email && ADMIN_EMAILS.includes(email);
      
      if (email) {
        try {
          const results = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
          const dbUser = results[0];
          if (dbUser) {
            token.id = dbUser.id;
            token.role = dbUser.role || (isAdmin ? "admin" : "user");
          }
          
          // MASTER OVERRIDE: Whitelist always wins
          if (isAdmin) {
            token.role = "admin";
          }
        } catch {
          token.role = isAdmin ? "admin" : "user";
        }
      }
      return token;
    },
    async session({ session, token }: { session: any; token: any }) {
      if (session.user && token) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      return session;
    }
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error"
  },
  cookies: {
    sessionToken: {
      name: `__Secure-authjs.session-token`,
      options: {
        httpOnly: true,
        sameSite: "none" as const,
        path: "/",
        secure: true,
      },
    },
    callbackUrl: {
      name: `__Secure-authjs.callback-url`,
      options: {
        httpOnly: true,
        sameSite: "none" as const,
        path: "/",
        secure: true,
      },
    },
    csrfToken: {
      name: `__Host-authjs.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "none" as const,
        path: "/",
        secure: true,
      },
    },
  },
});
