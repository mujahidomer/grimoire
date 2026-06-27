"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { prefetchItem } from "@/lib/api";
import { ItemPreviewPanel } from "@/components/item-preview-panel";

interface ItemPreviewContextValue {
  openItemPreview: (itemId: string) => void;
  closeItemPreview: () => void;
}

const ItemPreviewContext = createContext<ItemPreviewContextValue | null>(null);

export function ItemPreviewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);

  const openItemPreview = useCallback((itemId: string) => {
    const id = itemId.trim();
    if (!id) return;
    prefetchItem(id);
    setPreviewItemId(id);
  }, []);

  const closeItemPreview = useCallback(() => {
    setPreviewItemId(null);
  }, []);

  const value = useMemo(
    () => ({ openItemPreview, closeItemPreview }),
    [openItemPreview, closeItemPreview],
  );

  return (
    <ItemPreviewContext.Provider value={value}>
      {children}
      {previewItemId ? (
        <ItemPreviewPanel
          itemId={previewItemId}
          onClose={closeItemPreview}
        />
      ) : null}
    </ItemPreviewContext.Provider>
  );
}

export function useItemPreview(): ItemPreviewContextValue {
  const ctx = useContext(ItemPreviewContext);
  if (!ctx) {
    throw new Error("useItemPreview must be used within ItemPreviewProvider");
  }
  return ctx;
}

export function useOptionalItemPreview(): ItemPreviewContextValue | null {
  return useContext(ItemPreviewContext);
}
