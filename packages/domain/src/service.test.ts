import { describe, expect, it, vi } from "vitest";

import type { IdentityProvider, Principal } from "./identity";
import {
  DomainValidationError,
  ConflictError,
  NotFoundError,
  OnboardingRequiredError,
} from "./errors";
import { LoveChapterService } from "./service";
import { InMemoryLoveChapterRepository } from "./testing/in-memory-repository";
import { InMemoryGuestImportRepository } from "./testing/in-memory-guest-import-repository";

const couple: Principal = {
  provider: "development",
  subject: "couple-1",
  displayName: "Mali & Arun",
  email: "couple@example.test",
};

const otherCouple: Principal = {
  provider: "development",
  subject: "couple-2",
  displayName: "Other Couple",
};

const externalPrincipal: Principal = {
  provider: "external",
  subject: "external-user-1",
  displayName: "couple@example.test",
  email: "couple@example.test",
};

function identity(principal: Principal | null): IdentityProvider {
  return { resolve: async () => principal };
}

function service(
  repository: InMemoryLoveChapterRepository,
  principal: Principal | null = couple,
) {
  return new LoveChapterService(
    identity(principal),
    repository,
    "https://web.example.test",
  );
}

describe("LoveChapterService", () => {
  it("stages, pages, remaps and excludes guest CSV rows without inventing affiliations", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const guestImportRepository = new InMemoryGuestImportRepository(repository);
    const coupleService = new LoveChapterService(
      identity(couple),
      repository,
      "https://web.example.test",
      undefined,
      guestImportRepository,
    );
    const wedding = await coupleService.createWedding({
      name: "Import",
      timeZone: "UTC",
      locale: "en",
    });
    const preview = await coupleService.stageGuestImport(wedding.id, {
      sourceSha256: "a".repeat(64),
      headers: ["name", "affiliation"],
      rows: [
        ["Nok", "unknown"],
        ["Dao", ""],
      ],
    });
    expect(preview.totals).toMatchObject({ invalid: 1, valid: 1 });
    const changed = await coupleService.updateGuestImportMapping(
      wedding.id,
      preview.batchId,
      {
        expectedVersion: 1,
        mapping: preview.mapping,
        affiliationMappings: {},
        excludedRowIds: [preview.items[0]!.id],
      },
    );
    expect(changed).toMatchObject({
      mappingVersion: 2,
      totals: { excluded: 1, valid: 1 },
    });
    await expect(
      coupleService.updateGuestImportMapping(wedding.id, preview.batchId, {
        expectedVersion: 1,
        mapping: preview.mapping,
        affiliationMappings: {},
        excludedRowIds: [],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("commits approved import rows once and rejects a different idempotency key", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const guestImportRepository = new InMemoryGuestImportRepository(repository);
    const coupleService = new LoveChapterService(
      identity(couple),
      repository,
      "https://web.example.test",
      undefined,
      guestImportRepository,
    );
    const wedding = await coupleService.createWedding({
      name: "Commit",
      timeZone: "UTC",
      locale: "en",
    });
    const preview = await coupleService.stageGuestImport(wedding.id, {
      sourceSha256: "b".repeat(64),
      headers: ["name"],
      rows: [["Nok"]],
    });
    const input = {
      expectedVersion: preview.mappingVersion,
      includedRowIds: [preview.items[0]!.id],
      createAnywayRowIds: [],
      idempotencyKey: "import-attempt-1",
    };
    const first = await coupleService.commitGuestImport(
      wedding.id,
      preview.batchId,
      input,
    );
    const replay = await coupleService.commitGuestImport(
      wedding.id,
      preview.batchId,
      input,
    );
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ created: 1, excluded: 0 });
    await expect(
      coupleService.commitGuestImport(wedding.id, preview.batchId, {
        ...input,
        idempotencyKey: "different",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      (await coupleService.listGuests(wedding.id, { limit: 20 })).items,
    ).toHaveLength(1);
  });
  it("streams filtered CSV in bounded pages and stops after cancellation", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const coupleService = service(repository);
    const wedding = await coupleService.createWedding({
      name: "Export",
      timeZone: "UTC",
      locale: "en",
    });
    await coupleService.addGuest(wedding.id, {
      name: "คุณสมชาย",
      allowedPartySize: 1,
    });
    const stream = await coupleService.streamGuestCsv(wedding.id, {
      view: "active",
      search: "คุณ",
    });
    const reader = stream.getReader();
    const first = await reader.read();
    expect(
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(first.value),
    ).toContain("\uFEFFname,email,phone");
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toContain("คุณสมชาย");
    await reader.cancel();
  });

  it("fetches 500-row export pages only as consumed and stops at cancellation", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const coupleService = service(repository);
    const wedding = await coupleService.createWedding({
      name: "Many guests",
      timeZone: "UTC",
      locale: "en",
    });
    await Promise.all(
      Array.from({ length: 501 }, (_, index) =>
        coupleService.addGuest(wedding.id, {
          name: `Guest ${index}`,
          allowedPartySize: 1,
        }),
      ),
    );
    const fetchPage = vi.spyOn(repository, "listGuestExportPage");
    const reader = (
      await coupleService.streamGuestCsv(wedding.id, { view: "active" })
    ).getReader();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await reader.read(); // Header
    expect(fetchPage).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 500; index += 1) {
      expect((await reader.read()).done).toBe(false);
    }
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect((await reader.read()).done).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    await reader.cancel();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
  it("allows profile setup before external onboarding completes", async () => {
    const externalService = service(
      new InMemoryLoveChapterRepository(),
      externalPrincipal,
    );

    await expect(externalService.getMe()).resolves.toMatchObject({
      onboardingComplete: false,
    });
    await expect(
      externalService.updateMyProfile({ displayName: "  มะลิ & Arun  " }),
    ).resolves.toMatchObject({
      displayName: "มะลิ & Arun",
      onboardingComplete: true,
    });
  });

  it.each([
    [
      "createWedding",
      (externalService: LoveChapterService) =>
        externalService.createWedding({
          name: "Mali & Arun",
          timeZone: "UTC",
          locale: "en",
        }),
    ],
    [
      "listWeddings",
      (externalService: LoveChapterService) =>
        externalService.listWeddings({ limit: 20 }),
    ],
    [
      "addGuest",
      (externalService: LoveChapterService) =>
        externalService.addGuest(crypto.randomUUID(), {
          name: "Nok",
          allowedPartySize: 1,
        }),
    ],
    [
      "listGuests",
      (externalService: LoveChapterService) =>
        externalService.listGuests(crypto.randomUUID(), { limit: 20 }),
    ],
    [
      "createInvitation",
      (externalService: LoveChapterService) =>
        externalService.createInvitation(
          crypto.randomUUID(),
          crypto.randomUUID(),
        ),
    ],
  ] as const)("blocks %s before onboarding", async (_name, operation) => {
    const externalService = service(
      new InMemoryLoveChapterRepository(),
      externalPrincipal,
    );

    await expect(operation(externalService)).rejects.toBeInstanceOf(
      OnboardingRequiredError,
    );
  });

  it.each(["", "   ", "a".repeat(121)])(
    "rejects an invalid display name: %j",
    async (displayName) => {
      await expect(
        service(
          new InMemoryLoveChapterRepository(),
          externalPrincipal,
        ).updateMyProfile({ displayName }),
      ).rejects.toBeInstanceOf(DomainValidationError);
    },
  );

  it("runs the Couple → Wedding → Guest → Invitation → RSVP flow", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const coupleService = service(repository);

    const wedding = await coupleService.createWedding({
      name: "  Mali & Arun  ",
      weddingDate: "2027-02-14",
      timeZone: "Asia/Bangkok",
      locale: "en",
    });
    const guest = await coupleService.addGuest(wedding.id, {
      name: "  Nok  ",
      allowedPartySize: 2,
    });
    const invitation = await coupleService.createInvitation(
      wedding.id,
      guest.id,
    );

    expect(wedding.name).toBe("Mali & Arun");
    expect(guest.name).toBe("Nok");
    expect(invitation.publicUrl).toBe(
      `https://web.example.test/i/${invitation.token}`,
    );
    expect(repository.persistedInvitation(invitation.id)?.tokenHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(
      JSON.stringify(repository.persistedInvitation(invitation.id)),
    ).not.toContain(invitation.token);

    const publicInvitation = await coupleService.getPublicInvitation(
      invitation.token,
    );
    expect(publicInvitation.guest.name).toBe("Nok");
    expect(publicInvitation.rsvp).toBeNull();

    await coupleService.submitRsvp(invitation.token, {
      attendance: "attending",
      partySize: 2,
      note: " Vegetarian ",
    });
    await coupleService.submitRsvp(invitation.token, {
      attendance: "declined",
      partySize: 0,
    });

    const guests = await coupleService.listGuests(wedding.id, { limit: 20 });
    expect(guests.items).toHaveLength(1);
    expect(guests.items[0]?.rsvp).toMatchObject({
      attendance: "declined",
      partySize: 0,
    });
  });

  it("does not reveal another Couple's wedding", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const wedding = await service(repository).createWedding({
      name: "Private Wedding",
      timeZone: "UTC",
      locale: "en",
    });

    await expect(
      service(repository, otherCouple).listGuests(wedding.id, { limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("normalizes optional guest details and distinguishes omitted from removed address", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const coupleService = service(repository);
    const wedding = await coupleService.createWedding({
      name: "Mali & Arun",
      timeZone: "UTC",
      locale: "en",
    });
    const guest = await coupleService.addGuest(wedding.id, {
      name: ` ${"ก".repeat(120)} `,
      email: `${"a".repeat(307)}@example.test`,
      phone: "1".repeat(40),
      allowedPartySize: 2,
      envelopeName: "ซอง",
      note: "n".repeat(2_000),
      postalAddress: {
        addressLine1: "1".repeat(180),
        addressLine2: "2".repeat(180),
        locality: "l".repeat(120),
        administrativeArea: "a".repeat(120),
        postalCode: "p".repeat(32),
        countryCode: "th",
      },
    });

    await coupleService.updateGuest(wedding.id, guest.id, {
      phone: "   ",
      envelopeName: " คุณสมชายและครอบครัว ",
      note: "  Vegetarian table  ",
    });
    expect(repository.lastGuestUpdate).toMatchObject({
      phone: null,
      envelopeName: "คุณสมชายและครอบครัว",
      note: "Vegetarian table",
    });
    expect(repository.lastGuestUpdate).not.toHaveProperty("postalAddress");
    await expect(
      coupleService.getGuest(wedding.id, guest.id),
    ).resolves.toMatchObject({
      postalAddress: { countryCode: "TH" },
    });

    await coupleService.updateGuest(wedding.id, guest.id, {
      postalAddress: null,
    });
    expect(repository.lastGuestUpdate).toMatchObject({ postalAddress: null });
    await expect(
      coupleService.getGuest(wedding.id, guest.id),
    ).resolves.toMatchObject({ postalAddress: null });
  });

  it.each([
    ["name", { name: "x".repeat(121) }],
    ["email", { email: `${"a".repeat(308)}@example.test` }],
    ["phone", { phone: "1".repeat(41) }],
    ["envelope name", { envelopeName: "x".repeat(181) }],
    ["note", { note: "x".repeat(2_001) }],
    ["address line", { postalAddress: { addressLine1: "x".repeat(181) } }],
    [
      "address locality",
      { postalAddress: { addressLine1: "1", locality: "x".repeat(121) } },
    ],
    [
      "administrative area",
      {
        postalAddress: {
          addressLine1: "1",
          administrativeArea: "x".repeat(121),
        },
      },
    ],
    [
      "postal code",
      { postalAddress: { addressLine1: "1", postalCode: "x".repeat(33) } },
    ],
    [
      "country code",
      { postalAddress: { addressLine1: "1", countryCode: "THA" } },
    ],
  ] as const)("rejects an over-limit guest %s", async (_field, invalid) => {
    const repository = new InMemoryLoveChapterRepository();
    const coupleService = service(repository);
    const wedding = await coupleService.createWedding({
      name: "Mali & Arun",
      timeZone: "UTC",
      locale: "en",
    });

    await expect(
      coupleService.addGuest(wedding.id, {
        name: "Nok",
        allowedPartySize: 1,
        ...invalid,
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("rejects invalid, duplicate, empty, and oversized bulk guest selections", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const coupleService = service(repository);
    const wedding = await coupleService.createWedding({
      name: "Mali & Arun",
      timeZone: "UTC",
      locale: "en",
    });
    const guestId = crypto.randomUUID();

    await expect(
      coupleService.bulkArchiveGuests(wedding.id, []),
    ).rejects.toThrow("Bulk guest actions accept 1–200 unique guests");
    await expect(
      coupleService.bulkArchiveGuests(wedding.id, [guestId, guestId]),
    ).rejects.toThrow("Bulk guest actions accept 1–200 unique guests");
    await expect(
      coupleService.bulkArchiveGuests(wedding.id, ["not-a-uuid"]),
    ).rejects.toThrow("Bulk guest actions accept 1–200 unique guests");
    await expect(
      coupleService.bulkArchiveGuests(
        wedding.id,
        Array.from({ length: 201 }, () => crypto.randomUUID()),
      ),
    ).rejects.toThrow("Bulk guest actions accept 1–200 unique guests");
  });

  it("revokes an archived guest invitation and does not revive it on restore", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const coupleService = service(repository);
    const wedding = await coupleService.createWedding({
      name: "Mali & Arun",
      timeZone: "UTC",
      locale: "en",
    });
    const guest = await coupleService.addGuest(wedding.id, {
      name: "Nok",
      allowedPartySize: 1,
    });
    const invitation = await coupleService.createInvitation(
      wedding.id,
      guest.id,
    );

    await coupleService.archiveGuest(wedding.id, guest.id);
    await expect(
      coupleService.getPublicInvitation(invitation.token),
    ).rejects.toBeInstanceOf(NotFoundError);
    await coupleService.restoreGuest(wedding.id, guest.id);
    await expect(
      coupleService.getPublicInvitation(invitation.token),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("assigns existing guests only to affiliations from the same wedding", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const coupleService = service(repository);
    const first = await coupleService.createWedding({
      name: "First",
      timeZone: "UTC",
      locale: "en",
    });
    const second = await coupleService.createWedding({
      name: "Second",
      timeZone: "UTC",
      locale: "en",
    });
    const affiliation = await coupleService.createGuestAffiliation(first.id, {
      name: "Family",
      color: "#a855f7",
    });
    const guest = await coupleService.addGuest(second.id, {
      name: "Nok",
      allowedPartySize: 1,
    });

    await expect(
      coupleService.setGuestAffiliation(second.id, guest.id, affiliation.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      coupleService.setGuestAffiliation(second.id, guest.id, null),
    ).resolves.toMatchObject({ id: guest.id, affiliation: null });
  });

  it("limits each wedding to 100 guest affiliations", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const coupleService = service(repository);
    const wedding = await coupleService.createWedding({
      name: "Mali & Arun",
      timeZone: "UTC",
      locale: "en",
    });

    for (let index = 0; index < 100; index += 1) {
      await coupleService.createGuestAffiliation(wedding.id, {
        name: `Affiliation ${index}`,
        color: "#a855f7",
      });
    }

    await expect(
      coupleService.createGuestAffiliation(wedding.id, {
        name: "One too many",
        color: "#a855f7",
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("rejects an expired invitation without disclosing guest data", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const coupleService = service(repository);
    const wedding = await coupleService.createWedding({
      name: "Mali & Arun",
      timeZone: "UTC",
      locale: "en",
    });
    const guest = await coupleService.addGuest(wedding.id, {
      name: "Nok",
      allowedPartySize: 1,
    });
    const invitation = await coupleService.createInvitation(
      wedding.id,
      guest.id,
    );
    repository.expireInvitation(invitation.id);

    await expect(
      coupleService.getPublicInvitation(invitation.token),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      coupleService.submitRsvp(invitation.token, {
        attendance: "attending",
        partySize: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("paginates tied timestamps with the id tie-breaker", async () => {
    const repository = new InMemoryLoveChapterRepository({
      now: () => new Date("2026-09-21T10:00:00.000Z"),
    });
    const coupleService = service(repository);
    await coupleService.createWedding({
      name: "A",
      timeZone: "UTC",
      locale: "en",
    });
    await coupleService.createWedding({
      name: "B",
      timeZone: "UTC",
      locale: "en",
    });
    await coupleService.createWedding({
      name: "C",
      timeZone: "UTC",
      locale: "en",
    });

    const first = await coupleService.listWeddings({ limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    if (!first.nextCursor) throw new Error("Expected a second page cursor");
    const second = await coupleService.listWeddings({
      limit: 2,
      cursor: first.nextCursor,
    });

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(3);
  });
});
