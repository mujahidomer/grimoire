"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SearchBox } from "@/components/search-box";
import { useLibraryFilters } from "@/lib/library-context";

// Reuses the existing library search: it just seeds the shared query state
// that the "/" library page already reads, then navigates there so the
// existing filtered fetch takes over. No new search logic.
export function DashboardSearchBar() {
  const router = useRouter();
  const { setQuery, setTopCategory } = useLibraryFilters();
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setTopCategory(null);
    setQuery(trimmed);
    router.push("/");
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-lg">
      <SearchBox value={value} onChange={setValue} className="max-w-none" />
    </form>
  );
}
