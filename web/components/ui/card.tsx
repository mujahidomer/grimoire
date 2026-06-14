import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="card-shell">
      <div className={cn("card-surface transition-colors duration-eco", className)} {...props}>
        {children}
      </div>
    </div>
  );
}
