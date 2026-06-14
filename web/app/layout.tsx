import type { Metadata } from "next";
import { Rethink_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";

// UI chrome: Rethink Sans (400 regular, 600 semibold).
const rethink = Rethink_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-rethink",
  display: "swap",
});

// Reading content: Source Serif 4 (400 + 400 italic).
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Grimoire",
  description: "Your saved knowledge, searchable and ask-able.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${rethink.variable} ${sourceSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
