import type { HTMLAttributes } from "react";

import { cn } from "../../lib/utils";

export function Badge({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-[#eee0d8] px-2.5 py-1 text-xs font-semibold text-[#6b4350]",
        className,
      )}
      {...props}
    />
  );
}
