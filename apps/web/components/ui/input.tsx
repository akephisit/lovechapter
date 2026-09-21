import type { InputHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-xl border border-[#d8c7bd] bg-white/80 px-3.5 py-2 text-base text-[#382a2d] shadow-sm transition outline-none placeholder:text-[#9b8886] focus:border-[#8d5363] focus:ring-2 focus:ring-[#8d5363]/15",
        className,
      )}
      {...props}
    />
  );
}
