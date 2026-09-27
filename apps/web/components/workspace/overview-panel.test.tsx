// @vitest-environment jsdom

import type {
  PlanningOverview,
  RsvpSummary,
  WeddingSummary,
} from "@lovechapter/contracts";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UiLanguageProvider } from "../ui-language-provider";
import { OverviewPanel } from "./overview-panel";

const wedding: WeddingSummary = {
  id: "018f0000-0000-7000-8000-000000000001",
  name: "Mali & Arun",
  weddingDate: "2027-02-14",
  timeZone: "Asia/Bangkok",
  locale: "en",
  role: "owner",
  createdAt: "2026-09-28T00:00:00.000Z",
};
const emptyPlanning: PlanningOverview = {
  total: 0,
  completed: 0,
  upcoming: [],
};
const emptyRsvp: RsvpSummary = {
  totalActive: 0,
  attending: 0,
  declined: 0,
  replied: 0,
  awaiting: 0,
};

describe("OverviewPanel", () => {
  it("shows zero guest parties without inventing a percentage", async () => {
    const api = {
      getPlanningOverview: vi.fn(async () => emptyPlanning),
      getRsvpSummary: vi.fn(async () => emptyRsvp),
    };
    const onNavigate = vi.fn();
    render(
      <UiLanguageProvider language="en">
        <OverviewPanel wedding={wedding} api={api} onNavigate={onNavigate} />
      </UiLanguageProvider>,
    );
    expect(await screen.findByText(/0 guest parties/i)).toBeVisible();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /open guests/i }));
    expect(onNavigate).toHaveBeenCalledWith("guests");
  });

  it("renders true attending, declined, and awaiting party counts in Thai", async () => {
    const api = {
      getPlanningOverview: vi.fn(async () => ({
        total: 5,
        completed: 2,
        upcoming: [],
      })),
      getRsvpSummary: vi.fn(async () => ({
        totalActive: 4,
        attending: 2,
        declined: 1,
        replied: 3,
        awaiting: 1,
      })),
    };
    render(
      <UiLanguageProvider language="th">
        <OverviewPanel wedding={wedding} api={api} onNavigate={vi.fn()} />
      </UiLanguageProvider>,
    );
    expect(await screen.findByText(/4 กลุ่มแขก/)).toBeVisible();
    expect(screen.getByText(/2 จาก 5/)).toBeVisible();
    expect(screen.getByText(/รอคำตอบ.*1/)).toBeVisible();
  });

  it("does not show a late response from a previously selected wedding", async () => {
    let resolveOld!: (value: RsvpSummary) => void;
    const old = new Promise<RsvpSummary>((resolve) => {
      resolveOld = resolve;
    });
    const nextWedding = {
      ...wedding,
      id: crypto.randomUUID(),
      name: "Dao & Lin",
    };
    const api = {
      getPlanningOverview: vi.fn(async () => emptyPlanning),
      getRsvpSummary: vi.fn((id: string) =>
        id === wedding.id
          ? old
          : Promise.resolve({ ...emptyRsvp, totalActive: 1, awaiting: 1 }),
      ),
    };
    const view = (active: WeddingSummary) => (
      <UiLanguageProvider language="en">
        <OverviewPanel wedding={active} api={api} onNavigate={vi.fn()} />
      </UiLanguageProvider>
    );
    const { rerender } = render(view(wedding));
    rerender(view(nextWedding));
    expect(await screen.findByText(/1 guest party/)).toBeVisible();
    await act(async () => {
      resolveOld({ ...emptyRsvp, totalActive: 99, awaiting: 99 });
      await old;
    });
    expect(screen.queryByText(/99 guest parties/)).not.toBeInTheDocument();
  });

  it("hides the previous wedding's already-loaded counts immediately on switch", async () => {
    const nextWedding = {
      ...wedding,
      id: crypto.randomUUID(),
      name: "Dao & Lin",
    };
    let resolveNext!: (value: RsvpSummary) => void;
    const next = new Promise<RsvpSummary>((resolve) => {
      resolveNext = resolve;
    });
    const api = {
      getPlanningOverview: vi.fn(async () => emptyPlanning),
      getRsvpSummary: vi.fn((id: string) =>
        id === wedding.id
          ? Promise.resolve({ ...emptyRsvp, totalActive: 99, awaiting: 99 })
          : next,
      ),
    };
    const view = (active: WeddingSummary) => (
      <UiLanguageProvider language="en">
        <OverviewPanel wedding={active} api={api} onNavigate={vi.fn()} />
      </UiLanguageProvider>
    );
    const { rerender } = render(view(wedding));
    expect(await screen.findByText(/99 guest parties/)).toBeVisible();
    rerender(view(nextWedding));
    expect(screen.queryByText(/99 guest parties/)).not.toBeInTheDocument();
    await act(async () => {
      resolveNext(emptyRsvp);
      await next;
    });
    expect(await screen.findByText(/0 guest parties/)).toBeVisible();
  });

  it("shows a retryable error instead of empty counts when a summary fails", async () => {
    const getRsvpSummary = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(emptyRsvp);
    const api = {
      getPlanningOverview: vi.fn(async () => emptyPlanning),
      getRsvpSummary,
    };
    render(
      <UiLanguageProvider language="en">
        <OverviewPanel wedding={wedding} api={api} onNavigate={vi.fn()} />
      </UiLanguageProvider>,
    );
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText(/0 guest parties/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText(/0 guest parties/)).toBeVisible();
    expect(getRsvpSummary).toHaveBeenCalledTimes(2);
  });
});
