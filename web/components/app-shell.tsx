"use client";

import { useCallback, useEffect, useState } from "react";
import { PanelLeft } from "lucide-react";
import { LibraryProvider } from "@/lib/library-context";
import { Sidebar } from "@/components/sidebar";
import { CommandBar } from "@/components/command-bar";
import { ChatPanel } from "@/components/chat-panel";
import { Toaster } from "@/components/toaster";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("chat") === "1") {
      setChatOpen(true);
      window.history.replaceState({}, "", "/");
    }
  }, []);

  const handleAsk = useCallback((question: string) => {
    setChatOpen(true);
    window.dispatchEvent(
      new CustomEvent("grimoire:ask", { detail: { question } }),
    );
  }, []);

  const handleOpenChat = useCallback(() => {
    setChatOpen(true);
  }, []);

  const handleToggleChat = useCallback(() => {
    setChatOpen((open) => !open);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((open) => !open);
  }, []);

  const handleSaved = useCallback(() => {
    window.dispatchEvent(new CustomEvent("grimoire:refresh"));
  }, []);

  return (
    <LibraryProvider>
      <div className="app-shell">
        <Sidebar
          open={sidebarOpen}
          onToggleSidebar={handleToggleSidebar}
          onToggleChat={handleToggleChat}
          chatOpen={chatOpen}
        />
        <div className="app-main">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={handleToggleSidebar}
              className="app-sidebar-show-btn rounded-lg p-2 text-eco-foreground/50 transition-colors hover:bg-black/[0.04] hover:text-eco-foreground"
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
        <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
        <Toaster />
      </div>
    </LibraryProvider>
  );
}
