import { describe, expect, it } from "vitest";

import type { IdentityProvider, Principal } from "./identity";
import {
  DomainValidationError,
  NotFoundError,
  OnboardingRequiredError,
} from "./errors";
import { LoveChapterService } from "./service";
import { InMemoryLoveChapterRepository } from "./testing/in-memory-repository";

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
