"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface LibraryContextValue {
  query: string;
  setQuery: (q: string) => void;
  category: string | null;
  setCategory: (c: string | null) => void;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  return (
    <LibraryContext.Provider value={{ query, setQuery, category, setCategory }}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibraryFilters() {
  const ctx = useContext(LibraryContext);
  if (!ctx) {
    throw new Error("useLibraryFilters must be used within LibraryProvider");
  }
  return ctx;
}
