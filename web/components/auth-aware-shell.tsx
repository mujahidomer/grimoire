"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ItemPreviewProvider } from "@/lib/item-preview-context";
import { OnboardingProvider } from "@/lib/onboarding";

// Routes that render standalone, without the sidebar/chat app shell.
const BARE_ROUTES = new Set([
  "/login",
  "/signup",
  "/share-handler",
  "/landing",
  "/seed-picker",
  "/onboarding/shortcut",
  // Full-screen chat renders its own standalone shell (sidebar + header).
  "/chat",
]);

export function AuthAwareShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <OnboardingProvider>
      <ItemPreviewProvider>
        {BARE_ROUTES.has(pathname) ? children : <AppShell>{children}</AppShell>}
      </ItemPreviewProvider>
    </OnboardingProvider>
  );
}
