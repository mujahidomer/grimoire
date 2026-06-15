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
  icons: {
    icon: [
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    // Renders <link rel="apple-touch-icon"> so iOS uses our artwork when a
    // user adds Grimoire to the Home Screen.
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
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
