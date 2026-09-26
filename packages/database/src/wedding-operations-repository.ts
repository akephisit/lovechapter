import type {
  Budget,
  BudgetCategory,
  BudgetCategoryInput,
  BudgetOverview,
  Expense,
  ExpenseInput,
  Page,
  RunSheetItem,
  RunSheetItemInput,
  SeatingAssignment,
  SeatingTable,
  SeatingTableInput,
  Vendor,
  VendorInput,
} from "@lovechapter/contracts";
import {
  ConflictError,
  encodeCursor,
  NotFoundError,
  type RepositoryPageInput,
  type WeddingOperationsRepository,
} from "@lovechapter/domain";
import { sql, type SQL } from "drizzle-orm";

import {
  budgetCategories,
  budgetConfigs,
  expenses,
  guests,
  runSheetItems,
  seatingAssignments,
  seatingTables,
  rsvps,
  vendors,
  weddingMembers,
  weddings,
} from "./schema";
import type { QueryExecutor } from "./repository";

type Scope = { userId: string; weddingId: string };
const member = (s: Scope): SQL =>
  sql`exists (select 1 from ${weddingMembers} where ${weddingMembers.weddingId} = ${s.weddingId} and ${weddingMembers.userId} = ${s.userId})`;
const utc = (column: SQL): SQL =>
  sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const day = (column: SQL): SQL => sql`to_char(${column}, 'YYYY-MM-DD')`;

export const authorizedWedding = (s: Scope): SQL =>
  sql`select ${weddings.id} as "id" from ${weddings} where ${weddings.id} = ${s.weddingId} and ${member(s)} limit 1`;

const vendorColumns = sql`${vendors.id} as "id", ${vendors.name} as "name",
  ${vendors.status} as "status", ${vendors.contactName} as "contact_name",
  ${vendors.email} as "email", ${vendors.phone} as "phone",
  ${vendors.quoteMinor}::text as "quote_minor", ${vendors.note} as "note",
  ${utc(sql`${vendors.createdAt}`)} as "cursor_time"`;
const expenseColumns = sql`${expenses.id} as "id", ${expenses.title} as "title",
  ${expenses.plannedMinor}::text as "planned_minor", ${expenses.paidMinor}::text as "paid_minor",
  ${expenses.categoryId} as "category_id", ${expenses.vendorId} as "vendor_id",
  ${day(sql`${expenses.dueDate}`)} as "due_date", ${expenses.note} as "note",
  ${utc(sql`${expenses.createdAt}`)} as "cursor_time"`;
const runColumns = sql`${runSheetItems.id} as "id", ${runSheetItems.title} as "title",
  ${utc(sql`${runSheetItems.startsAt}`)} as "starts_at",
  ${utc(sql`${runSheetItems.endsAt}`)} as "ends_at",
  ${runSheetItems.location} as "location", ${runSheetItems.responsible} as "responsible",
  ${runSheetItems.note} as "note",
  ${utc(sql`${runSheetItems.startsAt}`)} as "cursor_time"`;

export const listExpenseQuery = (s: Scope & RepositoryPageInput): SQL =>
  sql`select ${expenseColumns} from ${expenses}
    where ${expenses.weddingId} = ${s.weddingId} and ${member(s)}
    ${s.cursor ? sql`and (${expenses.createdAt}, ${expenses.id}) < (${s.cursor.createdAt}, ${s.cursor.id})` : sql``}
    order by ${expenses.createdAt} desc, ${expenses.id} desc limit ${s.limit + 1}`;

export const seatUsageQuery = (s: Scope & { tableId: string }): SQL =>
  sql`select coalesce(sum(${guests.allowedPartySize}), 0)::int as "reserved"
    from ${seatingAssignments} inner join ${guests}
      on ${guests.weddingId} = ${seatingAssignments.weddingId}
      and ${guests.id} = ${seatingAssignments.guestId}
    where ${seatingAssignments.weddingId} = ${s.weddingId}
      and ${seatingAssignments.tableId} = ${s.tableId} and ${member(s)}`;

