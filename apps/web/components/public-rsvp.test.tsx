// @vitest-environment jsdom

import type {
  PublicInvitation,
  RsvpResponse,
  SubmitRsvpInput,
} from "@lovechapter/contracts";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api-client";
import { PublicRsvp, type PublicRsvpApi } from "./public-rsvp";
import { UiLanguageProvider } from "./ui-language-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("PublicRsvp", () => {
  it("relocalizes an existing load error when the UI language changes", async () => {
    const api: PublicRsvpApi = {
      getInvitation: vi.fn(async () => {
        throw new Error("offline");
      }),
      submitRsvp: vi.fn(),
    };
    const { rerender } = render(
      <UiLanguageProvider language="en">
        <PublicRsvp token="safe-token" api={api} />
      </UiLanguageProvider>,
    );
    expect(
      await screen.findByText(
        "We couldn't load this invitation. Please try again.",
      ),
    ).toBeVisible();
    rerender(
      <UiLanguageProvider language="th">
        <PublicRsvp token="safe-token" api={api} />
      </UiLanguageProvider>,
    );
    expect(
      screen.getByText("ไม่สามารถโหลดคำเชิญได้ กรุณาลองอีกครั้ง"),
    ).toBeVisible();
    expect(
      screen.queryByText("We couldn't load this invitation. Please try again."),
    ).toBeNull();
  });

  it("uses the new language when a pending invitation request later fails", async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise<PublicInvitation>((_resolve, fail) => {
      reject = fail;
    });
    const api: PublicRsvpApi = {
      getInvitation: vi.fn(() => pending),
      submitRsvp: vi.fn(),
    };
    const { rerender } = render(
      <UiLanguageProvider language="en">
        <PublicRsvp token="safe-token" api={api} />
      </UiLanguageProvider>,
    );
    rerender(
      <UiLanguageProvider language="th">
        <PublicRsvp token="safe-token" api={api} />
      </UiLanguageProvider>,
    );
    await act(async () => {
      reject(new Error("offline"));
      try {
        await pending;
      } catch {
        /* expected */
      }
    });
    expect(
      await screen.findByText("ไม่สามารถโหลดคำเชิญได้ กรุณาลองอีกครั้ง"),
    ).toBeVisible();
  });
  it("shows an unavailable invitation when the link is replaced during RSVP", async () => {
    const api: PublicRsvpApi = {
      getInvitation: vi.fn(async () => invitationFixture()),
      submitRsvp: vi.fn(async () => {
        throw new ApiError("not found", 404, "not_found");
      }),
    };
    const user = userEvent.setup();
    render(<PublicRsvp token="old-token" api={api} />);
    await screen.findByRole("heading", { name: /you're invited/i });

    await user.click(screen.getByRole("button", { name: /save rsvp/i }));

    expect(
      await screen.findByRole("heading", { name: /invitation unavailable/i }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /save rsvp/i })).toBeNull();
  });

  it("clears the saved confirmation when the guest edits their answer", async () => {
    const api: PublicRsvpApi = {
      getInvitation: vi.fn(async () => invitationFixture()),
      submitRsvp: vi.fn(async (_token, input) => ({
        ...input,
        updatedAt: "2026-09-23T10:00:00.000Z",
      })),
    };
    const user = userEvent.setup();
    render(<PublicRsvp token="safe-token" api={api} />);
    await screen.findByRole("heading", { name: /you're invited/i });

    await user.click(screen.getByRole("button", { name: /save rsvp/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
    await user.type(screen.getByLabelText(/note/i), "Changed my note");
    expect(screen.queryByRole("status")).toBeNull();

    await user.click(screen.getByRole("button", { name: /save rsvp/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
    await user.click(screen.getByLabelText(/regretfully decline/i));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not mark edits made during a pending save as saved", async () => {
    let finish!: (response: RsvpResponse) => void;
    const pending = new Promise<RsvpResponse>((resolve) => {
      finish = resolve;
    });
    const api: PublicRsvpApi = {
      getInvitation: vi.fn(async () => invitationFixture()),
      submitRsvp: vi.fn(() => pending),
    };
    const user = userEvent.setup();
    render(<PublicRsvp token="safe-token" api={api} />);
    await screen.findByRole("heading", { name: /you're invited/i });
    await user.click(screen.getByRole("button", { name: /save rsvp/i }));
    await user.type(screen.getByLabelText(/note/i), "Changed after submit");

    await act(async () => {
      finish({
        attendance: "attending",
        partySize: 1,
        updatedAt: "2026-09-23T10:00:00.000Z",
      });
      await pending;
    });

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: /save rsvp/i })).toBeEnabled();
  });
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

  it("shows Thai RSVP controls without changing the stored wedding locale or guest contract", async () => {
    window.history.replaceState(null, "", "/i/safe-token");
    const submitRsvp = vi.fn(
      async (_token: string, input: SubmitRsvpInput) => ({
        ...input,
        updatedAt: "2026-09-23T10:00:00.000Z",
      }),
    );
    render(
      <UiLanguageProvider language="th">
        <PublicRsvp
          token="safe-token"
          api={{
            getInvitation: async () => ({
              ...invitationFixture(),
              wedding: {
                ...invitationFixture().wedding,
                locale: "en-US",
                timeZone: "America/New_York",
              },
            }),
            submitRsvp,
          }}
        />
      </UiLanguageProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: /ขอเชิญคุณ/ }),
    ).toBeVisible();
    expect(screen.getByText("February 14, 2027")).toBeVisible();
    expect(screen.getByText(/America\/New_York/)).toBeVisible();
    expect(screen.getByRole("combobox", { name: "ภาษา" })).toBeVisible();
    expect(screen.queryByText("safe-token")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ส่งคำตอบ" }));
    expect(submitRsvp).toHaveBeenCalledWith("safe-token", {
      attendance: "attending",
      partySize: 1,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "บันทึกคำตอบแล้ว",
    );
    expect(window.location.pathname).toBe("/i/safe-token");
  });

  it("keeps unavailable and unexpected invitation errors in Thai", async () => {
    const unavailable = render(
      <UiLanguageProvider language="th">
        <PublicRsvp
          token="expired"
          api={{
            getInvitation: async () => {
              throw new ApiError("raw English", 410);
            },
            submitRsvp: vi.fn(),
          }}
        />
      </UiLanguageProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "คำเชิญนี้ไม่พร้อมใช้งาน" }),
    ).toBeVisible();
    unavailable.unmount();

    render(
      <UiLanguageProvider language="th">
        <PublicRsvp
          token="network"
          api={{
            getInvitation: async () => {
              throw new ApiError("raw English", 500);
            },
            submitRsvp: vi.fn(),
          }}
        />
      </UiLanguageProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "ไม่สามารถเปิดคำเชิญนี้ได้" }),
    ).toBeVisible();
    expect(screen.queryByText(/raw English/)).not.toBeInTheDocument();
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
