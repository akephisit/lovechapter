import type {
  PlanningTaskFilter,
  UpdatePlanningTaskInput,
} from "@lovechapter/contracts";
import type {
  ListCursor,
  NormalizedPlanningTaskInput,
} from "@lovechapter/domain";
import { sql, type SQL } from "drizzle-orm";

import { planningTasks, weddingMembers, weddings } from "./schema";

type Scope = { userId: string; weddingId: string };
const columns = sql`${planningTasks.id} as "id", ${planningTasks.title} as "title",
  ${planningTasks.category} as "category", ${planningTasks.note} as "note",
  to_char(${planningTasks.dueDate}, 'YYYY-MM-DD') as "due_date",
  to_char(${planningTasks.completedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "completed_at",
  to_char(${planningTasks.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "created_at",
  to_char(${planningTasks.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updated_at"`;
const member = ({
  userId,
  weddingId,
}: Scope) => sql`exists (select 1 from ${weddingMembers}
  where ${weddingMembers.weddingId} = ${weddingId} and ${weddingMembers.userId} = ${userId})`;

export function buildPlanningAccessQuery(scope: Scope): SQL {
  return sql`select ${weddings.id} as "id" from ${weddings} inner join ${weddingMembers}
    on ${weddingMembers.weddingId} = ${weddings.id} and ${weddingMembers.userId} = ${scope.userId}
    where ${weddings.id} = ${scope.weddingId} limit 1`;
}

export function buildPlanningListQuery(
  input: Scope & {
    limit: number;
    filter: PlanningTaskFilter;
    cursor?: ListCursor;
  },
): SQL {
  const filter =
    input.filter === "all"
      ? sql``
      : input.filter === "open"
        ? sql`and ${planningTasks.completedAt} is null`
        : sql`and ${planningTasks.completedAt} is not null`;
  const cursor = input.cursor
    ? sql`and (${planningTasks.createdAt}, ${planningTasks.id}) < (${input.cursor.createdAt}, ${input.cursor.id})`
    : sql``;
  return sql`select ${columns} from ${planningTasks}
    where ${planningTasks.weddingId} = ${input.weddingId} and ${member(input)}
      ${filter} ${cursor}
    order by ${planningTasks.createdAt} desc, ${planningTasks.id} desc limit ${input.limit + 1}`;
}

export function buildPlanningCountsQuery(scope: Scope): SQL {
  return sql`select count(*)::int as "total", count(${planningTasks.completedAt})::int as "completed"
    from ${planningTasks} where ${planningTasks.weddingId} = ${scope.weddingId} and ${member(scope)}`;
}

export function buildPlanningUpcomingQuery(scope: Scope): SQL {
  return sql`select ${columns} from ${planningTasks}
    where ${planningTasks.weddingId} = ${scope.weddingId} and ${member(scope)}
      and ${planningTasks.completedAt} is null and ${planningTasks.dueDate} is not null
    order by ${planningTasks.dueDate}, ${planningTasks.id} limit 8`;
}

export function buildPlanningInsertQuery(
  input: Scope & { id: string; task: NormalizedPlanningTaskInput },
): SQL {
  const t = input.task;
  return sql`insert into ${planningTasks} (id, wedding_id, title, category, note, due_date)
    select ${input.id}, ${input.weddingId}, ${t.title}, ${t.category}, ${t.note}, ${t.dueDate}
    where ${member(input)} returning ${columns}`;
}

export function buildPlanningUpdateQuery(
  input: Scope & { taskId: string; patch: UpdatePlanningTaskInput },
): SQL {
  const p = input.patch;
  const changes: SQL[] = [];
  if (p.title !== undefined)
    changes.push(sql`${sql.identifier(planningTasks.title.name)} = ${p.title}`);
  if (p.category !== undefined)
    changes.push(
      sql`${sql.identifier(planningTasks.category.name)} = ${p.category}`,
    );
  if (p.note !== undefined)
    changes.push(sql`${sql.identifier(planningTasks.note.name)} = ${p.note}`);
  if (p.dueDate !== undefined)
    changes.push(
      sql`${sql.identifier(planningTasks.dueDate.name)} = ${p.dueDate}`,
    );
  if (p.completed !== undefined)
    changes.push(
      sql`${sql.identifier(planningTasks.completedAt.name)} = case when ${p.completed} then coalesce(${planningTasks.completedAt}, now()) else null end`,
    );
  changes.push(sql`${sql.identifier(planningTasks.updatedAt.name)} = now()`);
  return sql`update ${planningTasks} set ${sql.join(changes, sql`, `)}
    where ${planningTasks.weddingId} = ${input.weddingId} and ${planningTasks.id} = ${input.taskId} and ${member(input)}
    returning ${columns}`;
}

export function buildPlanningDeleteQuery(
  input: Scope & { taskId: string },
): SQL {
  return sql`delete from ${planningTasks} where ${planningTasks.weddingId} = ${input.weddingId}
    and ${planningTasks.id} = ${input.taskId} and ${member(input)} returning ${planningTasks.id} as "id"`;
}
