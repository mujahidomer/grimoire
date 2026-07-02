import Link from "next/link";
import { fetchDashboard } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import type { DashboardCategorySummary, Item } from "@/lib/types";
import { TOP_CATEGORIES } from "@/lib/types";
import { CategoryCard } from "@/components/category-card";
import { DashboardSearchBar } from "@/components/dashboard-search-bar";
import { RecentSaves } from "@/components/activity-feed";

export const dynamic = "force-dynamic";

// All 13 categories at zero — used when the dashboard endpoint 404s or the
// backend is unreachable during rollout, so the grid still renders.
function emptyCategories(): DashboardCategorySummary[] {
  return TOP_CATEGORIES.map((top_category) => ({
    top_category,
    count: 0,
    latest: null,
  }));
}

export default async function HomeDashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let accessToken: string | null = null;
  if (user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    accessToken = session?.access_token ?? null;
  }

  let categories = emptyCategories();
  let recent: Item[] = [];
  try {
    const data = await fetchDashboard(accessToken);
    if (data.categories?.length) categories = data.categories;
    recent = data.recent ?? [];
  } catch {
    // Backend unreachable or endpoint not live yet — render the empty grid
    // quietly rather than crashing the page.
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-col gap-4 lg:mb-8 lg:flex-row lg:items-start lg:justify-between">
        <h1 className="font-display text-[1.625rem] font-normal leading-tight text-eco-heading lg:text-[2rem]">
          Home
        </h1>
        <DashboardSearchBar />
      </div>

      <section className="mb-10">
        <h2 className="mb-4 font-sans text-body-md font-medium text-eco-heading">
          Categories
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((summary) => (
            <CategoryCard key={summary.top_category} summary={summary} />
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <RecentSaves items={recent} limit={8} title="Recently saved" />
      )}

      <footer className="mt-12 flex items-center gap-4 border-t border-eco-border-subtle pt-4">
        <Link
          href="/"
          className="font-sans text-label-md text-eco-foreground/65 transition-colors duration-eco hover:text-eco-heading"
        >
          All items
        </Link>
        <span className="text-eco-foreground/30" aria-hidden>
          ·
        </span>
        <Link
          href="/dashboard"
          className="font-sans text-label-md text-eco-foreground/65 transition-colors duration-eco hover:text-eco-heading"
        >
          Library Digest
        </Link>
      </footer>
    </div>
  );
}
