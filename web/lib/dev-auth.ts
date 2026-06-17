export function isDevAuthBypassEnabled() {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true" &&
    !!process.env.NEXT_PUBLIC_GRIMOIRE_USER_ID
  );
}

// When bypass is on, API calls impersonate this user instead of the browser session.
export function devAuthUserId(): string | null {
  if (!isDevAuthBypassEnabled()) return null;
  return process.env.NEXT_PUBLIC_GRIMOIRE_USER_ID ?? null;
}
