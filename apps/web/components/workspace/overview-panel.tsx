"use client";

import type {
  PlanningOverview,
  RsvpSummary,
  WeddingSummary,
} from "@lovechapter/contracts";
import {
  ArrowUpRight,
  CalendarDays,
  ClipboardCheck,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useUiCopy } from "../ui-language-provider";
import { formatWeddingDate } from "../../lib/format-wedding-date";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import type { WorkspaceSection } from "./workspace-navigation";

type OverviewApi = {
  getPlanningOverview(weddingId: string): Promise<PlanningOverview>;
  getRsvpSummary(weddingId: string): Promise<RsvpSummary>;
};

export function OverviewPanel({
  wedding,
  api,
  onNavigate,
}: {
  wedding: WeddingSummary;
  api: OverviewApi;
  onNavigate(section: WorkspaceSection): void;
}) {
  const copy = useUiCopy();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; planning: PlanningOverview; rsvp: RsvpSummary }
  >({ status: "loading" });

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    void Promise.all([
      api.getPlanningOverview(wedding.id),
      api.getRsvpSummary(wedding.id),
    ])
      .then(([planning, rsvp]) => {
        if (current) setState({ status: "ready", planning, rsvp });
      })
      .catch(() => {
        if (current) setState({ status: "error" });
      });
    return () => {
      current = false;
    };
  }, [api, wedding.id, retry]);

  const weddingDate = wedding.weddingDate
    ? formatWeddingDate(wedding.weddingDate, wedding.locale)
    : copy.workspace.datePending;

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-[var(--rose-border)] bg-[var(--rose-soft)] p-6 sm:p-8">
        <h2 className="font-serif text-2xl font-semibold text-[var(--rose-ink)] sm:text-3xl">
          {copy.overview.title}
        </h2>
        <p className="mt-2 text-sm text-[var(--rose-ink)]">
          {copy.overview.description}
        </p>
        <p className="mt-4 flex items-center gap-2 text-sm text-[var(--rose-ink)]">
          <CalendarDays
            aria-hidden="true"
            className="size-4 text-[var(--rose-plum)]"
          />
          {weddingDate} · {wedding.timeZone}
        </p>
      </Card>
      {state.status === "loading" ? (
        <Card
          aria-live="polite"
          className="min-h-40 p-6 text-[var(--rose-ink)]"
        >
          {copy.overview.loading}
        </Card>
      ) : state.status === "error" ? (
        <Card
          role="alert"
          className="space-y-4 border-[var(--rose-border)] p-6 text-[var(--rose-ink)]"
        >
          <p>{copy.overview.error}</p>
          <Button onClick={() => setRetry((value) => value + 1)}>
            {copy.overview.retry}
          </Button>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="flex min-h-64 flex-col border-[var(--rose-border)] p-6 transition-transform duration-200 hover:-translate-y-0.5">
            <ClipboardCheck
              aria-hidden="true"
              className="size-6 text-[var(--rose-plum)]"
            />
            <h3 className="mt-4 font-serif text-xl font-semibold text-[var(--rose-ink)]">
              {copy.overview.planningTitle}
            </h3>
            <p className="mt-2 text-sm text-[var(--rose-ink)]">
              {copy.overview.planningCount(
                state.planning.completed,
                state.planning.total,
              )}
            </p>
            {state.planning.total > 0 ? (
              <progress
                className="mt-3 h-2 w-full accent-[var(--rose-plum)]"
                value={state.planning.completed}
                max={state.planning.total}
                aria-label={copy.overview.planningTitle}
              />
            ) : (
              <p className="mt-3 text-sm text-[var(--rose-ink)]">
                {copy.overview.noTasks}
              </p>
            )}
            <Button
              className="mt-auto self-start"
              variant="ghost"
              onClick={() => onNavigate("planning")}
            >
              {copy.overview.openPlanning}
              <ArrowUpRight aria-hidden="true" className="ml-2 size-4" />
            </Button>
          </Card>
          <Card className="flex min-h-64 flex-col border-[var(--rose-border)] p-6 transition-transform duration-200 hover:-translate-y-0.5">
            <UsersRound
              aria-hidden="true"
              className="size-6 text-[var(--rose-plum)]"
            />
            <h3 className="mt-4 font-serif text-xl font-semibold text-[var(--rose-ink)]">
              {copy.overview.rsvpTitle}
            </h3>
            <p className="mt-2 text-lg font-semibold text-[var(--rose-ink)]">
              {copy.overview.guestParties(state.rsvp.totalActive)}
            </p>
            {state.rsvp.totalActive === 0 ? (
              <p className="mt-3 text-sm text-[var(--rose-ink)]">
                {copy.overview.noGuests}
              </p>
            ) : (
              <ul className="mt-3 space-y-1 text-sm text-[var(--rose-ink)]">
                <li>{copy.overview.attending(state.rsvp.attending)}</li>
                <li>{copy.overview.declined(state.rsvp.declined)}</li>
                <li>{copy.overview.awaiting(state.rsvp.awaiting)}</li>
              </ul>
            )}
            <Button
              className="mt-auto self-start"
              variant="ghost"
              onClick={() => onNavigate("guests")}
            >
              {copy.overview.openGuests}
              <ArrowUpRight aria-hidden="true" className="ml-2 size-4" />
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
