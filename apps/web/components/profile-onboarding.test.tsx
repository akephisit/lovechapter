// @vitest-environment jsdom

import type { AuthenticatedUser } from "@lovechapter/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api-client";
import {
  ProfileOnboarding,
  type ProfileOnboardingApi,
} from "./profile-onboarding";

describe("ProfileOnboarding", () => {
  it("submits a trimmed Unicode display name through the accessible form", async () => {
    const updated = userFixture("มะลิ & Arun", true);
    const api: ProfileOnboardingApi = {
      updateMyProfile: vi.fn(async () => updated),
    };
    const onComplete = vi.fn();
    const user = userEvent.setup();

    render(
      <ProfileOnboarding
        suggestedDisplayName="คู่รัก"
        api={api}
        onComplete={onComplete}
      />,
    );

    const input = screen.getByRole("textbox", { name: /display name/i });
    expect(input).toHaveValue("คู่รัก");
    await user.clear(input);
    await user.type(input, "  มะลิ & Arun  ");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(api.updateMyProfile).toHaveBeenCalledWith({
      displayName: "มะลิ & Arun",
    });
    expect(onComplete).toHaveBeenCalledWith(updated);
  });

  it("disables submission while the profile is saving", async () => {
    const pending = deferred<AuthenticatedUser>();
    const api: ProfileOnboardingApi = {
      updateMyProfile: vi.fn(() => pending.promise),
    };
    const user = userEvent.setup();

    render(
      <ProfileOnboarding
        suggestedDisplayName="Mali"
        api={api}
        onComplete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();

    pending.resolve(userFixture("Mali", true));
  });

  it("shows the server validation message", async () => {
    const api: ProfileOnboardingApi = {
      updateMyProfile: vi.fn(async () => {
        throw new ApiError("Display name is too short", 400, "invalid_input");
      }),
    };
    const user = userEvent.setup();

    render(
      <ProfileOnboarding
        suggestedDisplayName="M"
        api={api}
        onComplete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Display name is too short",
    );
  });
});

function userFixture(
  displayName: string,
  onboardingComplete: boolean,
): AuthenticatedUser {
  return {
    id: "018f0000-0000-7000-8000-000000000000",
    displayName,
    email: "one@example.test",
    onboardingComplete,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
