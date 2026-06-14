import type { Metadata, Viewport } from "next";
import { Gloock, Inter } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const gloock = Gloock({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-gloock",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Grimoire",
  description: "Your saved knowledge, searchable and ask-able.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${gloock.variable} ${inter.variable}`}>
      <body className={`${gloock.variable} ${inter.variable}`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
