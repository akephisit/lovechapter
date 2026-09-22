import { describe, expect, it } from "vitest";

import { InMemoryLoveChapterRepository } from "./in-memory-repository";

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
