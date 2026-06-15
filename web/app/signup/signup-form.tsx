"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthDivider } from "@/components/auth-divider";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { createClient } from "@/lib/supabase/client";
import { seedLibrary } from "@/lib/api";
import {
  SEGMENTS_STORAGE_KEY,
  SEED_SELECTIONS_STORAGE_KEY,
} from "@/lib/seed-catalog";

function readJsonArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// Carry the pre-auth funnel selections (chosen on /landing + /seed-picker) into
// the new account: stamp onboarding metadata and copy the seed items in. Best
// effort — a failure here must never block the user from reaching their library.
async function applyOnboardingSelections() {
  const segments = readJsonArray(SEGMENTS_STORAGE_KEY);
  const seedSelections = readJsonArray(SEED_SELECTIONS_STORAGE_KEY);

  const supabase = createClient();
  try {
    await supabase.auth.updateUser({
      data: {
        segments,
        onboarding_complete: false,
        getting_started_query_done: false,
        getting_started_save_done: false,
      },
    });
  } catch {
    /* metadata write failed — banner just won't show; library still loads */
  }

  // Fire-and-forget: the backend copies seed items asynchronously.
  void seedLibrary(seedSelections).catch(() => {});

  try {
    localStorage.removeItem(SEGMENTS_STORAGE_KEY);
    localStorage.removeItem(SEED_SELECTIONS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (signUpError) {
      setLoading(false);
      setError(signUpError.message);
      return;
    }

    await applyOnboardingSelections();
    setLoading(false);

    router.push(next);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-eco-main px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="font-display text-2xl text-eco-heading">Grimoire</h1>
          <p className="mt-1 font-sans text-body-md text-eco-foreground/60">
            Create your library
          </p>
        </div>

        <div className="space-y-4 rounded-xl border border-eco-border-light bg-eco-surface p-6 shadow-eco-sm">
          <GoogleAuthButton next={next} />
          <AuthDivider />

          <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="email"
              className="font-sans text-label-md font-medium text-eco-foreground/70"
            >
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="password"
              className="font-sans text-label-md font-medium text-eco-foreground/70"
            >
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>

          {error && (
            <p className="font-sans text-label-md text-red-600">{error}</p>
          )}

          <Button
            type="submit"
            variant="secondary"
            className="w-full"
            disabled={loading}
          >
            {loading ? "Creating account…" : "Create account"}
          </Button>
          </form>
        </div>

        <p className="text-center font-sans text-body-md text-eco-foreground/60">
          Already have an account?{" "}
          <Link
            href={`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="font-medium text-eco-tertiary hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
