import type {
  Page,
  PlanningOverview,
  PlanningTask,
  PlanningTaskFilter,
  UpdatePlanningTaskInput,
} from "@lovechapter/contracts";

import { encodeCursor } from "../cursor";
import { NotFoundError } from "../errors";
import type { NormalizedPlanningTaskInput } from "../planning";
import type {
  LoveChapterRepository,
  PlanningRepository,
  RepositoryPageInput,
} from "../ports";

export class InMemoryPlanningRepository implements PlanningRepository {
  private readonly tasks = new Map<
    string,
    { weddingId: string; task: PlanningTask }
  >();
  constructor(
    private readonly weddings: LoveChapterRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private async authorized(userId: string, weddingId: string) {
    await this.weddings.listGuestAffiliations(userId, weddingId);
  }
  private tasksFor(
    weddingId: string,
    filter: PlanningTaskFilter,
  ): PlanningTask[] {
    return [...this.tasks.values()]
      .filter(
        ({ weddingId: id, task }) =>
          id === weddingId &&
          (filter === "all" ||
            (task.completedAt !== null) === (filter === "completed")),
      )
      .map(({ task }) => task);
  }
  async listPlanningTasks(
    userId: string,
    weddingId: string,
    input: RepositoryPageInput & { filter: PlanningTaskFilter },
  ): Promise<Page<PlanningTask>> {
    await this.authorized(userId, weddingId);
    const ordered = this.tasksFor(weddingId, input.filter).toSorted(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
    const after = input.cursor
      ? ordered.filter(
          (task) =>
            task.createdAt < input.cursor!.createdAt ||
            (task.createdAt === input.cursor!.createdAt &&
              task.id < input.cursor!.id),
        )
      : ordered;
    const items = after.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        last && after.length > input.limit
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }
  async getPlanningOverview(
    userId: string,
    weddingId: string,
  ): Promise<PlanningOverview> {
    await this.authorized(userId, weddingId);
    const all = this.tasksFor(weddingId, "all");
    return {
      total: all.length,
      completed: all.filter((task) => task.completedAt !== null).length,
      upcoming: all
        .filter((task) => task.completedAt === null && task.dueDate)
        .toSorted(
          (a, b) =>
            a.dueDate!.localeCompare(b.dueDate!) || a.id.localeCompare(b.id),
        )
        .slice(0, 8),
    };
  }
  async createPlanningTask(
    userId: string,
    weddingId: string,
    id: string,
    input: NormalizedPlanningTaskInput,
  ): Promise<PlanningTask> {
    await this.authorized(userId, weddingId);
    const now = this.now().toISOString();
    const task = {
      ...input,
      id,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, { weddingId, task });
    return task;
  }
  async updatePlanningTask(
    userId: string,
    weddingId: string,
    taskId: string,
    input: UpdatePlanningTaskInput,
  ): Promise<PlanningTask> {
    await this.authorized(userId, weddingId);
    const record = this.tasks.get(taskId);
    if (!record || record.weddingId !== weddingId)
      throw new NotFoundError("Task not found");
    const { completed, ...fields } = input;
    const task: PlanningTask = {
      ...record.task,
      ...fields,
      ...(completed !== undefined
        ? {
            completedAt: completed
              ? (record.task.completedAt ?? this.now().toISOString())
              : null,
          }
        : {}),
      updatedAt: this.now().toISOString(),
    };
    this.tasks.set(taskId, { weddingId, task });
    return task;
  }
  async deletePlanningTask(
    userId: string,
    weddingId: string,
    taskId: string,
  ): Promise<void> {
    await this.authorized(userId, weddingId);
    const record = this.tasks.get(taskId);
    if (!record || record.weddingId !== weddingId)
      throw new NotFoundError("Task not found");
    this.tasks.delete(taskId);
  }
}
