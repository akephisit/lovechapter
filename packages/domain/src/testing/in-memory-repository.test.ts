import { describe, expect, it } from "vitest";

import { InMemoryLoveChapterRepository } from "./in-memory-repository";
import { NotFoundError } from "../errors";

describe("InMemoryLoveChapterRepository user profiles", () => {
  it("keeps development users usable and requires external onboarding", async () => {
    const repository = new InMemoryLoveChapterRepository();

    const developmentUser = await repository.syncUser({
      provider: "development",
      subject: "local-user",
      displayName: "Local couple",
    });
    const externalUser = await repository.syncUser({
      provider: "external",
      subject: "external-user",
      displayName: "couple@example.test",
      email: "couple@example.test",
    });

    expect(developmentUser.onboardingComplete).toBe(true);
    expect(externalUser.onboardingComplete).toBe(false);
  });

  it("refreshes verified email without replacing the local display name", async () => {
    const repository = new InMemoryLoveChapterRepository();
    await repository.syncUser({
      provider: "external",
      subject: "external-user",
      displayName: "Chosen name",
      email: "old@example.test",
    });

    const synchronized = await repository.syncUser({
      provider: "external",
      subject: "external-user",
      displayName: "new@example.test",
      email: "new@example.test",
    });

    expect(synchronized).toMatchObject({
      displayName: "Chosen name",
      email: "new@example.test",
    });
  });

  it("completes onboarding when the resolved user updates their profile", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const user = await repository.syncUser({
      provider: "external",
      subject: "external-user",
      displayName: "couple@example.test",
      email: "couple@example.test",
    });

    await expect(
      repository.updateUserProfile(user.id, { displayName: "คู่รัก" }),
    ).resolves.toMatchObject({
      id: user.id,
      displayName: "คู่รัก",
      onboardingComplete: true,
    });
  });
});

describe("InMemoryLoveChapterRepository guest bulk actions", () => {
  it("validates the complete guest set before changing any record", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const user = await repository.syncUser({
      provider: "development",
      subject: "owner",
      displayName: "Owner",
    });
    const wedding = await repository.createWedding(
      user.id,
      crypto.randomUUID(),
      {
        name: "Wedding",
        timeZone: "UTC",
        locale: "en",
      },
    );
    const guest = await repository.createGuest(
      user.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Nok", allowedPartySize: 1 },
    );

    await expect(
      repository.bulkArchiveGuests(user.id, wedding.id, [
        guest.id,
        crypto.randomUUID(),
      ]),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      repository.getGuest(user.id, wedding.id, guest.id),
    ).resolves.not.toHaveProperty("archivedAt");
  });
});

describe("InMemoryLoveChapterRepository RSVP summary", () => {
  it("counts active guest parties by latest response and rejects a nonmember", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const owner = await repository.syncUser({
      provider: "development",
      subject: "summary-owner",
      displayName: "Owner",
    });
    const outsider = await repository.syncUser({
      provider: "development",
      subject: "summary-outsider",
      displayName: "Outsider",
    });
    const wedding = await repository.createWedding(
      owner.id,
      crypto.randomUUID(),
      { name: "Wedding", timeZone: "UTC", locale: "en" },
    );
    await expect(
      repository.getRsvpSummary(owner.id, wedding.id),
    ).resolves.toEqual({
      totalActive: 0,
      attending: 0,
      declined: 0,
      replied: 0,
      awaiting: 0,
    });
    const attending = await repository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Attending party", allowedPartySize: 3 },
    );
    await repository.createGuest(owner.id, wedding.id, crypto.randomUUID(), {
      name: "Awaiting party",
      allowedPartySize: 1,
    });
    const archived = await repository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Archived party", allowedPartySize: 1 },
    );
    for (const guest of [attending, archived]) {
      await repository.createInvitation({
        id: crypto.randomUUID(),
        weddingId: wedding.id,
        guestId: guest.id,
        createdByUserId: owner.id,
        tokenHash: guest.id,
      });
      await repository.upsertRsvp(guest.id, crypto.randomUUID(), {
        attendance: "attending",
        partySize: 1,
      });
    }
    await repository.archiveGuest(owner.id, wedding.id, archived.id);
    await expect(
      repository.getRsvpSummary(owner.id, wedding.id),
    ).resolves.toEqual({
      totalActive: 2,
      attending: 1,
      declined: 0,
      replied: 1,
      awaiting: 1,
    });
    await repository.upsertRsvp(attending.id, crypto.randomUUID(), {
      attendance: "declined",
      partySize: 0,
    });
    await expect(
      repository.getRsvpSummary(owner.id, wedding.id),
    ).resolves.toEqual({
      totalActive: 2,
      attending: 0,
      declined: 1,
      replied: 1,
      awaiting: 1,
    });
    await expect(
      repository.getRsvpSummary(outsider.id, wedding.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
