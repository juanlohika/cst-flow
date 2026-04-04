import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "@/components/auth/Providers";
import { ToastProvider } from "@/components/ui/ToastContext";

const inter = Inter({ subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const { db } = await import("@/db");
  const { globalSettings } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  
  let appName = "CST OS";
  try {
    const rows = await db.select({ value: globalSettings.value })
      .from(globalSettings)
      .where(eq(globalSettings.key, "app_name"))
      .limit(1);
    if (rows[0]?.value) appName = rows[0].value;
  } catch {}

  return {
    title: appName,
    description: "AI-powered meeting orchestration platform",
  };
}


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <ToastProvider>
            {children}
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
