"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";

// Routes that render standalone, without the sidebar/chat app shell.
const BARE_ROUTES = new Set(["/login", "/signup", "/share-handler"]);

export function AuthAwareShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (BARE_ROUTES.has(pathname)) return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
