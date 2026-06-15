import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingFlow } from "./onboarding-flow";

// Onboarding is auth-gated by middleware. We re-check here so a user who has
// already finished can never re-enter the flow by typing the URL.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/landing");
  if (user.user_metadata?.onboarding_complete === true) redirect("/");

  return <OnboardingFlow />;
}
