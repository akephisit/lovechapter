"use client";

import {
  CalendarClock,
  ClipboardList,
  HeartHandshake,
  LayoutDashboard,
  UsersRound,
  Wallet,
} from "lucide-react";

import { useUiCopy } from "../ui-language-provider";

export type WorkspaceSection =
  "overview" | "planning" | "guests" | "budget" | "schedule" | "seating";

const sections = [
  { id: "overview", icon: LayoutDashboard },
  { id: "planning", icon: ClipboardList },
  { id: "guests", icon: UsersRound },
  { id: "budget", icon: Wallet },
  { id: "schedule", icon: CalendarClock },
  { id: "seating", icon: HeartHandshake },
] as const;

export function WorkspaceNavigation({
  active,
  onChange,
}: {
  active: WorkspaceSection;
  onChange(section: WorkspaceSection): void;
}) {
  const copy = useUiCopy().workspaceNavigation;
  return (
    <nav aria-label={copy.label} className="min-w-0">
      <div className="flex gap-2 overflow-x-auto pb-2 lg:sticky lg:top-6 lg:flex-col lg:overflow-visible lg:pb-0">
        {sections.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={active === id}
            onClick={() => onChange(id)}
            className={`inline-flex min-h-11 shrink-0 items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[var(--rose-focus)] focus-visible:outline-none lg:w-full ${
              active === id
                ? "bg-[var(--rose-plum)] text-white shadow-sm"
                : "text-[var(--rose-ink)] hover:bg-[var(--rose-soft)]"
            }`}
          >
            <Icon aria-hidden="true" className="size-4" />
            {copy[id]}
          </button>
        ))}
      </div>
    </nav>
  );
}
