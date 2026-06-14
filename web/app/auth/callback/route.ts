import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function getPublicOrigin(request: Request): string {
  const { origin } = new URL(request.url);
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configuredSiteUrl) return configuredSiteUrl;

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost.split(",")[0]?.trim()}`;
  }

  return origin;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const publicOrigin = getPublicOrigin(request);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${publicOrigin}${next}`);
    }
  }

  return NextResponse.redirect(`${publicOrigin}/login?error=auth_callback_failed`);
}
