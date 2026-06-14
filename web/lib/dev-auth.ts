export function isDevAuthBypassEnabled() {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true" &&
    !!process.env.NEXT_PUBLIC_GRIMOIRE_USER_ID
  );
}
