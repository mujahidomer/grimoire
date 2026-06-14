import type { Metadata, Viewport } from "next";
import { Gloock, Inter, Noto_Naskh_Arabic } from "next/font/google";
import { AuthAwareShell } from "@/components/auth-aware-shell";
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

const notoNaskhArabic = Noto_Naskh_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
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
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${gloock.variable} ${inter.variable} ${notoNaskhArabic.variable}`}>
      <body className={`${gloock.variable} ${inter.variable} ${notoNaskhArabic.variable}`}>
        <AuthAwareShell>{children}</AuthAwareShell>
      </body>
    </html>
  );
}
