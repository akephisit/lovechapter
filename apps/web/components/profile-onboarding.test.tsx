// @vitest-environment jsdom

import type { AuthenticatedUser } from "@lovechapter/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("allows a one-character Unicode display name", async () => {
    const updated = userFixture("李", true);
    const api: ProfileOnboardingApi = {
      updateMyProfile: vi.fn(async () => updated),
    };
    const user = userEvent.setup();

    render(
      <ProfileOnboarding
        suggestedDisplayName="Couple"
        api={api}
        onComplete={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: /display name/i });
    expect(input).toHaveAttribute("minlength", "1");
    await user.clear(input);
    await user.type(input, "李");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(api.updateMyProfile).toHaveBeenCalledWith({ displayName: "李" });
  });

  it("counts non-BMP display names by Unicode code point", async () => {
    const displayName = "😀".repeat(120);
    const api: ProfileOnboardingApi = {
      updateMyProfile: vi.fn(async () => userFixture(displayName, true)),
    };
    const user = userEvent.setup();

    render(
      <ProfileOnboarding
        suggestedDisplayName="Couple"
        api={api}
        onComplete={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: /display name/i });
    expect(input).not.toHaveAttribute("maxlength");
    fireEvent.change(input, { target: { value: displayName } });
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(api.updateMyProfile).toHaveBeenCalledWith({ displayName });
  });

  it("rejects display names over 120 Unicode code points before requesting", async () => {
    const api: ProfileOnboardingApi = { updateMyProfile: vi.fn() };
    const user = userEvent.setup();

    render(
      <ProfileOnboarding
        suggestedDisplayName="Couple"
        api={api}
        onComplete={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /display name/i }), {
      target: { value: "😀".repeat(121) },
    });
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(api.updateMyProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Display name must be 1–120 characters",
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
