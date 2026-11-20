/**
 * Tools Portal session — lets anyone with a company Google account use the
 * CST tools (e.g. PDF Compressor) WITHOUT being a registered CST OS user.
 *
 * Deliberately separate from NextAuth: CST OS sign-in only admits registered,
 * active users and we keep that untouched. The portal runs its own Google
 * OAuth (same OAuth client) and only checks that the Google account is
 * verified and on an allowed domain. The session is a signed, httpOnly cookie
 * (12 hours) holding the email and name.
 *
 * Registered CST OS users who are already signed in are accepted too.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { auth } from "@/auth";

export const PORTAL_COOKIE = "cst_tools_portal";
export const STATE_COOKIE = "cst_tools_portal_state";
export const SESSION_HOURS = 12;

/** Company domains allowed into the portal. Override with TOOLS_PORTAL_DOMAINS="a.com,b.com". */
export function allowedDomains(): string[] {
  const env = process.env.TOOLS_PORTAL_DOMAINS?.trim();
  return (env ? env.split(",") : ["mobileoptima.com", "tarkie.com"]).map((d) => d.trim().toLowerCase()).filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  const e = (email || "").toLowerCase().trim();
  const at = e.lastIndexOf("@");
  if (at < 1) return false;
  return allowedDomains().includes(e.slice(at + 1));
}

function key(): Buffer {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  // Derive a portal-only key so this cookie can never be confused with NextAuth's.
  return createHmac("sha256", secret).update("cst-tools-portal-v1").digest();
}

export interface PortalUser {
  email: string;
  name: string;
  via: "portal" | "cst-os";
}

export function signSession(email: string, name: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ e: email, n: name, x: now + SESSION_HOURS * 3600_000 })).toString("base64url");
  const sig = createHmac("sha256", key()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined, now = Date.now()): { email: string; name: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  let expected: Buffer;
  try {
    expected = createHmac("sha256", key()).update(payload).digest();
  } catch {
    return null;
  }
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data?.e !== "string" || typeof data?.x !== "number" || data.x < now) return null;
    if (!isAllowedEmail(data.e)) return null; // domain list may have changed
    return { email: data.e, name: String(data.n || data.e) };
  } catch {
    return null;
  }
}

/** Portal session first, then a normal CST OS session. */
export async function getPortalUser(): Promise<PortalUser | null> {
  const portal = verifySession(cookies().get(PORTAL_COOKIE)?.value);
  if (portal) return { ...portal, via: "portal" };
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (session?.user?.id && email) return { email, name: session.user.name || email, via: "cst-os" };
  } catch {}
  return null;
}

/** Only allow same-site relative paths after sign-in. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/tools") && !next.startsWith("//") ? next : "/tools/pdf-compressor";
}
