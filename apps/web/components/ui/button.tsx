import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold tracking-wide transition duration-200 focus-visible:ring-2 focus-visible:ring-[#7d4152] focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "bg-[#71384b] text-white shadow-[0_8px_24px_rgba(113,56,75,0.2)] hover:bg-[#5b2b3b]",
        variant === "secondary" &&
          "border border-[#d7beb5] bg-[#fffaf3] text-[#5b2b3b] hover:border-[#b78379] hover:bg-white",
        variant === "ghost" && "text-[#71384b] hover:bg-[#f3e8e2]",
        className,
      )}
      {...props}
    />
  );
}
