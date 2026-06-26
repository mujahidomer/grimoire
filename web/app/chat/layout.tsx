import type { Metadata } from "next";

// /chat is a standalone, full-screen surface. The app shell (nav sidebar + chat
// dock) is already excluded for this route in AuthAwareShell via BARE_ROUTES, so
// this layout simply passes children through — nothing from the app shell is
// inherited here, and the page owns the entire viewport.

export const metadata: Metadata = {
  title: "Chat · Grimoire",
};

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
