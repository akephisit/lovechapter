// @vitest-environment jsdom

import type {
  AuthenticatedUser,
  CreateGuestInput,
  CreateWeddingInput,
  GuestSummary,
  InvitationCreated,
  Page,
  WeddingSummary,
} from "@lovechapter/contracts";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CoupleWorkspace, type CoupleWorkspaceApi } from "./couple-workspace";

describe("CoupleWorkspace", () => {
  it("creates a wedding and guest, then reveals the one-time invitation URL", async () => {
    const wedding = weddingFixture();
    const guest = guestFixture();
    const onSignOut = vi.fn();
    const api: CoupleWorkspaceApi = {
      listWeddings: vi.fn(async () => page([])),
      createWedding: vi.fn(async (_input: CreateWeddingInput) => wedding),
      listGuests: vi.fn(async () => page([])),
      addGuest: vi.fn(
        async (_weddingId: string, _input: CreateGuestInput) => guest,
      ),
      createInvitation: vi.fn(async () => invitationFixture(guest.id)),
    };
    const user = userEvent.setup();

    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={onSignOut}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: /plan the chapter/i }),
    ).toBeVisible();
    expect(screen.getByText("Couple one")).toBeVisible();
    expect(screen.queryByText(/development identity/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledOnce();
    await user.type(screen.getByLabelText(/wedding name/i), "Mali & Arun");
    await user.click(screen.getByRole("button", { name: /create wedding/i }));

    expect(
      await screen.findByRole("heading", { name: "Mali & Arun" }),
    ).toBeVisible();
    await user.type(screen.getByLabelText(/guest name/i), "Nok");
    await user.clear(screen.getByLabelText(/party allowance/i));
    await user.type(screen.getByLabelText(/party allowance/i), "2");
    await user.click(screen.getByRole("button", { name: /add guest/i }));

    expect(await screen.findByText("Nok")).toBeVisible();
    expect(screen.getByText(/awaiting response/i)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: /create invitation/i }),
    );

    const invitationLink = await screen.findByRole("link", {
      name: /open nok's invitation/i,
    });
    expect(invitationLink).toHaveAttribute(
      "href",
      "https://web.example.test/i/A_secure_token",
    );
    expect(screen.getByText(/shown only for this session/i)).toBeVisible();
  });

  it("loads the next bounded guest page and refreshes RSVP status", async () => {
    const wedding = weddingFixture();
    const pending = guestFixture();
    const second = { ...guestFixture(), id: crypto.randomUUID(), name: "Dao" };
    const attending = {
      ...pending,
      rsvp: {
        attendance: "attending" as const,
        partySize: 2,
        updatedAt: "2026-09-21T11:00:00.000Z",
      },
    };
    let firstPageReads = 0;
    const listGuests = vi.fn(
      async (
        _weddingId: string,
        cursor?: string,
      ): Promise<Page<GuestSummary>> => {
        if (cursor === "next-page") return page([second]);
        firstPageReads += 1;
        return firstPageReads === 1
          ? page([pending], "next-page")
          : page([attending, second]);
      },
    );
    const api: CoupleWorkspaceApi = {
      listWeddings: vi.fn(async () => page([wedding])),
      createWedding: vi.fn(),
      listGuests,
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
    };
    const user = userEvent.setup();

    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );

    expect(await screen.findByText("Nok")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /load more guests/i }));
    expect(await screen.findByText("Dao")).toBeVisible();
    expect(listGuests).toHaveBeenCalledWith(wedding.id, "next-page");

    await user.click(
      screen.getByRole("button", { name: /refresh responses/i }),
    );
    expect(await screen.findByText(/attending · 2/i)).toBeVisible();
    expect(listGuests).toHaveBeenLastCalledWith(wedding.id);
  });

  it("keeps the selected wedding's guests when an older request finishes last", async () => {
    const firstWedding = weddingFixture();
    const secondWedding = {
      ...weddingFixture(),
      id: crypto.randomUUID(),
      name: "Dao & Lin",
    };
    const currentGuest = {
      ...guestFixture(),
      id: crypto.randomUUID(),
      name: "Current guest",
    };
    const staleGuest = {
      ...guestFixture(),
      id: crypto.randomUUID(),
      name: "Stale guest",
    };
    const secondLoad = deferred<Page<GuestSummary>>();
    const firstReload = deferred<Page<GuestSummary>>();
    let firstWeddingReads = 0;
    const api: CoupleWorkspaceApi = {
      listWeddings: vi.fn(async () => page([firstWedding, secondWedding])),
      createWedding: vi.fn(),
      listGuests: vi.fn((weddingId: string) => {
        if (weddingId === secondWedding.id) return secondLoad.promise;
        firstWeddingReads += 1;
        return firstWeddingReads === 1
          ? Promise.resolve(page([guestFixture()]))
          : firstReload.promise;
      }),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
    };
    const user = userEvent.setup();

    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );

    expect(await screen.findByText("Nok")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: new RegExp(secondWedding.name, "i") }),
    );
    await user.click(
      screen.getByRole("button", { name: new RegExp(firstWedding.name, "i") }),
    );
    firstReload.resolve(page([currentGuest]));
    expect(await screen.findByText(currentGuest.name)).toBeVisible();

    await act(async () => {
      secondLoad.resolve(page([staleGuest]));
      await secondLoad.promise;
    });
    expect(screen.queryByText(staleGuest.name)).not.toBeInTheDocument();
    expect(screen.getByText(currentGuest.name)).toBeVisible();
  });
});

function userFixture(): AuthenticatedUser {
  return {
    id: "018f0000-0000-7000-8000-000000000000",
    displayName: "Couple one",
    email: "one@example.test",
    onboardingComplete: true,
  };
}

function weddingFixture(): WeddingSummary {
  return {
    id: "018f0000-0000-7000-8000-000000000001",
    name: "Mali & Arun",
    weddingDate: "2027-02-14",
    timeZone: "Asia/Bangkok",
    locale: "en",
    role: "owner",
    createdAt: "2026-09-21T10:00:00.000Z",
  };
}

function guestFixture(): GuestSummary {
  return {
    id: "018f0000-0000-7000-8000-000000000002",
    name: "Nok",
    allowedPartySize: 2,
    createdAt: "2026-09-21T10:01:00.000Z",
    rsvp: null,
  };
}

function invitationFixture(guestId: string): InvitationCreated {
  return {
    id: "018f0000-0000-7000-8000-000000000003",
    guestId,
    token: "A_secure_token",
    publicUrl: "https://web.example.test/i/A_secure_token",
  };
}

function page<T>(items: T[], nextCursor: string | null = null): Page<T> {
  return { items, nextCursor };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
