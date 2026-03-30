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

    if (email === "admin@cst.com") {
      if (password === "admin" || password === "cst2025" || (devPassword && password === devPassword)) {
        // FIXED: Reverting to hardcoded ID to bypass ALL DB issues for this master account
        return { 
          id: "dev-admin-master", 
          name: "Admin", 
          email: "admin@cst.com", 
          role: "admin" 
        } as any;
      }
    } else if (isDomainAllowed(email) && devPassword && password === devPassword) {
      const existing = await prisma.user.findUnique({ where: { email } });
      return { 
        id: existing?.id || email, 
        name: email.split("@")[0], 
        email, 
        role: ADMIN_EMAILS.includes(email) ? "admin" : "user"
      } as any;
    }

    return null;
  },
});

if (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET) {
  console.warn("⚠️ AUTH_GOOGLE_ID or AUTH_GOOGLE_SECRET is MISSING in environment variables.");
}

const googleProvider = Google({
  clientId: process.env.AUTH_GOOGLE_ID,
  clientSecret: process.env.AUTH_GOOGLE_SECRET,
  allowDangerousEmailAccountLinking: true,
});

// FORCE TRUST: NextAuth v5 requires AUTH_TRUST_HOST=true in environments with proxies like Firebase.
if (!process.env.AUTH_TRUST_HOST) {
  process.env.AUTH_TRUST_HOST = "true";
}

if (process.env.AUTH_URL) {
  console.log("✅ AUTH_URL detected:", process.env.AUTH_URL);
}

const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  providers: [
    googleProvider,
    credentialsProvider,
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user, account }) {
      const email = (user.email || "").toLowerCase().trim();
      const isAdmin = ADMIN_EMAILS.includes(email);

      if (account?.provider === "google") {
        if (!isAdmin && !isDomainAllowed(email)) {
          return "/auth/signin?error=domain";
        }
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
  pages: { 
    signIn: "/auth/signin",
    error: "/auth/error"
   },
});

export { handlers, signIn, signOut, auth };

