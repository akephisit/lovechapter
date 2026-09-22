import type { Client } from "pg";
import { describe, expect, it, vi } from "vitest";

import { createPoolConfig, withPostgresRepository } from "./client";

describe("createPoolConfig", () => {
  it("creates the approved bounded direct PostgreSQL pool configuration", () => {
    expect(
      createPoolConfig({
        DATABASE_URL:
          "postgres://lovechapter:secret@db.example.test/lovechapter",
        DATABASE_POOL_MAX: "6",
      }),
    ).toMatchObject({
      connectionString:
        "postgres://lovechapter:secret@db.example.test/lovechapter",
      max: 6,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 10_000,
    });
  });
});

describe("withPostgresRepository", () => {
  it("does not connect when an operation rejects before its first query", async () => {
    const expected = new Error("Authentication required");
    const connect = vi.fn(async () => undefined);
    const end = vi.fn(async () => undefined);
    const createClient = vi.fn(() => ({ connect, end }) as unknown as Client);

    await expect(
      withPostgresRepository(
        "postgres://postgres:postgres@127.0.0.1:1/lovechapter",
        async () => {
          throw expected;
        },
        createClient,
      ),
    ).rejects.toBe(expected);

    expect(connect).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });
});
