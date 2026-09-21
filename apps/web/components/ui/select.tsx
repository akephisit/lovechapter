import type { SelectHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-11 w-full rounded-xl border border-[#d8c7bd] bg-white/80 px-3.5 py-2 text-base text-[#382a2d] shadow-sm transition outline-none focus:border-[#8d5363] focus:ring-2 focus:ring-[#8d5363]/15",
        className,
      )}
      {...props}
    />
  );
}
