import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "@/components/auth/Providers";
import { ToastProvider } from "@/components/ui/ToastContext";

const inter = Inter({ subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const { prisma } = await import("@/lib/prisma");
  let appName = "Tarkie CST FlowDesk";
  try {
    const setting = await (prisma as any).globalSetting.findUnique({ where: { key: "app_name" } });
    if (setting?.value) appName = setting.value;
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
