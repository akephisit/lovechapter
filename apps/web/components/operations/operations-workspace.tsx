"use client";

import type {
  BudgetCategory,
  Expense,
  GuestSummary,
  RunSheetItem,
  SeatingTable,
  Vendor,
  WeddingSummary,
} from "@lovechapter/contracts";
import {
  currencyDigits,
  parseMoney,
  resolveWeddingLocalTime,
} from "@lovechapter/domain";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import type { createLoveChapterApi } from "../../lib/api-client";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";

export type OperationsWorkspaceApi = Pick<
  ReturnType<typeof createLoveChapterApi>,
  | "getBudgetOverview"
  | "setBudget"
  | "listBudgetCategories"
  | "saveBudgetCategory"
  | "deleteBudgetCategory"
  | "listVendors"
  | "saveVendor"
  | "deleteVendor"
  | "listExpenses"
  | "saveExpense"
  | "deleteExpense"
  | "listRunSheet"
  | "saveRunSheetItem"
  | "deleteRunSheetItem"
  | "listSeatingTables"
  | "saveSeatingTable"
  | "deleteSeatingTable"
  | "listSeatingAssignments"
  | "assignSeating"
  | "listGuests"
>;

type Wedding = Pick<WeddingSummary, "id" | "name" | "locale" | "timeZone">;
type Props = { wedding: Wedding; api: OperationsWorkspaceApi };

export function OperationsWorkspace({ wedding, api }: Props) {
  const [tab, setTab] = useState<"budget" | "schedule" | "seating">("budget");
  return (
    <section aria-label="Wedding operations" className="space-y-4">
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Operations sections"
      >
        <Button
          type="button"
          variant={tab === "budget" ? "primary" : "ghost"}
          onClick={() => setTab("budget")}
        >
          Budget & vendors
        </Button>
        <Button
          type="button"
          variant={tab === "schedule" ? "primary" : "ghost"}
          onClick={() => setTab("schedule")}
        >
          Day schedule
        </Button>
        <Button
          type="button"
          variant={tab === "seating" ? "primary" : "ghost"}
          onClick={() => setTab("seating")}
        >
          Seating
        </Button>
      </div>
      {tab === "budget" ? <BudgetPanel wedding={wedding} api={api} /> : null}
      {tab === "schedule" ? (
        <RunSheetPanel wedding={wedding} api={api} />
      ) : null}
      {tab === "seating" ? <SeatingPanel wedding={wedding} api={api} /> : null}
    </section>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Please try again.";
}
function field(fields: FormData, name: string): string {
  return String(fields.get(name) ?? "").trim();
}
function optionalId(value: string): string | null {
  return value || null;
}
function moneyInput(minor: number | null, currency: string): string {
  if (minor == null) return "";
  const divisor = 10 ** currencyDigits(currency);
  return (minor / divisor).toFixed(currencyDigits(currency));
}
function moneyLabel(minor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    minor / 10 ** currencyDigits(currency),
  );
}
function Field({
  label,
  name,
  children,
}: {
  label: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      {children}
    </div>
  );
}
const inputClass = "w-full";

