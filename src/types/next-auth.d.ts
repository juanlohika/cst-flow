import NextAuth, { type DefaultSession } from "next-auth";

declare module "next-auth" {
  /**
   * The User object in the DB.
   */
  interface User {
    role?: string;
  }

  /**
   * The Session object used in the FE.
   */
  interface Session {
    user: {
      id: string;
      role?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  /**
   * The JWT token decoded.
   */
  interface JWT {
    id: string;
    role?: string;
  }
}
