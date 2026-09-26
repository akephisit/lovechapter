import type {
  Page,
  PlanningOverview,
  PlanningTask,
  PlanningTaskFilter,
  UpdatePlanningTaskInput,
} from "@lovechapter/contracts";
import {
  encodeCursor,
  NotFoundError,
  type NormalizedPlanningTaskInput,
  type PlanningRepository,
  type RepositoryPageInput,
} from "@lovechapter/domain";

import {
  buildPlanningAccessQuery,
  buildPlanningCountsQuery,
  buildPlanningDeleteQuery,
  buildPlanningInsertQuery,
  buildPlanningListQuery,
  buildPlanningUpcomingQuery,
  buildPlanningUpdateQuery,
} from "./planning-queries";
import type { QueryExecutor } from "./repository";

type TaskRow = {
  id: string;
  title: string;
  category: string | null;
  note: string | null;
  due_date: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function task(row: TaskRow): PlanningTask {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    note: row.note,
    dueDate: row.due_date,
    completedAt: row.completed_at ? timestamp(row.completed_at) : null,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export class PostgresPlanningRepository implements PlanningRepository {
  constructor(private readonly executor: QueryExecutor) {}

  private async authorized(userId: string, weddingId: string): Promise<void> {
    const result = await this.executor.execute<{ id: string }>(
      buildPlanningAccessQuery({ userId, weddingId }),
    );
    if (!result.rows[0]) throw new NotFoundError("Wedding not found");
  }

  async listPlanningTasks(
    userId: string,
    weddingId: string,
    input: RepositoryPageInput & { filter: PlanningTaskFilter },
  ): Promise<Page<PlanningTask>> {
    await this.authorized(userId, weddingId);
    const result = await this.executor.execute<TaskRow>(
      buildPlanningListQuery({ userId, weddingId, ...input }),
    );
    const items = result.rows.slice(0, input.limit).map(task);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        last && result.rows.length > input.limit
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }

  async getPlanningOverview(
    userId: string,
    weddingId: string,
  ): Promise<PlanningOverview> {
    await this.authorized(userId, weddingId);
    const counts = await this.executor.execute<{
      total: number;
      completed: number;
    }>(buildPlanningCountsQuery({ userId, weddingId }));
    const deadlines = await this.executor.execute<TaskRow>(
      buildPlanningUpcomingQuery({ userId, weddingId }),
    );
    return {
      total: Number(counts.rows[0]?.total ?? 0),
      completed: Number(counts.rows[0]?.completed ?? 0),
      upcoming: deadlines.rows.map(task),
    };
  }

  async createPlanningTask(
    userId: string,
    weddingId: string,
    id: string,
    input: NormalizedPlanningTaskInput,
  ): Promise<PlanningTask> {
    const result = await this.executor.execute<TaskRow>(
      buildPlanningInsertQuery({ userId, weddingId, id, task: input }),
    );
    if (!result.rows[0]) throw new NotFoundError("Wedding not found");
    return task(result.rows[0]);
  }

  async updatePlanningTask(
    userId: string,
    weddingId: string,
    taskId: string,
    input: UpdatePlanningTaskInput,
  ): Promise<PlanningTask> {
    const result = await this.executor.execute<TaskRow>(
      buildPlanningUpdateQuery({ userId, weddingId, taskId, patch: input }),
    );
    if (!result.rows[0]) throw new NotFoundError("Task not found");
    return task(result.rows[0]);
  }

  async deletePlanningTask(
    userId: string,
    weddingId: string,
    taskId: string,
  ): Promise<void> {
    const result = await this.executor.execute<{ id: string }>(
      buildPlanningDeleteQuery({ userId, weddingId, taskId }),
    );
    if (!result.rows[0]) throw new NotFoundError("Task not found");
  }
}
