"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { LibraryProvider } from "@/lib/library-context";
import { Sidebar } from "@/components/sidebar";
import { CommandBar } from "@/components/command-bar";
import { ChatPanel } from "@/components/chat-panel";
import { Toaster } from "@/components/toaster";
import { isDevAuthBypassEnabled } from "@/lib/dev-auth";

const DESKTOP_MQ = "(min-width: 1024px)";

function isDesktopViewport() {
  return window.matchMedia(DESKTOP_MQ).matches;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    document.documentElement.classList.add("app-layout");
    return () => document.documentElement.classList.remove("app-layout");
  }, []);

  useEffect(() => {
    if (!isDesktopViewport()) setSidebarOpen(false);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const onChange = () => {
      if (!mq.matches) setSidebarOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("chat") === "1") {
      setChatOpen(true);
      window.history.replaceState({}, "", "/");
    }
  }, []);

  useEffect(() => {
    function onOpenChat() {
      setChatOpen(true);
      if (!isDesktopViewport()) setSidebarOpen(false);
    }
    window.addEventListener("grimoire:open-chat", onOpenChat);
    return () => window.removeEventListener("grimoire:open-chat", onOpenChat);
  }, []);

  useEffect(() => {
    if (isDesktopViewport() || (!sidebarOpen && !chatOpen)) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sidebarOpen, chatOpen]);

  const handleAsk = useCallback((question: string) => {
    setChatOpen(true);
    if (!isDesktopViewport()) setSidebarOpen(false);
    window.dispatchEvent(
      new CustomEvent("grimoire:ask", { detail: { question } }),
    );
  }, []);

  const handleOpenChat = useCallback(() => {
    setChatOpen(true);
    if (!isDesktopViewport()) setSidebarOpen(false);
  }, []);

  const handleToggleChat = useCallback(() => {
    setChatOpen((open) => {
      if (!open && !isDesktopViewport()) setSidebarOpen(false);
      return !open;
    });
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      if (!open && !isDesktopViewport()) setChatOpen(false);
      return !open;
    });
  }, []);

  const handleSidebarNavigate = useCallback(() => {
    if (!isDesktopViewport()) setSidebarOpen(false);
  }, []);

  const handleCloseChat = useCallback(() => {
    setChatOpen(false);
  }, []);

  const handleSaved = useCallback((detail?: { savedIds?: string[] }) => {
    window.dispatchEvent(new CustomEvent("grimoire:refresh", { detail }));
  }, []);

  return (
    <LibraryProvider>
      <div className="app-shell">
        {isDevAuthBypassEnabled() && (
          <p className="shrink-0 border-b border-eco-border-subtle bg-eco-hover px-3 py-1 text-center font-sans text-[11px] leading-none text-eco-foreground/75">
            Local dev mode
          </p>
        )}
        <div className="app-shell-body">
        {sidebarOpen && (
          <div
            className="app-overlay-backdrop"
            onClick={handleToggleSidebar}
            aria-hidden
          />
        )}
        {chatOpen && (
          <div
            className="app-overlay-backdrop"
            onClick={handleCloseChat}
            aria-hidden
          />
        )}

        <Sidebar
          open={sidebarOpen}
          onToggleSidebar={handleToggleSidebar}
          onToggleChat={handleToggleChat}
          onNavigate={handleSidebarNavigate}
          chatOpen={chatOpen}
        />

        <div className="app-main">
          <header className="flex shrink-0 items-center justify-between border-b border-eco-border-subtle bg-eco-main px-3 py-2.5 lg:hidden">
              <button
                type="button"
                onClick={handleToggleSidebar}
                className="rounded-lg p-2 text-eco-foreground/65 transition-colors hover:bg-eco-hover-strong hover:text-eco-foreground"
                aria-label={sidebarOpen ? "Close menu" : "Open menu"}
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              <span className="font-display text-base font-normal text-eco-heading">
                Grimoire
              </span>
              <button
                type="button"
                onClick={handleToggleChat}
                className={cn(
                  "rounded-lg p-2 transition-colors hover:bg-eco-hover-strong",
                  chatOpen
                    ? "text-eco-primary"
                    : "text-eco-foreground/65 hover:text-eco-foreground",
                )}
                aria-label={chatOpen ? "Close chat" : "Open chat"}
              >
                <MessageCircle className="h-4 w-4" />
              </button>
            </header>

          {!sidebarOpen && (
            <button
              type="button"
              onClick={handleToggleSidebar}
              className="app-sidebar-show-btn hidden rounded-lg p-2 text-eco-foreground/65 transition-colors hover:bg-eco-hover-strong hover:text-eco-foreground lg:block"
              aria-label="Show sidebar"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}

          <main className="app-main-scroll scrollbar-thin">{children}</main>
          <CommandBar
            onAsk={handleAsk}
            onOpenChat={handleOpenChat}
            onSaved={handleSaved}
          />
        </div>

        <ChatPanel open={chatOpen} onClose={handleCloseChat} />
        </div>
        <Toaster />
      </div>
    </LibraryProvider>
  );
}
