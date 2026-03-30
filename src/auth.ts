import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

import { prisma } from "@/lib/prisma";

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
    if (email === "admin@cst.com" && credentials?.password === "cst2025") {
      // SELF-HEALING: Ensure the admin exists in the DB so other APIs don't crash
      const user = await prisma.user.upsert({
        where: { email: "admin@cst.com" },
        update: { name: "Admin" },
        create: { id: "admin-master", name: "Admin", email: "admin@cst.com", role: "admin" }
      });
      return user as any;
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
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role || (ADMIN_EMAILS.includes(user.email || "") ? "admin" : "user");
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    }
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error"
  }
});
