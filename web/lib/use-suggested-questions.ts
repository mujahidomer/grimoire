"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchItems } from "@/lib/api";
import { buildSuggestedQuestions } from "@/lib/suggested-questions";

export function useSuggestedQuestions() {
  const [questions, setQuestions] = useState(() => buildSuggestedQuestions([]));

  const refresh = useCallback(async () => {
    try {
      const items = await fetchItems();
      setQuestions(buildSuggestedQuestions(items));
    } catch {
      /* keep the current suggestions */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    function onRefresh() {
      refresh();
    }
    window.addEventListener("grimoire:refresh", onRefresh);
    return () => window.removeEventListener("grimoire:refresh", onRefresh);
  }, [refresh]);

  return questions;
}
