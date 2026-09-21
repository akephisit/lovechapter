import type { HTMLAttributes } from "react";

import { cn } from "../../lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[1.5rem] border border-white/80 bg-white/75 shadow-[0_18px_60px_rgba(84,52,55,0.09)] backdrop-blur-sm",
        className,
      )}
      {...props}
    />
  );
}
