// @vitest-environment jsdom

import type { PlanningTask } from "@lovechapter/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PlanningWorkspace,
  type PlanningWorkspaceApi,
} from "./planning-workspace";

afterEach(() => vi.restoreAllMocks());

const wedding = { id: "first", name: "First", timeZone: "UTC", locale: "en" };
const task: PlanningTask = {
  id: "task",
  title: "Book venue",
  category: "Venue",
  note: null,
  dueDate: "2026-12-01",
  completedAt: null,
  createdAt: "2026-09-23T10:00:00.000Z",
  updatedAt: "2026-09-23T10:00:00.000Z",
};

describe("PlanningWorkspace", () => {
  it("loads real totals, creates, edits, completes and confirms removal", async () => {
    let tasks = [task];
    const api: PlanningWorkspaceApi = {
      listPlanningTasks: vi.fn(async () => ({
        items: tasks,
        nextCursor: null,
      })),
      getPlanningOverview: vi.fn(async () => ({
        total: tasks.length,
        completed: tasks.filter((t) => t.completedAt).length,
        upcoming: tasks.filter((t) => !t.completedAt && t.dueDate),
      })),
      createPlanningTask: vi.fn(async (_w, input) => {
        const created = {
          ...task,
          ...input,
          id: "new",
          category: input.category ?? null,
          dueDate: input.dueDate ?? null,
          note: input.note ?? null,
        };
        tasks = [created, ...tasks];
        return created;
      }),
      updatePlanningTask: vi.fn(async (_w, id, input) => {
        tasks = tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                ...input,
                completedAt:
                  input.completed === undefined
                    ? t.completedAt
                    : input.completed
                      ? "2026-09-23T11:00:00.000Z"
                      : null,
              }
            : t,
        );
        return tasks.find((t) => t.id === id)!;
      }),
      deletePlanningTask: vi.fn(async (_w, id) => {
        tasks = tasks.filter((t) => t.id !== id);
      }),
    };
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PlanningWorkspace wedding={wedding} api={api} />);
    expect((await screen.findAllByText("Book venue"))[0]).toBeVisible();
    expect(screen.getByText(/0 of 1 complete/i)).toBeVisible();
    await user.type(screen.getByLabelText(/task title/i), "Flowers");
    await user.click(screen.getByRole("button", { name: /add task/i }));
    expect(await screen.findByText("Flowers")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /edit book venue/i }));
    await user.clear(screen.getByLabelText(/task title/i));
    await user.type(screen.getByLabelText(/task title/i), "Choose venue");
    await user.click(screen.getByRole("button", { name: /save task/i }));
    expect((await screen.findAllByText("Choose venue"))[0]).toBeVisible();
    expect(api.updatePlanningTask).toHaveBeenCalledWith("first", "task", {
      title: "Choose venue",
    });
    await user.click(
      screen.getByRole("button", { name: /complete choose venue/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/1 of 2 complete/i)).toBeVisible(),
    );
    await user.click(
      screen.getByRole("button", { name: /delete choose venue/i }),
    );
    expect(api.deletePlanningTask).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(
      screen.getByRole("button", { name: /delete choose venue/i }),
    );
    await waitFor(() => expect(screen.queryByText("Choose venue")).toBeNull());
  });

  it("does not render prior wedding tasks when its requests settle after switching", async () => {
    let finish!: (value: { items: PlanningTask[]; nextCursor: null }) => void;
    const pending = new Promise<{ items: PlanningTask[]; nextCursor: null }>(
      (resolve) => {
        finish = resolve;
      },
    );
    const api: PlanningWorkspaceApi = {
      listPlanningTasks: vi.fn(async (id) =>
        id === "first" ? pending : { items: [], nextCursor: null },
      ),
      getPlanningOverview: vi.fn(async () => ({
        total: 0,
        completed: 0,
        upcoming: [],
      })),
      createPlanningTask: vi.fn(),
      updatePlanningTask: vi.fn(),
      deletePlanningTask: vi.fn(),
    };
    const { rerender } = render(
      <PlanningWorkspace key="first" wedding={wedding} api={api} />,
    );
    rerender(
      <PlanningWorkspace
        key="second"
        wedding={{ ...wedding, id: "second", name: "Second" }}
        api={api}
      />,
    );
    finish({ items: [task], nextCursor: null });
    expect(await screen.findByText(/no tasks yet/i)).toBeVisible();
    expect(screen.queryByText("Book venue")).toBeNull();
  });
});
