import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "./ui/card";

export function AuthFormShell({
  title,
  description,
  children,
  alternate,
}: {
  title: string;
  description: string;
  children: ReactNode;
  alternate?: { href: string; label: string };
}) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10 sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(210,169,151,0.24),transparent_32%),radial-gradient(circle_at_85%_80%,rgba(113,56,75,0.12),transparent_34%)]" />
      <Card
        className="relative w-full max-w-md min-w-0 overflow-hidden p-6 sm:p-8"
        dir="auto"
      >
        <div className="mb-7 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold tracking-[0.18em] text-[#71384b] uppercase"
          >
            <span aria-hidden="true">✦</span>
            LoveChapter
          </Link>
          <h1 className="mt-5 font-serif text-3xl font-semibold text-[#432f35] sm:text-4xl">
            {title}
          </h1>
          <p className="mx-auto mt-3 max-w-sm leading-7 break-words text-[#725f62]">
            {description}
          </p>
        </div>
        {children}
        {alternate ? (
          <p className="mt-6 text-center text-sm leading-6 text-[#725f62]">
            <Link
              href={alternate.href}
              className="font-semibold text-[#71384b] underline decoration-[#caa9a1] underline-offset-4 hover:text-[#5b2b3b]"
            >
              {alternate.label}
            </Link>
          </p>
        ) : null}
      </Card>
    </main>
  );
}
