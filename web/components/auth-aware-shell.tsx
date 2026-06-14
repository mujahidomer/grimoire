"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";

const AUTH_ROUTES = new Set(["/login", "/signup"]);

export function AuthAwareShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (AUTH_ROUTES.has(pathname)) return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
