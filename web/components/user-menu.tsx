"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface UserInfo {
  email?: string;
  name: string;
  initial: string;
  avatarUrl?: string;
}

function resolveUserInfo(
  user: {
    email?: string;
    user_metadata?: Record<string, unknown>;
  } | null,
): UserInfo {
  if (!user) {
    return { name: "My Grimoire", initial: "G" };
  }

  const metadata = user.user_metadata ?? {};
  const name =
    (typeof metadata.full_name === "string" && metadata.full_name) ||
    (typeof metadata.name === "string" && metadata.name) ||
    user.email?.split("@")[0] ||
    "My Grimoire";
  const avatarUrl =
    typeof metadata.avatar_url === "string" ? metadata.avatar_url : undefined;
  const initial = name.charAt(0).toUpperCase() || "G";

  return { email: user.email, name, initial, avatarUrl };
}

export function UserMenu() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<UserInfo>({
    name: "My Grimoire",
    initial: "G",
  });
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserInfo(resolveUserInfo(user));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserInfo(resolveUserInfo(session?.user ?? null));
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut({ scope: "global" });
      await fetch("/auth/signout", { method: "POST" });
    } catch {
      /* redirect even if one path fails */
    }
    setOpen(false);
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={menuRef} className="relative z-10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-black/[0.03]"
      >
        {userInfo.avatarUrl ? (
          <img
            src={userInfo.avatarUrl}
            alt=""
            className="h-6 w-6 shrink-0 rounded-md object-cover"
          />
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-eco-primary text-xs font-semibold text-white">
            {userInfo.initial}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-sans text-body-md text-eco-on-surface">
          {userInfo.name}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-eco-foreground/40 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-lg border border-eco-border-light bg-eco-surface shadow-eco-sm"
        >
          {userInfo.email && (
            <p className="truncate border-b border-eco-border-light px-3 py-2 font-sans text-label-md text-eco-foreground/50">
              {userInfo.email}
            </p>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex w-full items-center gap-2 px-3 py-2.5 font-sans text-body-md text-eco-foreground transition-colors hover:bg-black/[0.03] disabled:opacity-50"
          >
            <LogOut className="h-4 w-4 opacity-60" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