type PageRow = { id: string; cursor_time: string };
function pageFromRows<R extends PageRow, T>(
  rows: R[],
  limit: number,
  map: (row: R) => T,
): Page<T> {
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return {
    items: selected.map(map),
    nextCursor:
      last && rows.length > limit
        ? encodeCursor({ createdAt: last.cursor_time, id: last.id })
        : null,
  };
}
function uniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
type VendorRow = PageRow & {
  name: string;
  status: Vendor["status"];
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  quote_minor: string | null;
  note: string | null;
};
const vendorFrom = (r: VendorRow): Vendor => ({
  id: r.id,
  name: r.name,
  status: r.status,
  contactName: r.contact_name,
  email: r.email,
  phone: r.phone,
  quoteMinor: r.quote_minor == null ? null : Number(r.quote_minor),
  note: r.note,
});
type ExpenseRow = PageRow & {
  title: string;
  planned_minor: string;
  paid_minor: string;
  category_id: string | null;
  vendor_id: string | null;
  due_date: string | null;
  note: string | null;
};
const expenseFrom = (r: ExpenseRow): Expense => ({
  id: r.id,
  title: r.title,
  plannedMinor: Number(r.planned_minor),
  paidMinor: Number(r.paid_minor),
  categoryId: r.category_id,
  vendorId: r.vendor_id,
  dueDate: r.due_date,
  note: r.note,
});
type RunRow = PageRow & {
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  responsible: string | null;
  note: string | null;
};
const runFrom = (r: RunRow): RunSheetItem => ({
  id: r.id,
  title: r.title,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  location: r.location,
  responsible: r.responsible,
  note: r.note,
});

export class PostgresWeddingOperationsRepository implements WeddingOperationsRepository {
  constructor(private readonly executor: QueryExecutor) {}

  private async authorized(s: Scope): Promise<void> {
    const result = await this.executor.execute<{ id: string }>(
      authorizedWedding(s),
    );
    if (!result.rows[0]) throw new NotFoundError("Wedding not found");
  }

  private async one<T extends Record<string, unknown>>(
    query: SQL,
    label: string,
  ): Promise<T> {
    const result = await this.executor.execute<T>(query);
    if (!result.rows[0]) throw new NotFoundError(`${label} not found`);
    return result.rows[0];
  }

  async getBudgetOverview(
    userId: string,
    weddingId: string,
  ): Promise<BudgetOverview> {
    const row = await this.one<{
      currency: string | null;
      target_minor: string | null;
      planned: string;
      paid: string;
    }>(
      sql`select ${budgetConfigs.currency} as "currency",
      ${budgetConfigs.targetMinor}::text as "target_minor",
      coalesce((select sum(${expenses.plannedMinor}) from ${expenses} where ${expenses.weddingId} = ${weddingId}), 0)::text as "planned",
      coalesce((select sum(${expenses.paidMinor}) from ${expenses} where ${expenses.weddingId} = ${weddingId}), 0)::text as "paid"
      from ${weddings} inner join ${weddingMembers}
        on ${weddingMembers.weddingId} = ${weddings.id} and ${weddingMembers.userId} = ${userId}
      left join ${budgetConfigs} on ${budgetConfigs.weddingId} = ${weddings.id}
      where ${weddings.id} = ${weddingId} limit 1`,
      "Wedding",
    );
    const plannedMinor = Number(row.planned);
    const paidMinor = Number(row.paid);
    if (!Number.isSafeInteger(plannedMinor) || !Number.isSafeInteger(paidMinor))
      throw new ConflictError("Budget total exceeds safe integer range");
    return {
      budget: row.currency
        ? {
            currency: row.currency,
            targetMinor:
              row.target_minor === null ? null : Number(row.target_minor),
          }
        : null,
      plannedMinor,
      paidMinor,
      remainingMinor: plannedMinor - paidMinor,
    };
  }

