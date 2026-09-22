import {
  ConflictError,
  decodeCursor,
  DomainValidationError,
  NotFoundError,
} from "@lovechapter/domain";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  PostgresLoveChapterRepository,
  type QueryExecutor,
} from "./repository";

class FakeExecutor implements QueryExecutor {
  private readonly results: unknown[][];
  executeCount = 0;

  constructor(...results: unknown[][]) {
    this.results = results;
  }

  async execute<T extends Record<string, unknown>>(
    _query: SQL,
  ): Promise<{ rows: T[] }> {
    this.executeCount += 1;
    return { rows: (this.results.shift() ?? []) as T[] };
  }

  async transaction<T>(
    operation: (executor: QueryExecutor) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }
}

describe("PostgresLoveChapterRepository", () => {
  it("synchronizes an external identity without exposing provider data", async () => {
    const executor = new FakeExecutor([
      {
        id: "00000000-0000-7000-8000-000000000010",
        display_name: "Mali & Arun",
        email: "couple@example.test",
        onboarding_completed_at: null,
      },
    ]);
    const repository = new PostgresLoveChapterRepository(executor);

    await expect(
      repository.syncUser({
        provider: "development",
        subject: "couple-1",
        displayName: "Mali & Arun",
        email: "couple@example.test",
      }),
    ).resolves.toEqual({
      id: "00000000-0000-7000-8000-000000000010",
      displayName: "Mali & Arun",
      email: "couple@example.test",
      onboardingComplete: true,
    });
  });

  it("requires onboarding for a newly synchronized external identity", async () => {
    const executor = new FakeExecutor([
      {
        id: "00000000-0000-7000-8000-000000000011",
        display_name: "couple@example.test",
        email: "couple@example.test",
        onboarding_completed_at: null,
      },
    ]);
    const repository = new PostgresLoveChapterRepository(executor);

    await expect(
      repository.syncUser({
        provider: "external",
        subject: "external-user",
        displayName: "couple@example.test",
        email: "couple@example.test",
      }),
    ).resolves.toMatchObject({ onboardingComplete: false });
  });

  it("updates a resolved user profile in one statement", async () => {
    const executor = new FakeExecutor([
      {
        id: "00000000-0000-7000-8000-000000000011",
        display_name: "คู่รัก",
        email: "couple@example.test",
        onboarding_completed_at: "2026-09-21T10:00:00.000Z",
      },
    ]);
    const repository = new PostgresLoveChapterRepository(executor);

    await expect(
      repository.updateUserProfile("00000000-0000-7000-8000-000000000011", {
        displayName: "คู่รัก",
      }),
    ).resolves.toEqual({
      id: "00000000-0000-7000-8000-000000000011",
      displayName: "คู่รัก",
      email: "couple@example.test",
      onboardingComplete: true,
    });
    expect(executor.executeCount).toBe(1);
  });

  it("creates the wedding and owner membership atomically", async () => {
    const executor = new FakeExecutor([
      {
        id: "00000000-0000-7000-8000-000000000020",
        name: "Mali & Arun",
        wedding_date: null,
        time_zone: "Asia/Bangkok",
        locale: "en",
        created_at: "2026-09-21T10:00:00.000Z",
      },
      [],
    ]);
    const repository = new PostgresLoveChapterRepository(executor);

    await expect(
      repository.createWedding(
        "00000000-0000-7000-8000-000000000010",
        "00000000-0000-7000-8000-000000000020",
        { name: "Mali & Arun", timeZone: "Asia/Bangkok", locale: "en" },
      ),
    ).resolves.toMatchObject({ name: "Mali & Arun", role: "owner" });
  });

  it("builds the wedding cursor from indexed membership order", async () => {
    const executor = new FakeExecutor(
      ["3", "2", "1"].map((suffix) => ({
        id: `00000000-0000-7000-8000-00000000000${suffix}`,
        name: `Wedding ${suffix}`,
        wedding_date: null,
        time_zone: "UTC",
        locale: "en",
        role: "owner",
        created_at: "2020-01-01T00:00:00.000Z",
        cursor_created_at: `2026-09-2${suffix}T10:00:00.000Z`,
      })),
    );
    const repository = new PostgresLoveChapterRepository(executor);

    const page = await repository.listWeddings(crypto.randomUUID(), {
      limit: 2,
    });

    expect(page.items).toHaveLength(2);
    expect(page.items[1]?.createdAt).toBe("2020-01-01T00:00:00.000Z");
    expect(decodeCursor(page.nextCursor ?? "")).toEqual({
      createdAt: "2026-09-22T10:00:00.000Z",
      id: "00000000-0000-7000-8000-000000000002",
    });
  });

  it("maps a bounded guest page and creates a deterministic next cursor", async () => {
    const executor = new FakeExecutor([
      guestRow("00000000-0000-7000-8000-000000000003", "attending"),
      guestRow("00000000-0000-7000-8000-000000000002", null),
      guestRow("00000000-0000-7000-8000-000000000001", null),
    ]);
    const repository = new PostgresLoveChapterRepository(executor);

    const page = await repository.listGuests(
      "00000000-0000-7000-8000-000000000010",
      "00000000-0000-7000-8000-000000000020",
      { limit: 2 },
    );

    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.rsvp).toMatchObject({
      attendance: "attending",
      partySize: 2,
    });
    expect(page.items[1]?.rsvp).toBeNull();
    expect(page.items[1]?.affiliation).toBeNull();
    expect(page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("maps ordered guest affiliations and an assigned guest", async () => {
    const affiliation = {
      id: "00000000-0000-7000-8000-000000000004",
      name: "Family",
      color: "#a855f7",
      sort_order: 0,
      created_at: "2026-09-21T09:00:00.000Z",
    };
    const repository = new PostgresLoveChapterRepository(
      new FakeExecutor(
        [{ authorized: true, ...affiliation }],
        [
          {
            ...guestRow("00000000-0000-7000-8000-000000000003", null),
            affiliation_id: affiliation.id,
            affiliation_name: affiliation.name,
            affiliation_color: affiliation.color,
            affiliation_sort_order: affiliation.sort_order,
            affiliation_created_at: affiliation.created_at,
          },
        ],
      ),
    );

    await expect(
      repository.listGuestAffiliations(
        "00000000-0000-7000-8000-000000000010",
        "00000000-0000-7000-8000-000000000020",
      ),
    ).resolves.toEqual([
      {
        id: affiliation.id,
        name: "Family",
        color: "#a855f7",
        sortOrder: 0,
        createdAt: "2026-09-21T09:00:00.000Z",
      },
    ]);

    const guests = await repository.listGuests(
      "00000000-0000-7000-8000-000000000010",
      "00000000-0000-7000-8000-000000000020",
      { limit: 20 },
    );
    expect(guests.items[0]?.affiliation).toMatchObject({
      id: affiliation.id,
      name: "Family",
    });
  });

  it("assigns an affiliation to an existing guest", async () => {
    const row = {
      ...guestRow("00000000-0000-7000-8000-000000000003", null),
      affiliation_id: "00000000-0000-7000-8000-000000000004",
      affiliation_name: "Family",
      affiliation_color: "#a855f7",
      affiliation_sort_order: 0,
      affiliation_created_at: "2026-09-21T09:00:00.000Z",
    };
    const repository = new PostgresLoveChapterRepository(
      new FakeExecutor(
        [{ wedding_id: "00000000-0000-7000-8000-000000000020" }],
        [row],
      ),
    );

    await expect(
      repository.setGuestAffiliation(
        "00000000-0000-7000-8000-000000000010",
        "00000000-0000-7000-8000-000000000020",
        row.id,
        row.affiliation_id,
      ),
    ).resolves.toMatchObject({
      id: row.id,
      affiliation: { id: row.affiliation_id, name: "Family" },
    });
  });

  it("locks affiliation scope before creating an assigned guest", async () => {
    const affiliation = {
      id: "00000000-0000-7000-8000-000000000004",
      name: "Family",
      color: "#a855f7",
      sort_order: 0,
      created_at: "2026-09-21T09:00:00.000Z",
    };
    const row = {
      ...guestRow("00000000-0000-7000-8000-000000000003", null),
      affiliation_id: affiliation.id,
      affiliation_name: affiliation.name,
      affiliation_color: affiliation.color,
      affiliation_sort_order: affiliation.sort_order,
      affiliation_created_at: affiliation.created_at,
    };
    const executor = new FakeExecutor(
      [{ wedding_id: "00000000-0000-7000-8000-000000000020" }],
      [row],
    );
    const repository = new PostgresLoveChapterRepository(executor);

    await expect(
      repository.createGuest(
        "00000000-0000-7000-8000-000000000010",
        "00000000-0000-7000-8000-000000000020",
        row.id,
        {
          name: row.name,
          allowedPartySize: row.allowed_party_size,
          affiliationId: affiliation.id,
        },
      ),
    ).resolves.toMatchObject({
      id: row.id,
      affiliation: { id: affiliation.id, name: affiliation.name },
    });
    expect(executor.executeCount).toBe(2);
  });

  it("deletes an affiliation through sequential transaction statements", async () => {
    const executor = new FakeExecutor(
      [{ wedding_id: "00000000-0000-7000-8000-000000000020" }],
      [],
      [{ id: "00000000-0000-7000-8000-000000000004" }],
    );
    const repository = new PostgresLoveChapterRepository(executor);

    await expect(
      repository.deleteGuestAffiliation(
        "00000000-0000-7000-8000-000000000010",
        "00000000-0000-7000-8000-000000000020",
        "00000000-0000-7000-8000-000000000004",
      ),
    ).resolves.toBeUndefined();
    expect(executor.executeCount).toBe(3);
  });

  it("rejects a 101st affiliation after locking the wedding scope", async () => {
    const repository = new PostgresLoveChapterRepository(
      new FakeExecutor(
        [{ wedding_id: "00000000-0000-7000-8000-000000000020" }],
        [],
      ),
    );

    await expect(
      repository.createGuestAffiliation(
        "00000000-0000-7000-8000-000000000010",
        "00000000-0000-7000-8000-000000000020",
        "00000000-0000-7000-8000-000000000004",
        { name: "Too many", color: "#a855f7" },
      ),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("returns not found when an authorization-scoped guest insert returns no row", async () => {
    const repository = new PostgresLoveChapterRepository(new FakeExecutor([]));

    await expect(
      repository.createGuest(
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        { name: "Nok", allowedPartySize: 1 },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns an authorized empty guest page in one database round trip", async () => {
    const executor = new FakeExecutor([
      {
        authorized: true,
        id: null,
        name: null,
        email: null,
        allowed_party_size: null,
        created_at: null,
        rsvp_attendance: null,
        rsvp_party_size: null,
        rsvp_note: null,
        rsvp_updated_at: null,
      },
    ]);
    const repository = new PostgresLoveChapterRepository(executor);

    await expect(
      repository.listGuests(crypto.randomUUID(), crypto.randomUUID(), {
        limit: 20,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(executor.executeCount).toBe(1);
  });

  it("rejects an unauthorized empty guest page in one database round trip", async () => {
    const executor = new FakeExecutor([]);
    const repository = new PostgresLoveChapterRepository(executor);

    await expect(
      repository.listGuests(crypto.randomUUID(), crypto.randomUUID(), {
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(executor.executeCount).toBe(1);
  });

  it("maps PostgreSQL uniqueness failure to an active-invitation conflict", async () => {
    const executor: QueryExecutor = {
      execute: async () => {
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      },
      transaction: async (operation) => operation(executor),
    };
    const repository = new PostgresLoveChapterRepository(executor);

    await expect(
      repository.createInvitation({
        id: crypto.randomUUID(),
        weddingId: crypto.randomUUID(),
        guestId: crypto.randomUUID(),
        createdByUserId: crypto.randomUUID(),
        tokenHash: "a".repeat(64),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("maps a token-scoped RSVP outcome without a second query", async () => {
    const executor = new FakeExecutor([
      {
        kind: "invalid_party_size",
        attendance: null,
        party_size: null,
        note: null,
        updated_at: null,
        allowed_party_size: 2,
      },
    ]);
    const repository = new PostgresLoveChapterRepository(executor);

    await expect(
      repository.upsertRsvp("b".repeat(64), crypto.randomUUID(), {
        attendance: "attending",
        partySize: 3,
      }),
    ).resolves.toEqual({ kind: "invalid_party_size", allowedPartySize: 2 });
  });

  it("maps the public invitation projection without exposing its token hash", async () => {
    const executor = new FakeExecutor([
      {
        invitation_id: "00000000-0000-7000-8000-000000000030",
        guest_name: "Nok",
        allowed_party_size: 2,
        wedding_name: "Mali & Arun",
        wedding_date: "2027-02-14",
        time_zone: "Asia/Bangkok",
        locale: "en",
        rsvp_attendance: null,
        rsvp_party_size: null,
        rsvp_note: null,
        rsvp_updated_at: null,
      },
    ]);
    const repository = new PostgresLoveChapterRepository(executor);

    const invitation = await repository.findPublicInvitation("c".repeat(64));

    expect(invitation).toMatchObject({
      guest: { name: "Nok", allowedPartySize: 2 },
      wedding: { name: "Mali & Arun", weddingDate: "2027-02-14" },
      rsvp: null,
    });
    expect(JSON.stringify(invitation)).not.toContain("c".repeat(64));
  });
});

function guestRow(id: string, attendance: "attending" | null) {
  return {
    id,
    name: `Guest ${id.at(-1)}`,
    email: null,
    allowed_party_size: 2,
    affiliation_id: null,
    affiliation_name: null,
    affiliation_color: null,
    affiliation_sort_order: null,
    affiliation_created_at: null,
    created_at: "2026-09-21T10:00:00.000Z",
    rsvp_attendance: attendance,
    rsvp_party_size: attendance ? 2 : null,
    rsvp_note: null,
    rsvp_updated_at: attendance ? "2026-09-21T11:00:00.000Z" : null,
  };
}
