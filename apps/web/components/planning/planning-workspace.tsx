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

import { safeUiError } from "../../lib/ui-error";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { useUiCopy } from "../ui-language-provider";
import { localizeStoredUiMessage } from "../../lib/ui-copy";

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
  const copy = useUiCopy();
  const copyRef = useRef(copy);
  copyRef.current = copy;
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
            safeUiError(
              caught,
              copyRef.current,
              copyRef.current.planning.loadError,
            ),
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
      setError(safeUiError(caught, copy, copy.planning.saveError));
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
      setError(safeUiError(caught, copy, copy.planning.updateError));
    } finally {
      setBusy(false);
    }
  }

  async function remove(task: PlanningTask) {
    if (!window.confirm(copy.planning.deleteConfirm(task.title))) return;
    setBusy(true);
    setError(null);
    try {
      await api.deletePlanningTask(wedding.id, task.id);
      if (editing?.id === task.id) setEditing(null);
      setReload((value) => value + 1);
    } catch (caught) {
      setError(safeUiError(caught, copy, copy.planning.deleteError));
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
        setError(safeUiError(caught, copy, copy.planning.moreError));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  return (
    <section aria-labelledby="planning-title" className="space-y-5">
      <Card className="p-5 sm:p-7">
        <p className="text-xs font-bold tracking-[0.18em] text-[#925c68] uppercase">
          {copy.planning.eyebrow}
        </p>
        <h2
          id="planning-title"
          className="font-serif text-2xl font-semibold text-[#432f35]"
        >
          {copy.planning.title}
        </h2>
        <p className="mt-1 text-sm text-[#725f62]">
          {copy.planning.description(wedding.name)}
        </p>
        {overview ? (
          <div className="mt-5 space-y-2" aria-label={copy.planning.progress}>
            <p className="text-sm font-semibold text-[#71384b]">
              {copy.planning.completedCount(overview.completed, overview.total)}
            </p>
            <progress
              className="h-2 w-full accent-[#71384b]"
              value={overview.completed}
              max={overview.total || 1}
              aria-label={copy.planning.tasksCompleted}
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 text-sm text-[#a1324e]">
            {localizeStoredUiMessage(error, copy)}
          </p>
        ) : null}
        <form
          key={editing?.id ?? "new"}
          onSubmit={(event) => void submit(event)}
          className="mt-6 space-y-3"
        >
          <h3 className="font-semibold text-[#432f35]">
            {editing ? copy.planning.editTask : copy.planning.addTaskTitle}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="planning-title-input">
                {copy.planning.taskTitle}
              </Label>
              <Input
                id="planning-title-input"
                name="title"
                required
                maxLength={180}
                defaultValue={editing?.title ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="planning-category">
                {copy.planning.category}
              </Label>
              <Input
                id="planning-category"
                name="category"
                maxLength={80}
                defaultValue={editing?.category ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="planning-due-date">{copy.planning.dueDate}</Label>
              <Input
                id="planning-due-date"
                name="dueDate"
                type="date"
                defaultValue={editing?.dueDate ?? ""}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="planning-note">{copy.planning.note}</Label>
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
              {editing ? copy.planning.saveTask : copy.planning.addTask}
            </Button>
            {editing ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                {copy.planning.cancelEdit}
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {overview?.upcoming.length ? (
        <Card className="p-5 sm:p-6">
          <h3 className="font-serif text-xl font-semibold text-[#432f35]">
            {copy.planning.comingUp}
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
                    ? ` · ${copy.planning.overdue}`
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
            {copy.planning.allTasks}
          </h3>
          <div>
            <Label htmlFor="planning-filter">{copy.planning.showTasks}</Label>
            <Select
              id="planning-filter"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as PlanningTaskFilter)
              }
            >
              <option value="all">{copy.planning.all}</option>
              <option value="open">{copy.planning.toDo}</option>
              <option value="completed">{copy.planning.completed}</option>
            </Select>
          </div>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-[#725f62]">{copy.planning.loading}</p>
        ) : tasks.length === 0 ? (
          <p className="mt-4 text-sm text-[#725f62]">{copy.planning.empty}</p>
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
                        ? copy.planning.due(
                            formatDate(item.dueDate, wedding.locale),
                          )
                        : copy.planning.noDueDate}
                    </p>
                    {item.note ? (
                      <p className="mt-1 text-sm text-[#725f62]">{item.note}</p>
                    ) : null}
                  </div>
                  <span className="text-xs text-[#806d70]">
                    {item.completedAt
                      ? copy.planning.complete
                      : copy.planning.toDo}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label={copy.planning.actionLabel(
                      item.completedAt
                        ? copy.planning.reopen
                        : copy.planning.complete,
                      item.title,
                    )}
                    onClick={() => void changeCompletion(item)}
                  >
                    {item.completedAt
                      ? copy.planning.reopen
                      : copy.planning.complete}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label={copy.planning.actionLabel(
                      copy.planning.edit,
                      item.title,
                    )}
                    onClick={() => setEditing(item)}
                  >
                    {copy.planning.edit}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label={copy.planning.actionLabel(
                      copy.planning.delete,
                      item.title,
                    )}
                    onClick={() => void remove(item)}
                  >
                    {copy.planning.delete}
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
            {copy.planning.loadMore}
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