  async setBudget(
    userId: string,
    weddingId: string,
    input: Budget,
  ): Promise<Budget> {
    const s = { userId, weddingId };
    await this.authorized(s);
    return this.executor.transaction(async (tx) => {
      // All writes that interpret this currency take the same wedding lock.
      await tx.execute(sql`select ${weddings.id} from ${weddings}
      where ${weddings.id} = ${weddingId} and ${member(s)} for update`);
      const result = await tx.execute<{
        currency: string;
        target_minor: string | null;
      }>(
        sql`insert into ${budgetConfigs} (wedding_id, currency, target_minor)
        select ${weddingId}, ${input.currency}, ${input.targetMinor}
        where ${member(s)}
        on conflict (wedding_id) do update set currency = excluded.currency,
          target_minor = excluded.target_minor
        where ${budgetConfigs.currency} = excluded.currency
          or (not exists (select 1 from ${expenses} where ${expenses.weddingId} = ${weddingId})
            and not exists (select 1 from ${vendors}
              where ${vendors.weddingId} = ${weddingId} and ${vendors.quoteMinor} is not null))
        returning ${budgetConfigs.currency} as "currency", ${budgetConfigs.targetMinor}::text as "target_minor"`,
      );
      const row = result.rows[0];
      if (!row)
        throw new ConflictError(
          "Currency cannot change while costs or vendor quotes exist",
        );
      return {
        currency: row.currency,
        targetMinor:
          row.target_minor === null ? null : Number(row.target_minor),
      };
    });
  }

  async listBudgetCategories(
    userId: string,
    weddingId: string,
  ): Promise<BudgetCategory[]> {
    const s = { userId, weddingId };
    await this.authorized(s);
    const result = await this.executor
      .execute<BudgetCategory>(sql`select ${budgetCategories.id} as "id", ${budgetCategories.name} as "name"
      from ${budgetCategories} where ${budgetCategories.weddingId} = ${weddingId} and ${member(s)}
      order by ${budgetCategories.name}, ${budgetCategories.id} limit 101`);
    if (result.rows.length > 100)
      throw new ConflictError("Too many budget categories");
    return result.rows;
  }

