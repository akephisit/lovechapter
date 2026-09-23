"use client";

import type {
  CreatePlanningTaskInput,
  Page,
  PlanningOverview,
  PlanningTask,
  PlanningTaskFilter,
  UpdatePlanningTaskInput,
} from "@lovechapter/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";

export interface PlanningWorkspaceApi {
  listPlanningTasks(
    weddingId: string,
    options?: { filter?: PlanningTaskFilter; cursor?: string },
  ): Promise<Page<PlanningTask>>;
  getPlanningOverview(weddingId: string): Promise<PlanningOverview>;
  createPlanningTask(
    weddingId: string,
    input: CreatePlanningTaskInput,
  ): Promise<PlanningTask>;
  updatePlanningTask(
    weddingId: string,
    taskId: string,
    input: UpdatePlanningTaskInput,
  ): Promise<PlanningTask>;
  deletePlanningTask(weddingId: string, taskId: string): Promise<void>;
}

type Wedding = { id: string; name: string; locale: string; timeZone: string };
type Props = { wedding: Wedding; api: PlanningWorkspaceApi };

export function PlanningWorkspace({ wedding, api }: Props) {
  const [tasks, setTasks] = useState<PlanningTask[]>([]);
  const [overview, setOverview] = useState<PlanningOverview | null>(null);
  const [filter, setFilter] = useState<PlanningTaskFilter>("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PlanningTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setTasks([]);
    setCursor(null);
    void Promise.all([
      api.listPlanningTasks(wedding.id, { filter }),
      api.getPlanningOverview(wedding.id),
    ])
      .then(([page, summary]) => {
        if (current !== generation.current) return;
        setTasks(page.items);
        setCursor(page.nextCursor);
        setOverview(summary);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (current === generation.current)
          setError(
            readableError(caught, "Could not load the planning checklist."),
          );
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [api, wedding.id, filter, reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const input = {
      title: String(fields.get("title") ?? ""),
      category: String(fields.get("category") ?? ""),
      note: String(fields.get("note") ?? ""),
      dueDate: String(fields.get("dueDate") ?? ""),
    };
    const patch: UpdatePlanningTaskInput = {};
    if (editing) {
      if (input.title !== editing.title) patch.title = input.title;
      if (input.category !== (editing.category ?? ""))
        patch.category = input.category || null;
      if (input.note !== (editing.note ?? "")) patch.note = input.note || null;
      if (input.dueDate !== (editing.dueDate ?? ""))
        patch.dueDate = input.dueDate || null;
      if (!Object.keys(patch).length) {
        setEditing(null);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api.updatePlanningTask(wedding.id, editing.id, patch);
      } else {
        await api.createPlanningTask(wedding.id, {
          title: input.title,
          ...(input.category ? { category: input.category } : {}),
          ...(input.note ? { note: input.note } : {}),
          ...(input.dueDate ? { dueDate: input.dueDate } : {}),
        });
      }
      setEditing(null);
      form.reset();
      setReload((value) => value + 1);
    } catch (caught) {
      setError(readableError(caught, "Could not save this task."));
    } finally {
      setBusy(false);
    }
  }

  async function changeCompletion(task: PlanningTask) {
    setBusy(true);
    setError(null);
    try {
      await api.updatePlanningTask(wedding.id, task.id, {
        completed: !task.completedAt,
      });
      setReload((value) => value + 1);
    } catch (caught) {
      setError(readableError(caught, "Could not update this task."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(task: PlanningTask) {
    if (!window.confirm(`Delete “${task.title}”? This cannot be undone.`))
      return;
    setBusy(true);
    setError(null);
    try {
      await api.deletePlanningTask(wedding.id, task.id);
      if (editing?.id === task.id) setEditing(null);
      setReload((value) => value + 1);
    } catch (caught) {
      setError(readableError(caught, "Could not delete this task."));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!cursor) return;
    const current = generation.current;
    setBusy(true);
    try {
      const page = await api.listPlanningTasks(wedding.id, { filter, cursor });
      if (current !== generation.current) return;
      setTasks((previous) => [
        ...previous,
        ...page.items.filter(
          (item) => !previous.some((old) => old.id === item.id),
        ),
      ]);
      setCursor(page.nextCursor);
    } catch (caught) {
      if (current === generation.current)
        setError(readableError(caught, "Could not load more tasks."));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  return (
    <section aria-labelledby="planning-title" className="space-y-5">
      <Card className="p-5 sm:p-7">
        <p className="text-xs font-bold tracking-[0.18em] text-[#925c68] uppercase">
          Preparation
        </p>
        <h2
          id="planning-title"
          className="font-serif text-2xl font-semibold text-[#432f35]"
        >
          Planning checklist
        </h2>
        <p className="mt-1 text-sm text-[#725f62]">
          Keep your tasks and deadlines together for {wedding.name}.
        </p>
        {overview ? (
          <div className="mt-5 space-y-2" aria-label="Planning progress">
            <p className="text-sm font-semibold text-[#71384b]">
              {overview.completed} of {overview.total} complete
            </p>
            <progress
              className="h-2 w-full accent-[#71384b]"
              value={overview.completed}
              max={overview.total || 1}
              aria-label="Tasks completed"
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 text-sm text-[#a1324e]">
            {error}
          </p>
        ) : null}
        <form
          key={editing?.id ?? "new"}
          onSubmit={(event) => void submit(event)}
          className="mt-6 space-y-3"
        >
          <h3 className="font-semibold text-[#432f35]">
            {editing ? "Edit task" : "Add a task"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="planning-title-input">Task title</Label>
              <Input
                id="planning-title-input"
                name="title"
                required
                maxLength={180}
                defaultValue={editing?.title ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="planning-category">Category (optional)</Label>
              <Input
                id="planning-category"
                name="category"
                maxLength={80}
                defaultValue={editing?.category ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="planning-due-date">Due date (optional)</Label>
              <Input
                id="planning-due-date"
                name="dueDate"
                type="date"
                defaultValue={editing?.dueDate ?? ""}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="planning-note">Private note (optional)</Label>
              <Textarea
                id="planning-note"
                name="note"
                maxLength={2000}
                defaultValue={editing?.note ?? ""}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {editing ? "Save task" : "Add task"}
            </Button>
            {editing ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Cancel edit
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {overview?.upcoming.length ? (
        <Card className="p-5 sm:p-6">
          <h3 className="font-serif text-xl font-semibold text-[#432f35]">
            Coming up
          </h3>
          <ol className="mt-3 space-y-2">
            {overview.upcoming.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap justify-between gap-2 text-sm text-[#574248]"
              >
                <span>{item.title}</span>
                <span>
                  {formatDate(item.dueDate!, wedding.locale)}
                  {isOverdue(item.dueDate!, wedding.timeZone)
                    ? " · Overdue"
                    : ""}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-serif text-xl font-semibold text-[#432f35]">
            All tasks
          </h3>
          <div>
            <Label htmlFor="planning-filter">Show tasks</Label>
            <Select
              id="planning-filter"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as PlanningTaskFilter)
              }
            >
              <option value="all">All</option>
              <option value="open">To do</option>
              <option value="completed">Completed</option>
            </Select>
          </div>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-[#725f62]">Loading tasks…</p>
        ) : tasks.length === 0 ? (
          <p className="mt-4 text-sm text-[#725f62]">No tasks yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {tasks.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-[#eadbd3] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p
                      className={`font-semibold ${item.completedAt ? "text-[#806d70] line-through" : "text-[#432f35]"}`}
                    >
                      {item.title}
                    </p>
                    <p className="text-xs text-[#806d70]">
                      {item.category ? `${item.category} · ` : ""}
                      {item.dueDate
                        ? `Due ${formatDate(item.dueDate, wedding.locale)}`
                        : "No due date"}
                    </p>
                    {item.note ? (
                      <p className="mt-1 text-sm text-[#725f62]">{item.note}</p>
                    ) : null}
                  </div>
                  <span className="text-xs text-[#806d70]">
                    {item.completedAt ? "Complete" : "To do"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label={`${item.completedAt ? "Reopen" : "Complete"} ${item.title}`}
                    onClick={() => void changeCompletion(item)}
                  >
                    {item.completedAt ? "Reopen" : "Complete"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Edit ${item.title}`}
                    onClick={() => setEditing(item)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Delete ${item.title}`}
                    onClick={() => void remove(item)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {cursor ? (
          <Button
            variant="secondary"
            className="mt-4"
            disabled={busy}
            onClick={() => void loadMore()}
          >
            Load more tasks
          </Button>
        ) : null}
      </Card>
    </section>
  );
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function isOverdue(value: string, timeZone: string): boolean {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return value < `${part("year")}-${part("month")}-${part("day")}`;
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
