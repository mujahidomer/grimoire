import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isDevAuthBypassEnabled } from "@/lib/dev-auth";

function isAuthRoute(pathname: string) {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/auth")
  );
}

// Public marketing/auth surfaces an unauthenticated visitor may render.
function isPublicRoute(pathname: string) {
  return isAuthRoute(pathname) || pathname.startsWith("/landing");
}

export async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Allow public pages to render even when env is misconfigured (avoids 500 loops).
  if (!supabaseUrl || !supabaseAnonKey) {
    if (isPublicRoute(request.nextUrl.pathname)) {
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "missing_supabase_env");
    return NextResponse.redirect(url);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Unauthenticated visitors land on the marketing page, not the login form.
  if (!user && !isPublicRoute(pathname) && !isDevAuthBypassEnabled()) {
    const url = request.nextUrl.clone();
    url.pathname = "/landing";
    // Keep the original target (e.g. the link shared into /share-handler) so the
    // landing → login/signup links can carry it back after authentication.
    url.search = "";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (user) {
    const onboardingDone =
      user.user_metadata?.onboarding_complete === true;
    const dest = onboardingDone ? "/" : "/onboarding";

    // Authenticated users have no business on the marketing/auth surfaces.
    if (
      pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/landing"
    ) {
      const url = request.nextUrl.clone();
      url.pathname = dest;
      url.search = "";
      return NextResponse.redirect(url);
    }

    // Funnel new users through onboarding until they complete it. /auth/* is
    // excluded so the OAuth callback can finish exchanging its code first.
    if (
      !onboardingDone &&
      pathname !== "/onboarding" &&
      !pathname.startsWith("/auth")
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return NextResponse.redirect(url);
    }

    // Finished users shouldn't be able to re-enter onboarding.
    if (onboardingDone && pathname === "/onboarding") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