function BudgetPanel({ wedding, api }: Props) {
  const [overview, setOverview] = useState<Awaited<
    ReturnType<typeof api.getBudgetOverview>
  > | null>(null);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [vendorCursor, setVendorCursor] = useState<string | null>(null);
  const [expenseCursor, setExpenseCursor] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<BudgetCategory | null>(
    null,
  );
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  async function reload() {
    const request = ++generation.current;
    setLoading(true);
    try {
      const [budget, cats, supplierPage, costPage] = await Promise.all([
        api.getBudgetOverview(wedding.id),
        api.listBudgetCategories(wedding.id),
        api.listVendors(wedding.id),
        api.listExpenses(wedding.id),
      ]);
      if (request !== generation.current) return;
      setOverview(budget);
      setCategories(cats);
      setVendors(supplierPage.items);
      setExpenses(costPage.items);
      setVendorCursor(supplierPage.nextCursor);
      setExpenseCursor(costPage.nextCursor);
      setError(null);
    } catch (caught) {
      if (request === generation.current) setError(errorText(caught));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [wedding.id, api]);
  async function mutate(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
      await reload();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  async function more(kind: "vendors" | "expenses") {
    const cursor = kind === "vendors" ? vendorCursor : expenseCursor;
    if (!cursor) return;
    const current = generation.current;
    setBusy(true);
    try {
      if (kind === "vendors") {
        const page = await api.listVendors(wedding.id, cursor);
        if (current === generation.current) {
          setVendors((old) => [
            ...old,
            ...page.items.filter((item) => !old.some((v) => v.id === item.id)),
          ]);
          setVendorCursor(page.nextCursor);
        }
      } else {
        const page = await api.listExpenses(wedding.id, cursor);
        if (current === generation.current) {
          setExpenses((old) => [
            ...old,
            ...page.items.filter((item) => !old.some((v) => v.id === item.id)),
          ]);
          setExpenseCursor(page.nextCursor);
        }
      }
    } catch (caught) {
      if (current === generation.current) setError(errorText(caught));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  const currency = overview?.budget?.currency ?? null;
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="font-serif text-2xl text-[#432f35]">Budget & vendors</h2>
        <p className="text-sm text-[#725f62]">
          Costs, suppliers, and payments for {wedding.name}.
        </p>
        {loading ? <p role="status">Loading budget…</p> : null}
        {error ? (
          <p role="alert" className="text-[#9b3737]">
            {error}
          </p>
        ) : null}
        {currency && overview ? (
          <p className="text-sm">
            Planned{" "}
            {moneyLabel(overview.plannedMinor, currency, wedding.locale)} · Paid{" "}
            {moneyLabel(overview.paidMinor, currency, wedding.locale)} ·
            Remaining{" "}
            {moneyLabel(overview.remainingMinor, currency, wedding.locale)}
          </p>
        ) : (
          <p className="text-sm">
            Choose a currency before recording costs. It cannot change after
            costs exist.
          </p>
        )}
        <form
          className="grid gap-3 sm:grid-cols-3"
          key={currency ?? "unset"}
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            void mutate(() =>
              api.setBudget(wedding.id, {
                currency: field(fields, "currency").toUpperCase(),
                targetMinor: field(fields, "target")
                  ? parseMoney(
                      field(fields, "target"),
                      field(fields, "currency"),
                    )
                  : null,
              }),
            );
          }}
        >
          <Field label="Currency code" name="currency">
            <Input
              id="currency"
              name="currency"
              required
              maxLength={3}
              defaultValue={currency ?? ""}
              placeholder="USD"
              className={inputClass}
            />
          </Field>
          <Field label="Budget target" name="target">
            <Input
              id="target"
              name="target"
              inputMode="decimal"
              defaultValue={
                currency
                  ? moneyInput(overview?.budget?.targetMinor ?? null, currency)
                  : ""
              }
              className={inputClass}
            />
          </Field>
          <div className="self-end">
            <Button type="submit" disabled={busy}>
              Save budget
            </Button>
          </div>
        </form>
      </Card>
      <Card className="space-y-4 p-5 sm:p-6">
        <h3 className="font-serif text-xl">Categories</h3>
        <form
          key={editingCategory?.id ?? "new"}
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const input = {
              name: field(new FormData(event.currentTarget), "categoryName"),
            };
            void mutate(
              () =>
                api.saveBudgetCategory(
                  wedding.id,
                  editingCategory?.id ?? null,
                  input,
                ),
              () => setEditingCategory(null),
            );
          }}
        >
          <Field label="Category name" name="categoryName">
            <Input
              id="categoryName"
              name="categoryName"
              required
              defaultValue={editingCategory?.name ?? ""}
            />
          </Field>
          <Button className="self-end" type="submit" disabled={busy}>
            {editingCategory ? "Save category" : "Add category"}
          </Button>
          {editingCategory ? (
            <Button
              className="self-end"
              type="button"
              variant="ghost"
              onClick={() => setEditingCategory(null)}
            >
              Cancel
            </Button>
          ) : null}
        </form>
        <ul className="space-y-2">
          {categories.map((category) => (
            <li className="flex flex-wrap items-center gap-2" key={category.id}>
              <span>{category.name}</span>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditingCategory(category)}
              >
                Edit {category.name}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete category “${category.name}”? Expenses remain uncategorized.`,
                    )
                  )
                    void mutate(() =>
                      api.deleteBudgetCategory(wedding.id, category.id),
                    );
                }}
              >
                Delete {category.name}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-4 p-5 sm:p-6">
        <h3 className="font-serif text-xl">Vendors</h3>
        <form
          key={editingVendor?.id ?? "new"}
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            void mutate(
              () =>
                api.saveVendor(wedding.id, editingVendor?.id ?? null, {
                  name: field(values, "vendorName"),
                  status: field(values, "vendorStatus") as Vendor["status"],
                  contactName: field(values, "contactName") || null,
                  email: field(values, "vendorEmail") || null,
                  phone: field(values, "vendorPhone") || null,
                  quoteMinor:
                    currency && field(values, "vendorQuote")
                      ? parseMoney(field(values, "vendorQuote"), currency)
                      : null,
                  note: field(values, "vendorNote") || null,
                }),
              () => setEditingVendor(null),
            );
          }}
        >
          <Field label="Vendor name" name="vendorName">
            <Input
              id="vendorName"
              name="vendorName"
              required
              defaultValue={editingVendor?.name ?? ""}
            />
          </Field>
          <Field label="Booking status" name="vendorStatus">
            <Select
              id="vendorStatus"
              name="vendorStatus"
              defaultValue={editingVendor?.status ?? "researching"}
            >
              <option value="researching">Researching</option>
              <option value="contacted">Contacted</option>
              <option value="booked">Booked</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>
          <Field label="Contact name" name="contactName">
            <Input
              id="contactName"
              name="contactName"
              defaultValue={editingVendor?.contactName ?? ""}
            />
          </Field>
          <Field label="Contact email" name="vendorEmail">
            <Input
              id="vendorEmail"
              name="vendorEmail"
              type="email"
              defaultValue={editingVendor?.email ?? ""}
            />
          </Field>
          <Field label="Contact phone" name="vendorPhone">
            <Input
              id="vendorPhone"
              name="vendorPhone"
              defaultValue={editingVendor?.phone ?? ""}
            />
          </Field>
          <Field label="Quote amount" name="vendorQuote">
            <Input
              id="vendorQuote"
              name="vendorQuote"
              inputMode="decimal"
              disabled={!currency}
              defaultValue={
                currency
                  ? moneyInput(editingVendor?.quoteMinor ?? null, currency)
                  : ""
              }
            />
          </Field>
          <Field label="Vendor notes" name="vendorNote">
            <Textarea
              id="vendorNote"
              name="vendorNote"
              defaultValue={editingVendor?.note ?? ""}
            />
          </Field>
          <div className="space-x-2 self-end">
            <Button type="submit" disabled={busy}>
              {editingVendor ? "Save vendor" : "Add vendor"}
            </Button>
            {editingVendor ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditingVendor(null)}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
        {vendors.length ? (
          <ul className="space-y-2">
            {vendors.map((vendor) => (
              <li key={vendor.id} className="rounded-xl border p-3 text-sm">
                <strong>{vendor.name}</strong> · {vendor.status}
                {currency && vendor.quoteMinor != null
                  ? ` · Quote ${moneyLabel(vendor.quoteMinor, currency, wedding.locale)}`
                  : ""}
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setEditingVendor(vendor)}
                  >
                    Edit {vendor.name}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete “${vendor.name}”? Associated costs stay saved.`,
                        )
                      )
                        void mutate(() =>
                          api.deleteVendor(wedding.id, vendor.id),
                        );
                    }}
                  >
                    Delete {vendor.name}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">No vendors yet.</p>
        )}
        {vendorCursor ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void more("vendors")}
          >
            Load more vendors
          </Button>
        ) : null}
      </Card>
      <Card className="space-y-4 p-5 sm:p-6">
        <h3 className="font-serif text-xl">Expenses & payments</h3>
        {currency ? (
          <form
            key={editingExpense?.id ?? "new"}
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              void mutate(
                () =>
                  api.saveExpense(wedding.id, editingExpense?.id ?? null, {
                    title: field(values, "expenseTitle"),
                    plannedMinor: parseMoney(
                      field(values, "planned"),
                      currency,
                    ),
                    paidMinor: parseMoney(field(values, "paid"), currency),
                    categoryId: optionalId(field(values, "expenseCategory")),
                    vendorId: optionalId(field(values, "expenseVendor")),
                    dueDate: optionalId(field(values, "expenseDue")),
                    note: field(values, "expenseNote") || null,
                  }),
                () => setEditingExpense(null),
              );
            }}
          >
            <Field label="Expense title" name="expenseTitle">
              <Input
                id="expenseTitle"
                name="expenseTitle"
                required
                defaultValue={editingExpense?.title ?? ""}
              />
            </Field>
            <Field label="Category" name="expenseCategory">
              <Select
                id="expenseCategory"
                name="expenseCategory"
                defaultValue={editingExpense?.categoryId ?? ""}
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Planned amount" name="planned">
              <Input
                id="planned"
                name="planned"
                inputMode="decimal"
                required
                defaultValue={moneyInput(
                  editingExpense?.plannedMinor ?? null,
                  currency,
                )}
              />
            </Field>
            <Field label="Paid amount" name="paid">
              <Input
                id="paid"
                name="paid"
                inputMode="decimal"
                required
                defaultValue={moneyInput(
                  editingExpense?.paidMinor ?? 0,
                  currency,
                )}
              />
            </Field>
            <Field label="Vendor" name="expenseVendor">
              <Select
                id="expenseVendor"
                name="expenseVendor"
                defaultValue={editingExpense?.vendorId ?? ""}
              >
                <option value="">No vendor</option>
                {vendors.map((v) => (
                  <option value={v.id} key={v.id}>
                    {v.name}
                  </option>
                ))}
                {editingExpense?.vendorId &&
                !vendors.some(
                  (vendor) => vendor.id === editingExpense.vendorId,
                ) ? (
                  <option value={editingExpense.vendorId}>
                    Linked vendor (load more vendors to see the name)
                  </option>
                ) : null}
              </Select>
            </Field>
            <Field label="Payment due date" name="expenseDue">
              <Input
                id="expenseDue"
                name="expenseDue"
                type="date"
                defaultValue={editingExpense?.dueDate ?? ""}
              />
            </Field>
            <Field label="Expense notes" name="expenseNote">
              <Textarea
                id="expenseNote"
                name="expenseNote"
                defaultValue={editingExpense?.note ?? ""}
              />
            </Field>
            <div className="space-x-2 self-end">
              <Button type="submit" disabled={busy}>
                {editingExpense ? "Save expense" : "Add expense"}
              </Button>
              {editingExpense ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditingExpense(null)}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <p className="text-sm">Set a currency to record expenses.</p>
        )}
        {expenses.length && currency ? (
          <ul className="space-y-2">
            {expenses.map((expense) => (
              <li key={expense.id} className="rounded-xl border p-3 text-sm">
                <strong>{expense.title}</strong> · planned{" "}
                {moneyLabel(expense.plannedMinor, currency, wedding.locale)}
                {" · "}paid{" "}
                {moneyLabel(expense.paidMinor, currency, wedding.locale)}
                {expense.dueDate ? ` · due ${expense.dueDate}` : ""}
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setEditingExpense(expense)}
                  >
                    Edit {expense.title}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete expense “${expense.title}”?`))
                        void mutate(() =>
                          api.deleteExpense(wedding.id, expense.id),
                        );
                    }}
                  >
                    Delete {expense.title}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">No expenses yet.</p>
        )}
        {expenseCursor ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void more("expenses")}
          >
            Load more expenses
          </Button>
        ) : null}
      </Card>
    </div>
  );
}

function localValue(instant: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function RunSheetPanel({ wedding, api }: Props) {
  const [items, setItems] = useState<RunSheetItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [editing, setEditing] = useState<RunSheetItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  async function reload() {
    const current = ++generation.current;
    setLoading(true);
    try {
      const page = await api.listRunSheet(wedding.id);
      if (current === generation.current) {
        setItems(page.items);
        setCursor(page.nextCursor);
        setError(null);
      }
    } catch (caught) {
      if (current === generation.current) setError(errorText(caught));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [wedding.id, api]);
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditing(null);
      await reload();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <h2 className="font-serif text-2xl">Day schedule</h2>
      <p className="text-sm">
        Private run sheet · times shown in {wedding.timeZone}. Guests do not see
        this schedule.
      </p>
      {error ? (
        <p role="alert" className="text-[#9b3737]">
          {error}
        </p>
      ) : null}
      <form
        key={editing?.id ?? "new"}
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          try {
            const input = {
              title: field(values, "scheduleTitle"),
              startsAt: resolveWeddingLocalTime(
                field(values, "start"),
                wedding.timeZone,
              ),
              endsAt: resolveWeddingLocalTime(
                field(values, "end"),
                wedding.timeZone,
              ),
              location: field(values, "location") || null,
              responsible: field(values, "responsible") || null,
              note: field(values, "scheduleNote") || null,
            };
            void mutate(() =>
              api.saveRunSheetItem(wedding.id, editing?.id ?? null, input),
            );
          } catch (caught) {
            setError(errorText(caught));
          }
        }}
      >
        <Field label="Schedule title" name="scheduleTitle">
          <Input
            id="scheduleTitle"
            name="scheduleTitle"
            required
            defaultValue={editing?.title ?? ""}
          />
        </Field>
        <Field label="Location" name="location">
          <Input
            id="location"
            name="location"
            defaultValue={editing?.location ?? ""}
          />
        </Field>
        <Field label="Start (wedding time)" name="start">
          <Input
            id="start"
            name="start"
            type="datetime-local"
            required
            defaultValue={
              editing ? localValue(editing.startsAt, wedding.timeZone) : ""
            }
          />
        </Field>
        <Field label="End (wedding time)" name="end">
          <Input
            id="end"
            name="end"
            type="datetime-local"
            required
            defaultValue={
              editing ? localValue(editing.endsAt, wedding.timeZone) : ""
            }
          />
        </Field>
        <Field label="Responsible person" name="responsible">
          <Input
            id="responsible"
            name="responsible"
            defaultValue={editing?.responsible ?? ""}
          />
        </Field>
        <Field label="Private notes" name="scheduleNote">
          <Textarea
            id="scheduleNote"
            name="scheduleNote"
            defaultValue={editing?.note ?? ""}
          />
        </Field>
        <div className="space-x-2">
          <Button type="submit" disabled={busy}>
            {editing ? "Save schedule item" : "Add schedule item"}
          </Button>
          {editing ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
      {loading ? <p role="status">Loading schedule…</p> : null}
      {items.length ? (
        <ol className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border p-3">
              <strong>{item.title}</strong> ·{" "}
              {localValue(item.startsAt, wedding.timeZone).replace("T", " ")}–
              {localValue(item.endsAt, wedding.timeZone).replace("T", " ")}
              {item.location ? ` · ${item.location}` : ""}
              {item.responsible ? ` · ${item.responsible}` : ""}
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditing(item)}
                >
                  Edit {item.title}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete “${item.title}” from the run sheet?`,
                      )
                    )
                      void mutate(() =>
                        api.deleteRunSheetItem(wedding.id, item.id),
                      );
                  }}
                >
                  Delete {item.title}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm">No schedule items yet.</p>
      )}
      {cursor ? (
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            const current = generation.current;
            setBusy(true);
            try {
              const page = await api.listRunSheet(wedding.id, cursor);
              if (current === generation.current) {
                setItems((old) => [
                  ...old,
                  ...page.items.filter((i) => !old.some((x) => x.id === i.id)),
                ]);
                setCursor(page.nextCursor);
              }
            } catch (caught) {
              if (current === generation.current) setError(errorText(caught));
            } finally {
              if (current === generation.current) setBusy(false);
            }
          }}
        >
          Load more schedule items
        </Button>
      ) : null}
    </Card>
  );
}