  async saveBudgetCategory(
    userId: string,
    weddingId: string,
    id: string,
    input: BudgetCategoryInput,
    create: boolean,
  ): Promise<BudgetCategory> {
    const s = { userId, weddingId };
    await this.authorized(s);
    try {
      return await this.executor.transaction(async (tx) => {
        if (create) {
          await tx.execute(
            sql`select ${weddings.id} from ${weddings} where ${weddings.id} = ${weddingId} for update`,
          );
          const count = await tx.execute<{ count: number }>(
            sql`select count(*)::int as "count" from ${budgetCategories} where ${budgetCategories.weddingId} = ${weddingId}`,
          );
          if (count.rows[0]!.count >= 100)
            throw new ConflictError(
              "A wedding can have at most 100 budget categories",
            );
        }
        const query = create
          ? sql`insert into ${budgetCategories} (wedding_id, id, name) select ${weddingId}, ${id}, ${input.name} where ${member(s)}
          returning ${budgetCategories.id} as "id", ${budgetCategories.name} as "name"`
          : sql`update ${budgetCategories} set name = ${input.name}, updated_at = now()
          where ${budgetCategories.weddingId} = ${weddingId} and ${budgetCategories.id} = ${id} and ${member(s)}
          returning ${budgetCategories.id} as "id", ${budgetCategories.name} as "name"`;
        const rows = await tx.execute<BudgetCategory>(query);
        if (!rows.rows[0]) throw new NotFoundError("Budget category not found");
        return rows.rows[0];
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictError("Budget category name is already used");
      throw error;
    }
  }

  async deleteBudgetCategory(
    userId: string,
    weddingId: string,
    id: string,
  ): Promise<void> {
    const s = { userId, weddingId };
    await this.authorized(s);
    await this.executor.transaction(async (tx) => {
      await tx.execute(sql`select ${weddings.id} from ${weddings}
        where ${weddings.id} = ${weddingId} and ${member(s)} for update`);
      const locked = await tx.execute<{
        id: string;
      }>(sql`select ${budgetCategories.id} as "id"
        from ${budgetCategories} where ${budgetCategories.weddingId} = ${weddingId}
        and ${budgetCategories.id} = ${id} and ${member(s)} for update`);
      if (!locked.rows[0]) throw new NotFoundError("Budget category not found");
      await tx.execute(sql`update ${expenses} set category_id = null, updated_at = now()
        where ${expenses.weddingId} = ${weddingId} and ${expenses.categoryId} = ${id}`);
      await tx.execute(
        sql`delete from ${budgetCategories} where ${budgetCategories.weddingId} = ${weddingId} and ${budgetCategories.id} = ${id}`,
      );
    });
  }

  async listVendors(
    userId: string,
    weddingId: string,
    page: RepositoryPageInput,
  ): Promise<Page<Vendor>> {
    const s = { userId, weddingId };
    await this.authorized(s);
    const result = await this.executor
      .execute<VendorRow>(sql`select ${vendorColumns} from ${vendors}
      where ${vendors.weddingId} = ${weddingId} and ${member(s)}
      ${page.cursor ? sql`and (${vendors.createdAt}, ${vendors.id}) < (${page.cursor.createdAt}, ${page.cursor.id})` : sql``}
      order by ${vendors.createdAt} desc, ${vendors.id} desc limit ${page.limit + 1}`);
    return pageFromRows(result.rows, page.limit, vendorFrom);
  }

  async saveVendor(
    userId: string,
    weddingId: string,
    id: string,
    input: Required<VendorInput>,
    create: boolean,
  ): Promise<Vendor> {
    const s = { userId, weddingId };
    await this.authorized(s);
    return this.executor.transaction(async (tx) => {
      if (input.quoteMinor !== null)
        await tx.execute(sql`select ${weddings.id} from ${weddings}
      where ${weddings.id} = ${weddingId} and ${member(s)} for update`);
      const budgetGuard = sql`(${input.quoteMinor}::bigint is null or exists
      (select 1 from ${budgetConfigs} where ${budgetConfigs.weddingId} = ${weddingId}))`;
      const query = create
        ? sql`insert into ${vendors} (wedding_id,id,name,status,contact_name,email,phone,quote_minor,note)
        select ${weddingId},${id},${input.name},${input.status},${input.contactName},${input.email},${input.phone},${input.quoteMinor},${input.note}
        where ${member(s)} and ${budgetGuard} returning ${vendorColumns}`
        : sql`update ${vendors} set name = ${input.name}, status = ${input.status},
        contact_name = ${input.contactName}, email = ${input.email}, phone = ${input.phone},
        quote_minor = ${input.quoteMinor}, note = ${input.note}, updated_at = now()
        where ${vendors.weddingId} = ${weddingId} and ${vendors.id} = ${id}
          and ${member(s)} and ${budgetGuard} returning ${vendorColumns}`;
      const result = await tx.execute<VendorRow>(query);
      if (!result.rows[0])
        throw new NotFoundError(
          "Vendor not found or budget currency not configured",
        );
      return vendorFrom(result.rows[0]);
    });
  }

  async deleteVendor(
    userId: string,
    weddingId: string,
    id: string,
  ): Promise<void> {
    const s = { userId, weddingId };
    await this.authorized(s);
    await this.executor.transaction(async (tx) => {
      await tx.execute(sql`select ${weddings.id} from ${weddings}
        where ${weddings.id} = ${weddingId} and ${member(s)} for update`);
      const locked = await tx.execute<{
        id: string;
      }>(sql`select ${vendors.id} as "id" from ${vendors}
        where ${vendors.weddingId} = ${weddingId} and ${vendors.id} = ${id} and ${member(s)} for update`);
      if (!locked.rows[0]) throw new NotFoundError("Vendor not found");
      await tx.execute(sql`update ${expenses} set vendor_id = null, updated_at = now()
        where ${expenses.weddingId} = ${weddingId} and ${expenses.vendorId} = ${id}`);
      await tx.execute(
        sql`delete from ${vendors} where ${vendors.weddingId} = ${weddingId} and ${vendors.id} = ${id}`,
      );
    });
  }

  async listExpenses(
    userId: string,
    weddingId: string,
    page: RepositoryPageInput,
  ): Promise<Page<Expense>> {
    const s = { userId, weddingId };
    await this.authorized(s);
    const result = await this.executor.execute<ExpenseRow>(
      listExpenseQuery({ ...s, ...page }),
    );
    return pageFromRows(result.rows, page.limit, expenseFrom);
  }

  async saveExpense(
    userId: string,
    weddingId: string,
    id: string,
    input: Required<ExpenseInput>,
    create: boolean,
  ): Promise<Expense> {
    const s = { userId, weddingId };
    await this.authorized(s);
    return this.executor.transaction(async (tx) => {
      await tx.execute(sql`select ${weddings.id} from ${weddings}
      where ${weddings.id} = ${weddingId} and ${member(s)} for update`);
      const guard = sql`${member(s)}
      and exists (select 1 from ${budgetConfigs} where ${budgetConfigs.weddingId} = ${weddingId})
      and (${input.categoryId}::uuid is null or exists (select 1 from ${budgetCategories}
        where ${budgetCategories.weddingId} = ${weddingId} and ${budgetCategories.id} = ${input.categoryId}))
      and (${input.vendorId}::uuid is null or exists (select 1 from ${vendors}
        where ${vendors.weddingId} = ${weddingId} and ${vendors.id} = ${input.vendorId}))`;
      const query = create
        ? sql`insert into ${expenses} (wedding_id,id,title,planned_minor,paid_minor,category_id,vendor_id,due_date,note)
        select ${weddingId},${id},${input.title},${input.plannedMinor},${input.paidMinor},${input.categoryId},${input.vendorId},${input.dueDate},${input.note}
        where ${guard} returning ${expenseColumns}`
        : sql`update ${expenses} set title = ${input.title}, planned_minor = ${input.plannedMinor},
        paid_minor = ${input.paidMinor}, category_id = ${input.categoryId}, vendor_id = ${input.vendorId},
        due_date = ${input.dueDate}, note = ${input.note}, updated_at = now()
        where ${expenses.weddingId} = ${weddingId} and ${expenses.id} = ${id} and ${guard}
        returning ${expenseColumns}`;
      const result = await tx.execute<ExpenseRow>(query);
      if (!result.rows[0])
        throw new NotFoundError(
          "Expense, budget, category, or vendor not found",
        );
      return expenseFrom(result.rows[0]);
    });
  }

  async deleteExpense(
    userId: string,
    weddingId: string,
    id: string,
  ): Promise<void> {
    const s = { userId, weddingId };
    await this.authorized(s);
    const result = await this.executor.execute<{
      id: string;
    }>(sql`delete from ${expenses}
      where ${expenses.weddingId} = ${weddingId} and ${expenses.id} = ${id}
      and ${member(s)} returning ${expenses.id} as "id"`);
    if (!result.rows[0]) throw new NotFoundError("Expense not found");
  }

  async listRunSheet(
    userId: string,
    weddingId: string,
    page: RepositoryPageInput,
  ): Promise<Page<RunSheetItem>> {
    const s = { userId, weddingId };
    await this.authorized(s);
    const result = await this.executor
      .execute<RunRow>(sql`select ${runColumns} from ${runSheetItems}
      where ${runSheetItems.weddingId} = ${weddingId} and ${member(s)}
      ${page.cursor ? sql`and (${runSheetItems.startsAt}, ${runSheetItems.id}) > (${page.cursor.createdAt}, ${page.cursor.id})` : sql``}
      order by ${runSheetItems.startsAt}, ${runSheetItems.id} limit ${page.limit + 1}`);
    return pageFromRows(result.rows, page.limit, runFrom);
  }

  async saveRunSheetItem(
    userId: string,
    weddingId: string,
    id: string,
    input: Required<RunSheetItemInput>,
    create: boolean,
  ): Promise<RunSheetItem> {
    const s = { userId, weddingId };
    await this.authorized(s);
    const query = create
      ? sql`insert into ${runSheetItems} (wedding_id,id,title,starts_at,ends_at,location,responsible,note)
        select ${weddingId},${id},${input.title},${input.startsAt},${input.endsAt},${input.location},${input.responsible},${input.note}
        where ${member(s)} returning ${runColumns}`
      : sql`update ${runSheetItems} set title = ${input.title}, starts_at = ${input.startsAt},
        ends_at = ${input.endsAt}, location = ${input.location}, responsible = ${input.responsible},
        note = ${input.note}, updated_at = now()
        where ${runSheetItems.weddingId} = ${weddingId} and ${runSheetItems.id} = ${id}
        and ${member(s)} returning ${runColumns}`;
    const result = await this.executor.execute<RunRow>(query);
    if (!result.rows[0]) throw new NotFoundError("Schedule item not found");
    return runFrom(result.rows[0]);
  }

  async deleteRunSheetItem(
    userId: string,
    weddingId: string,
    id: string,
  ): Promise<void> {
    const s = { userId, weddingId };
    await this.authorized(s);
    const result = await this.executor.execute<{
      id: string;
    }>(sql`delete from ${runSheetItems}
      where ${runSheetItems.weddingId} = ${weddingId} and ${runSheetItems.id} = ${id}
      and ${member(s)} returning ${runSheetItems.id} as "id"`);
    if (!result.rows[0]) throw new NotFoundError("Schedule item not found");
  }

  async listSeatingTables(
    userId: string,
    weddingId: string,
  ): Promise<SeatingTable[]> {
    const s = { userId, weddingId };
    await this.authorized(s);
    const result = await this.executor.execute<{
      id: string;
      name: string;
      capacity: number;
      reserved: number;
    }>(
      sql`select ${seatingTables.id} as "id", ${seatingTables.name} as "name",
        ${seatingTables.capacity} as "capacity", coalesce(sum(${guests.allowedPartySize}),0)::int as "reserved"
        from ${seatingTables} left join ${seatingAssignments}
          on ${seatingAssignments.weddingId} = ${seatingTables.weddingId}
          and ${seatingAssignments.tableId} = ${seatingTables.id}
        left join ${guests} on ${guests.weddingId} = ${seatingAssignments.weddingId}
          and ${guests.id} = ${seatingAssignments.guestId}
        where ${seatingTables.weddingId} = ${weddingId} and ${member(s)}
        group by ${seatingTables.weddingId}, ${seatingTables.id}
        order by ${seatingTables.name}, ${seatingTables.id} limit 101`,
    );
    if (result.rows.length > 100)
      throw new ConflictError("Too many seating tables");
    return result.rows;
  }

  async saveSeatingTable(
    userId: string,
    weddingId: string,
    id: string,
    input: SeatingTableInput,
    create: boolean,
  ): Promise<SeatingTable> {
    const s = { userId, weddingId };
    await this.authorized(s);
    try {
      return await this.executor.transaction(async (tx) => {
        if (create) {
          await tx.execute(
            sql`select ${weddings.id} from ${weddings} where ${weddings.id} = ${weddingId} for update`,
          );
          const count = await tx.execute<{ count: number }>(
            sql`select count(*)::int as "count" from ${seatingTables} where ${seatingTables.weddingId} = ${weddingId}`,
          );
          if (count.rows[0]!.count >= 100)
            throw new ConflictError("A wedding can have at most 100 tables");
        } else {
          const locked = await tx.execute<{
            id: string;
          }>(sql`select ${seatingTables.id} as "id" from ${seatingTables}
          where ${seatingTables.weddingId} = ${weddingId} and ${seatingTables.id} = ${id} and ${member(s)} for update`);
          if (!locked.rows[0]) throw new NotFoundError("Table not found");
          const usage = await tx.execute<{ reserved: number }>(
            seatUsageQuery({ ...s, tableId: id }),
          );
          if (usage.rows[0]!.reserved > input.capacity)
            throw new ConflictError("Capacity is below reserved seats");
        }
        const query = create
          ? sql`insert into ${seatingTables} (wedding_id,id,name,capacity)
          select ${weddingId},${id},${input.name},${input.capacity} where ${member(s)}
          returning ${seatingTables.id} as "id", ${seatingTables.name} as "name", ${seatingTables.capacity} as "capacity"`
          : sql`update ${seatingTables} set name = ${input.name}, capacity = ${input.capacity}, updated_at = now()
          where ${seatingTables.weddingId} = ${weddingId} and ${seatingTables.id} = ${id}
          and ${member(s)} returning ${seatingTables.id} as "id", ${seatingTables.name} as "name", ${seatingTables.capacity} as "capacity"`;
        const result = await tx.execute<{
          id: string;
          name: string;
          capacity: number;
        }>(query);
        if (!result.rows[0]) throw new NotFoundError("Table not found");
        const usage = await tx.execute<{ reserved: number }>(
          seatUsageQuery({ ...s, tableId: id }),
        );
        return { ...result.rows[0], reserved: usage.rows[0]!.reserved };
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictError("Table name is already used");
      throw error;
    }
  }

  async deleteSeatingTable(
    userId: string,
    weddingId: string,
    id: string,
  ): Promise<void> {
    const s = { userId, weddingId };
    await this.authorized(s);
    const result = await this.executor.execute<{
      id: string;
    }>(sql`delete from ${seatingTables}
      where ${seatingTables.weddingId} = ${weddingId} and ${seatingTables.id} = ${id}
      and ${member(s)} returning ${seatingTables.id} as "id"`);
    if (!result.rows[0]) throw new NotFoundError("Table not found");
  }

  async listSeatingAssignments(
    userId: string,
    weddingId: string,
    tableId: string,
  ): Promise<SeatingAssignment[]> {
    const s = { userId, weddingId };
    await this.authorized(s);
    const table = await this.executor.execute<{
      id: string;
    }>(sql`select ${seatingTables.id} as "id" from ${seatingTables}
      where ${seatingTables.weddingId} = ${weddingId} and ${seatingTables.id} = ${tableId} and ${member(s)} limit 1`);
    if (!table.rows[0]) throw new NotFoundError("Table not found");
    const result = await this.executor.execute<{
      guestId: string;
      guestName: string;
      partySize: number;
      tableId: string;
    }>(
      sql`select ${guests.id} as "guestId", ${guests.name} as "guestName",
        ${guests.allowedPartySize} as "partySize", ${seatingAssignments.tableId} as "tableId"
        from ${seatingAssignments} inner join ${guests}
          on ${guests.weddingId} = ${seatingAssignments.weddingId}
          and ${guests.id} = ${seatingAssignments.guestId}
        where ${seatingAssignments.weddingId} = ${weddingId}
          and ${seatingAssignments.tableId} = ${tableId} and ${member(s)}
        order by ${guests.name}, ${guests.id} limit 101`,
    );
    return result.rows;
  }

  async assignSeating(
    userId: string,
    weddingId: string,
    guestId: string,
    tableId: string | null,
  ): Promise<void> {
    const s = { userId, weddingId };
    await this.authorized(s);
    await this.executor.transaction(async (tx) => {
      // Lock the guest before any table: concurrent assignments of one party serialize.
      const guest = await tx.execute<{
        party_size: number;
        archived_at: string | null;
        attendance: "attending" | "declined" | null;
      }>(
        sql`select ${guests.allowedPartySize} as "party_size", ${guests.archivedAt} as "archived_at",
          ${rsvps.attendance} as "attendance"
          from ${guests} left join ${rsvps} on ${rsvps.weddingId} = ${guests.weddingId}
            and ${rsvps.guestId} = ${guests.id}
          where ${guests.weddingId} = ${weddingId} and ${guests.id} = ${guestId}
          and ${member(s)} for update of ${guests}`,
      );
      if (!guest.rows[0]) throw new NotFoundError("Guest not found");
      if (tableId && guest.rows[0].archived_at)
        throw new ConflictError("Archived guests cannot be assigned");
      if (tableId && guest.rows[0].attendance === "declined")
        throw new ConflictError("Guests who declined cannot be assigned");
      const prior = await tx.execute<{
        table_id: string;
      }>(sql`select ${seatingAssignments.tableId} as "table_id"
        from ${seatingAssignments} where ${seatingAssignments.weddingId} = ${weddingId}
        and ${seatingAssignments.guestId} = ${guestId}`);
      const oldTableId = prior.rows[0]?.table_id ?? null;
      if (oldTableId === tableId) return;
      for (const lockedId of [
        ...new Set([oldTableId, tableId].filter((v): v is string => !!v)),
      ].sort()) {
        const locked = await tx.execute<{
          capacity: number;
        }>(sql`select ${seatingTables.capacity} as "capacity"
          from ${seatingTables} where ${seatingTables.weddingId} = ${weddingId}
          and ${seatingTables.id} = ${lockedId} and ${member(s)} for update`);
        if (!locked.rows[0]) throw new NotFoundError("Table not found");
        if (lockedId === tableId) {
          const usage = await tx.execute<{ reserved: number }>(
            seatUsageQuery({ ...s, tableId: lockedId }),
          );
          if (
            usage.rows[0]!.reserved + guest.rows[0].party_size >
            locked.rows[0].capacity
          )
            throw new ConflictError(
              "This table does not have enough seats for the guest party",
            );
        }
      }
      if (tableId)
        await tx.execute(sql`insert into ${seatingAssignments} (wedding_id,guest_id,table_id)
          values (${weddingId},${guestId},${tableId})
          on conflict (wedding_id,guest_id) do update set table_id = excluded.table_id`);
      else if (oldTableId)
        await tx.execute(sql`delete from ${seatingAssignments}
          where ${seatingAssignments.weddingId} = ${weddingId}
          and ${seatingAssignments.guestId} = ${guestId}`);
    });
  }
}
