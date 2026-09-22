// @vitest-environment jsdom

import type {
  PublicInvitation,
  RsvpResponse,
  SubmitRsvpInput,
} from "@lovechapter/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api-client";
import { PublicRsvp, type PublicRsvpApi } from "./public-rsvp";

describe("PublicRsvp", () => {
  it("shows the invitation and submits an accessible attending response", async () => {
    const save = vi.fn(
      async (
        _token: string,
        input: SubmitRsvpInput,
      ): Promise<RsvpResponse> => ({
        ...input,
        updatedAt: "2026-09-21T10:02:00.000Z",
      }),
    );
    const api: PublicRsvpApi = {
      getInvitation: vi.fn(async () => invitationFixture()),
      submitRsvp: save,
    };
    const user = userEvent.setup();

    render(<PublicRsvp token="safe-token" api={api} />);

    expect(
      await screen.findByRole("heading", { name: /you're invited/i }),
    ).toBeVisible();
    expect(screen.getByText("Mali & Arun")).toBeVisible();
    expect(document.body).not.toHaveTextContent("safe-token");
    await user.click(screen.getByLabelText(/joyfully accept/i));
    await user.selectOptions(screen.getByLabelText(/party size/i), "2");
    await user.type(screen.getByLabelText(/note/i), "Can't wait!");
    await user.click(screen.getByRole("button", { name: /save rsvp/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
    expect(save).toHaveBeenCalledWith("safe-token", {
      attendance: "attending",
      partySize: 2,
      note: "Can't wait!",
    });
  });

  it("shows a private unavailable state when the invitation cannot be loaded", async () => {
    const api: PublicRsvpApi = {
      getInvitation: vi.fn(async () => {
        throw new ApiError("not found", 404, "not_found");
      }),
      submitRsvp: vi.fn(),
    };

    render(<PublicRsvp token="invalid-token" api={api} />);

    expect(
      await screen.findByRole("heading", { name: /invitation unavailable/i }),
    ).toBeVisible();
    expect(screen.queryByText(/invalid-token/i)).not.toBeInTheDocument();
  });

  it("offers a retry for a transient invitation-loading failure", async () => {
    const getInvitation = vi
      .fn<PublicRsvpApi["getInvitation"]>()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(invitationFixture());
    const api: PublicRsvpApi = {
      getInvitation,
      submitRsvp: vi.fn(),
    };
    const user = userEvent.setup();

    render(<PublicRsvp token="safe-token" api={api} />);

    expect(
      await screen.findByRole("heading", { name: /couldn't open/i }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(
      await screen.findByRole("heading", { name: /you're invited/i }),
    ).toBeVisible();
    expect(getInvitation).toHaveBeenCalledTimes(2);
  });
});

function invitationFixture(): PublicInvitation {
  return {
    invitationId: "018f0000-0000-7000-8000-000000000003",
    guest: { name: "Nok", allowedPartySize: 2 },
    wedding: {
      name: "Mali & Arun",
      weddingDate: "2027-02-14",
      timeZone: "Asia/Bangkok",
      locale: "en",
    },
    rsvp: null,
  };
}
