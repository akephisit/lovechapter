import type {
  CreatePlanningTaskInput,
  UpdatePlanningTaskInput,
} from "@lovechapter/contracts";

import { DomainValidationError } from "./errors";

export type NormalizedPlanningTaskInput = {
  title: string;
  category: string | null;
  note: string | null;
  dueDate: string | null;
};

function requiredText(value: string, label: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed || Array.from(trimmed).length > max) {
    throw new DomainValidationError(`${label} must be 1–${max} characters`);
  }
  return trimmed;
}

function optionalText(
  value: string | null | undefined,
  max: number,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (Array.from(trimmed).length > max)
    throw new DomainValidationError(`Text must be at most ${max} characters`);
  return trimmed || null;
}

function calendarDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new DomainValidationError("Invalid due date");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day!);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new DomainValidationError("Invalid due date");
  return value;
}

export function normalizePlanningTaskCreate(
  input: CreatePlanningTaskInput,
): NormalizedPlanningTaskInput {
  return {
    title: requiredText(input.title, "Task title", 180),
    category: optionalText(input.category, 80),
    note: optionalText(input.note, 2_000),
    dueDate: calendarDate(input.dueDate),
  };
}

export function normalizePlanningTaskPatch(
  input: UpdatePlanningTaskInput,
): UpdatePlanningTaskInput {
  if (!Object.keys(input).length)
    throw new DomainValidationError("Task update cannot be empty");
  return {
    ...(input.title !== undefined
      ? { title: requiredText(input.title, "Task title", 180) }
      : {}),
    ...(input.category !== undefined
      ? { category: optionalText(input.category, 80) }
      : {}),
    ...(input.note !== undefined
      ? { note: optionalText(input.note, 2_000) }
      : {}),
    ...(input.dueDate !== undefined
      ? { dueDate: calendarDate(input.dueDate) }
      : {}),
    ...(input.completed !== undefined ? { completed: input.completed } : {}),
  };
}
