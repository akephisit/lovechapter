// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  OperationsWorkspace,
  type OperationsWorkspaceApi,
} from "./operations-workspace";

const wedding = {
  id: "wed",
  name: "Wedding",
  timeZone: "Asia/Bangkok",
  locale: "th-TH",
};

function fixture() {
  const api = {
    getBudgetOverview: vi.fn(async () => ({
      budget: null,
      plannedMinor: 0,
      paidMinor: 0,
      remainingMinor: 0,
    })),
    setBudget: vi.fn(async (_w: string, input: unknown) => input),
    listBudgetCategories: vi.fn(async () => []),
    saveBudgetCategory: vi.fn(async () => ({ id: "category", name: "Venue" })),
    deleteBudgetCategory: vi.fn(async () => {}),
    listVendors: vi.fn(async () => ({ items: [], nextCursor: null })),
    saveVendor: vi.fn(async () => ({ id: "vendor", name: "Studio" })),
    deleteVendor: vi.fn(async () => {}),
    listExpenses: vi.fn(async () => ({ items: [], nextCursor: null })),
    saveExpense: vi.fn(async () => ({ id: "expense" })),
    deleteExpense: vi.fn(async () => {}),
    listRunSheet: vi.fn(async () => ({ items: [], nextCursor: null })),
    saveRunSheetItem: vi.fn(async () => ({ id: "item" })),
    deleteRunSheetItem: vi.fn(async () => {}),
    listSeatingTables: vi.fn(async () => []),
    saveSeatingTable: vi.fn(async () => ({
      id: "table",
      name: "A",
      capacity: 8,
      reserved: 0,
    })),
    deleteSeatingTable: vi.fn(async () => {}),
    listSeatingAssignments: vi.fn(async () => []),
    assignSeating: vi.fn(async () => {}),
    listGuests: vi.fn(async () => ({ items: [], nextCursor: null })),
  } as unknown as OperationsWorkspaceApi;
  return api;
}

