"use client";

import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";

export function DashboardSourceLink({
  itemId,
  label,
  onOpen,
}: {
  itemId: string;
  label: string;
  onOpen?: (itemId: string) => void;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (onOpen) onOpen(itemId);
        else router.push(`/item/${itemId}`);
      }}
      aria-label={label}
      className="inline-flex text-eco-foreground/55 transition-colors duration-eco hover:text-eco-primary"
    >
      <ExternalLink className="h-3.5 w-3.5" />
    </button>
  );
}