function SeatingPanel({ wedding, api }: Props) {
  const [tables, setTables] = useState<SeatingTable[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<
    Awaited<ReturnType<typeof api.listSeatingAssignments>>
  >([]);
  const [candidates, setCandidates] = useState<GuestSummary[]>([]);
  const [candidateCursor, setCandidateCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<SeatingTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  async function reload(selection = selected) {
    const current = ++generation.current;
    setLoading(true);
    try {
      const list = await api.listSeatingTables(wedding.id);
      const tableId =
        selection && list.some((table) => table.id === selection)
          ? selection
          : (list[0]?.id ?? null);
      const assigned = tableId
        ? await api.listSeatingAssignments(wedding.id, tableId)
        : [];
      if (current !== generation.current) return;
      setTables(list);
      setSelected(tableId);
      setAssignments(assigned);
      setError(null);
    } catch (caught) {
      if (current === generation.current) setError(errorText(caught));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void reload(null);
    return () => {
      generation.current += 1;
    };
  }, [wedding.id, api]);
  async function mutate(
    action: () => Promise<unknown>,
    nextSelection = selected,
  ) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditing(null);
      await reload(nextSelection);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  async function findGuests(value: string, cursor?: string) {
    const current = generation.current;
    setBusy(true);
    try {
      const page = await api.listGuests(wedding.id, {
        limit: 20,
        view: "active",
        ...(value ? { search: value } : {}),
        ...(cursor ? { cursor } : {}),
      });
      if (current === generation.current) {
        setCandidates((old) =>
          cursor
            ? [
                ...old,
                ...page.items.filter(
                  (guest) => !old.some((x) => x.id === guest.id),
                ),
              ]
            : page.items,
        );
        setCandidateCursor(page.nextCursor);
      }
    } catch (caught) {
      if (current === generation.current) setError(errorText(caught));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <h2 className="font-serif text-2xl">Seating</h2>
      <p className="text-sm">
        Seat each invited party together. Reserved seats use their allowed party
        size. Unassign before changing that size.
      </p>
      {error ? (
        <p role="alert" className="text-[#9b3737]">
          {error}
        </p>
      ) : null}
      <form
        key={editing?.id ?? "new"}
        className="flex flex-wrap gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void mutate(
            () =>
              api.saveSeatingTable(wedding.id, editing?.id ?? null, {
                name: field(values, "tableName"),
                capacity: Number(field(values, "capacity")),
              }),
            editing?.id ?? null,
          );
        }}
      >
        <Field label="Table name" name="tableName">
          <Input
            id="tableName"
            name="tableName"
            required
            defaultValue={editing?.name ?? ""}
          />
        </Field>
        <Field label="Table capacity" name="capacity">
          <Input
            id="capacity"
            name="capacity"
            type="number"
            min={1}
            max={100}
            required
            defaultValue={editing?.capacity ?? 8}
          />
        </Field>
        <Button className="self-end" type="submit" disabled={busy}>
          {editing ? "Save table" : "Add table"}
        </Button>
        {editing ? (
          <Button
            className="self-end"
            type="button"
            variant="ghost"
            onClick={() => setEditing(null)}
          >
            Cancel
          </Button>
        ) : null}
      </form>
      {loading ? <p role="status">Loading tables…</p> : null}
      {tables.length ? (
        <div className="flex flex-wrap gap-2">
          {tables.map((table) => (
            <Button
              key={table.id}
              type="button"
              variant={selected === table.id ? "primary" : "ghost"}
              onClick={() => void reload(table.id)}
            >
              {table.name} · {table.reserved}/{table.capacity}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-sm">No tables yet.</p>
      )}
      {selected ? (
        <>
          <p className="text-sm">
            {tables.find((table) => table.id === selected)!.capacity -
              tables.find((table) => table.id === selected)!.reserved}{" "}
            seats remaining at this table
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setEditing(tables.find((t) => t.id === selected) ?? null)
              }
            >
              Edit selected table
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Delete this table and remove its guest assignments?",
                  )
                )
                  void mutate(
                    () => api.deleteSeatingTable(wedding.id, selected),
                    null,
                  );
              }}
            >
              Delete selected table
            </Button>
          </div>
          <h3 className="font-serif text-xl">Assigned parties</h3>
          {assignments.length ? (
            <ul className="space-y-2">
              {assignments.map((party) => (
                <li
                  key={party.guestId}
                  className="flex flex-wrap items-center gap-2"
                >
                  {party.guestName} · {party.partySize} seats
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void mutate(() =>
                        api.assignSeating(wedding.id, party.guestId, null),
                      )
                    }
                  >
                    Unassign {party.guestName}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">No parties at this table.</p>
          )}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void findGuests(search.trim());
            }}
          >
            <Field label="Find a guest party" name="seatSearch">
              <Input
                id="seatSearch"
                name="seatSearch"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              Search guests
            </Button>
          </form>
          {candidates.length ? (
            <ul className="space-y-2">
              {candidates.map((guest) => (
                <li
                  key={guest.id}
                  className="flex flex-wrap items-center gap-2"
                >
                  {guest.name} · up to {guest.allowedPartySize} seats
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || guest.rsvp?.attendance === "declined"}
                    onClick={() =>
                      void mutate(() =>
                        api.assignSeating(wedding.id, guest.id, selected),
                      )
                    }
                  >
                    {guest.rsvp?.attendance === "declined"
                      ? "Declined"
                      : `Assign ${guest.name}`}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {candidateCursor ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void findGuests(search.trim(), candidateCursor)}
            >
              Load more guests
            </Button>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