describe("OperationsWorkspace", () => {
  it("keeps a linked vendor when editing an expense before loading that vendor's page", async () => {
    const api = fixture();
    const vendorId = "vendor-on-later-page";
    vi.mocked(api.getBudgetOverview).mockResolvedValue({
      budget: { currency: "THB", targetMinor: 50000 },
      plannedMinor: 10000,
      paidMinor: 0,
      remainingMinor: 40000,
    });
    vi.mocked(api.listExpenses).mockResolvedValue({
      items: [
        {
          id: "expense",
          title: "Flowers",
          plannedMinor: 10000,
          paidMinor: 0,
          categoryId: null,
          vendorId,
          dueDate: null,
          note: null,
        } as never,
      ],
      nextCursor: null,
    });
    const user = userEvent.setup();
    render(<OperationsWorkspace api={api} wedding={wedding} />);
    await user.click(
      await screen.findByRole("button", { name: "Edit Flowers" }),
    );
    await user.click(screen.getByRole("button", { name: "Save expense" }));
    await waitFor(() =>
      expect(api.saveExpense).toHaveBeenCalledWith(
        "wed",
        "expense",
        expect.objectContaining({ vendorId }),
      ),
    );
  });
  it("records a cost and assigns an active guest party to a table", async () => {
    const api = fixture();
    vi.mocked(api.getBudgetOverview).mockResolvedValue({
      budget: { currency: "USD", targetMinor: 50000 },
      plannedMinor: 0,
      paidMinor: 0,
      remainingMinor: 0,
    });
    vi.mocked(api.listSeatingTables).mockResolvedValue([
      { id: "table", name: "A", capacity: 8, reserved: 0 },
    ]);
    vi.mocked(api.listGuests).mockResolvedValue({
      items: [{ id: "guest", name: "Mali", allowedPartySize: 2 } as never],
      nextCursor: null,
    });
    const user = userEvent.setup();
    render(<OperationsWorkspace api={api} wedding={wedding} />);
    await user.type(await screen.findByLabelText("Expense title"), "Flowers");
    await user.type(screen.getByLabelText("Planned amount"), "100.50");
    await user.click(screen.getByRole("button", { name: "Add expense" }));
    await waitFor(() =>
      expect(api.saveExpense).toHaveBeenCalledWith(
        "wed",
        null,
        expect.objectContaining({
          title: "Flowers",
          plannedMinor: 10050,
          paidMinor: 0,
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Seating" }));
    await screen.findByRole("button", { name: "A · 0/8" });
    expect(screen.getByText("8 seats remaining at this table")).toBeVisible();
    await user.type(screen.getByLabelText("Find a guest party"), "Mali");
    await user.click(screen.getByRole("button", { name: "Search guests" }));
    await user.click(
      await screen.findByRole("button", { name: "Assign Mali" }),
    );
    await waitFor(() =>
      expect(api.assignSeating).toHaveBeenCalledWith("wed", "guest", "table"),
    );
  });
  it("does not offer assignment to a guest who declined", async () => {
    const api = fixture();
    vi.mocked(api.listSeatingTables).mockResolvedValue([
      { id: "table", name: "A", capacity: 8, reserved: 0 },
    ]);
    vi.mocked(api.listGuests).mockResolvedValue({
      items: [
        {
          id: "guest",
          name: "Mali",
          allowedPartySize: 2,
          rsvp: { attendance: "declined", partySize: 0 },
        } as never,
      ],
      nextCursor: null,
    });
    const user = userEvent.setup();
    render(<OperationsWorkspace api={api} wedding={wedding} />);
    await user.click(screen.getByRole("button", { name: "Seating" }));
    await screen.findByRole("button", { name: "A · 0/8" });
    await user.click(screen.getByRole("button", { name: "Search guests" }));
    expect(
      await screen.findByRole("button", { name: "Declined" }),
    ).toBeDisabled();
  });
  it("creates a budget, vendor, schedule item and table for the selected wedding", async () => {
    const api = fixture();
    const user = userEvent.setup();
    render(<OperationsWorkspace api={api} wedding={wedding} />);
    expect(
      await screen.findByRole("heading", { name: "Budget & vendors" }),
    ).toBeVisible();
    await user.type(screen.getByLabelText("Currency code"), "THB");
    await user.type(screen.getByLabelText("Budget target"), "1000");
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    await waitFor(() =>
      expect(api.setBudget).toHaveBeenCalledWith("wed", {
        currency: "THB",
        targetMinor: 100000,
      }),
    );
    await user.type(screen.getByLabelText("Vendor name"), "Studio");
    await user.click(screen.getByRole("button", { name: "Add vendor" }));
    await waitFor(() =>
      expect(api.saveVendor).toHaveBeenCalledWith(
        "wed",
        null,
        expect.objectContaining({ name: "Studio" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Day schedule" }));
    await user.type(screen.getByLabelText("Schedule title"), "Ceremony");
    await user.type(
      screen.getByLabelText("Start (wedding time)"),
      "2026-12-19T09:00",
    );
    await user.type(
      screen.getByLabelText("End (wedding time)"),
      "2026-12-19T10:00",
    );
    await user.click(screen.getByRole("button", { name: "Add schedule item" }));
    await waitFor(() =>
      expect(api.saveRunSheetItem).toHaveBeenCalledWith(
        "wed",
        null,
        expect.objectContaining({ startsAt: "2026-12-19T02:00:00.000Z" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Seating" }));
    await user.type(screen.getByLabelText("Table name"), "A");
    await user.clear(screen.getByLabelText("Table capacity"));
    await user.type(screen.getByLabelText("Table capacity"), "8");
    await user.click(screen.getByRole("button", { name: "Add table" }));
    await waitFor(() =>
      expect(api.saveSeatingTable).toHaveBeenCalledWith("wed", null, {
        name: "A",
        capacity: 8,
      }),
    );
  });
});
