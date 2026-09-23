// @vitest-environment jsdom

import type {
  AuthenticatedUser,
  CreateGuestInput,
  CreateWeddingInput,
  GuestAffiliation,
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
  it("shows the selected wedding's planning checklist", async () => {
    const wedding = weddingFixture();
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: vi.fn(async () => page([wedding])),
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
      listPlanningTasks: vi.fn(async () => page([])),
      getPlanningOverview: vi.fn(async () => ({
        total: 0,
        completed: 0,
        upcoming: [],
      })),
      createPlanningTask: vi.fn(),
      updatePlanningTask: vi.fn(),
      deletePlanningTask: vi.fn(),
    };
    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: /planning checklist/i }),
    ).toBeVisible();
    expect(api.getPlanningOverview).toHaveBeenCalledWith(wedding.id);
  });
  it("opens the full guest management workspace when detail endpoints are available", async () => {
    const wedding = weddingFixture();
    const guest = guestFixture();
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: vi.fn(async () => page([wedding])),
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([guest])),
      listGuestManagement: vi.fn(async () => page([guest])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(async () => invitationFixture(guest.id)),
      getGuest: vi.fn(async () => ({
        ...guest,
        postalAddress: null,
        updatedAt: guest.createdAt,
      })),
      updateGuest: vi.fn(),
      archiveGuest: vi.fn(),
      restoreGuest: vi.fn(),
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
    expect(screen.getByLabelText(/search guests/i)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: /create invitation/i }),
    );
    expect(
      await screen.findByRole("link", { name: /open nok's invitation/i }),
    ).toBeVisible();
  });
  it("creates a wedding and guest, then reveals the one-time invitation URL", async () => {
    const wedding = weddingFixture();
    const guest = guestFixture();
    const onSignOut = vi.fn();
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
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
      ...affiliationApi(),
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

  it("removes a one-time invitation URL when the wedding scope changes", async () => {
    const firstWedding = weddingFixture();
    const secondWedding = {
      ...weddingFixture(),
      id: crypto.randomUUID(),
      name: "Dao & Lin",
    };
    const guest = guestFixture();
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: vi.fn(async () => page([firstWedding, secondWedding])),
      createWedding: vi.fn(),
      listGuests: vi.fn(async (weddingId: string) =>
        page(weddingId === firstWedding.id ? [guest] : []),
      ),
      addGuest: vi.fn(),
      createInvitation: vi.fn(async () => invitationFixture(guest.id)),
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
      screen.getByRole("button", { name: /create invitation/i }),
    );
    expect(
      await screen.findByRole("link", { name: /open nok's invitation/i }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: new RegExp(secondWedding.name, "i") }),
    );
    expect(
      await screen.findByRole("heading", { name: secondWedding.name }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /open nok's invitation/i }),
    ).not.toBeInTheDocument();
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
      ...affiliationApi(),
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

  it("creates custom affiliations and assigns one when adding a guest", async () => {
    const wedding = weddingFixture();
    const family = affiliationFixture();
    const friends = {
      ...affiliationFixture(),
      id: "018f0000-0000-7000-8000-000000000005",
      name: "Friends",
      color: "#0ea5e9",
      sortOrder: 1,
    };
    const createGuestAffiliation = vi.fn(async () => friends);
    const addGuest = vi.fn(
      async (_weddingId: string, input: CreateGuestInput) => ({
        ...guestFixture(),
        name: input.name,
        affiliation: family,
      }),
    );
    const api: CoupleWorkspaceApi = {
      listWeddings: vi.fn(async () => page([wedding])),
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([])),
      addGuest,
      createInvitation: vi.fn(),
      listGuestAffiliations: vi.fn(async () => [family]),
      createGuestAffiliation,
      updateGuestAffiliation: vi.fn(),
      reorderGuestAffiliations: vi.fn(),
      deleteGuestAffiliation: vi.fn(),
      setGuestAffiliation: vi.fn(),
    };
    const user = userEvent.setup();

    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: /guest affiliations/i }),
    ).toBeVisible();
    expect(screen.getByText("Family")).toBeVisible();
    await user.type(screen.getByLabelText(/new affiliation name/i), "Friends");
    await user.click(screen.getByRole("button", { name: /add affiliation/i }));
    expect(createGuestAffiliation).toHaveBeenCalledWith(wedding.id, {
      name: "Friends",
      color: "#8c5261",
    });
    expect(await screen.findByText("Friends")).toBeVisible();

    await user.type(screen.getByLabelText(/guest name/i), "Nok");
    await user.selectOptions(
      screen.getByLabelText(/guest affiliation/i),
      family.id,
    );
    await user.click(screen.getByRole("button", { name: /add guest/i }));
    expect(addGuest).toHaveBeenCalledWith(wedding.id, {
      name: "Nok",
      allowedPartySize: 1,
      affiliationId: family.id,
    });
    expect(await screen.findByText("Nok")).toBeVisible();
  });

  it("deletes an affiliation without removing its guests", async () => {
    const wedding = weddingFixture();
    const family = affiliationFixture();
    const guest = { ...guestFixture(), affiliation: family };
    const deleteGuestAffiliation = vi.fn(async () => undefined);
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: vi.fn(async () => page([wedding])),
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([guest])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
      listGuestAffiliations: vi.fn(async () => [family]),
      deleteGuestAffiliation,
    };
    const user = userEvent.setup();
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );

    expect(await screen.findByText("Nok")).toBeVisible();
    expect(screen.getAllByText("Family")).not.toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /delete family/i }));
    expect(deleteGuestAffiliation).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/guests.*unassigned/i),
    );
    await user.click(screen.getByRole("button", { name: /delete family/i }));

    expect(deleteGuestAffiliation).toHaveBeenCalledWith(wedding.id, family.id);
    expect(screen.getByText("Nok")).toBeVisible();
    expect(screen.queryByText("Family")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Family" }),
    ).not.toBeInTheDocument();
  });

  it("assigns an affiliation to an existing guest", async () => {
    const wedding = weddingFixture();
    const family = affiliationFixture();
    const assigned = { ...guestFixture(), affiliation: family };
    const setGuestAffiliation = vi.fn(async () => assigned);
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: vi.fn(async () => page([wedding])),
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([guestFixture()])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
      listGuestAffiliations: vi.fn(async () => [family]),
      setGuestAffiliation,
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
    await user.selectOptions(
      screen.getByLabelText("Nok affiliation"),
      family.id,
    );

    expect(setGuestAffiliation).toHaveBeenCalledWith(wedding.id, assigned.id, {
      affiliationId: family.id,
    });
    expect(screen.getByLabelText("Nok affiliation")).toHaveValue(family.id);
    expect(screen.getAllByText("Family")).not.toHaveLength(0);
  });

  it("ignores an affiliation create response after switching weddings", async () => {
    const firstWedding = weddingFixture();
    const secondWedding = {
      ...weddingFixture(),
      id: crypto.randomUUID(),
      name: "Dao & Lin",
    };
    const lateCreate = deferred<GuestAffiliation>();
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: vi.fn(async () => page([firstWedding, secondWedding])),
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
      listGuestAffiliations: vi.fn(async () => []),
      createGuestAffiliation: vi.fn(() => lateCreate.promise),
    };
    const user = userEvent.setup();

    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );

    expect(await screen.findByText(/no affiliations yet/i)).toBeVisible();
    await user.type(screen.getByLabelText(/new affiliation name/i), "Friends");
    await user.click(screen.getByRole("button", { name: /add affiliation/i }));
    await user.click(
      screen.getByRole("button", { name: new RegExp(secondWedding.name, "i") }),
    );
    expect(
      await screen.findByRole("heading", { name: secondWedding.name }),
    ).toBeVisible();

    await act(async () => {
      lateCreate.resolve({
        ...affiliationFixture(),
        name: "Friends",
      });
      await lateCreate.promise;
    });
    expect(screen.queryByText("Friends")).not.toBeInTheDocument();
  });

  it("keeps a successful assignment when an older same-wedding refresh finishes", async () => {
    const wedding = weddingFixture();
    const family = affiliationFixture();
    const assignment = deferred<GuestSummary>();
    const refresh = deferred<Page<GuestSummary>>();
    let guestReads = 0;
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: vi.fn(async () => page([wedding])),
      createWedding: vi.fn(),
      listGuests: vi.fn(() => {
        guestReads += 1;
        return guestReads === 1
          ? Promise.resolve(page([guestFixture()]))
          : refresh.promise;
      }),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
      listGuestAffiliations: vi.fn(async () => [family]),
      setGuestAffiliation: vi.fn(() => assignment.promise),
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
    await user.selectOptions(
      screen.getByLabelText("Nok affiliation"),
      family.id,
    );
    await user.click(
      screen.getByRole("button", { name: /refresh responses/i }),
    );

    await act(async () => {
      assignment.resolve({ ...guestFixture(), affiliation: family });
      await assignment.promise;
    });
    expect(screen.getByLabelText("Nok affiliation")).toHaveValue(family.id);

    await act(async () => {
      refresh.resolve(page([guestFixture()]));
      await refresh.promise;
    });
    expect(screen.getByLabelText("Nok affiliation")).toHaveValue(family.id);
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
    affiliation: null,
    createdAt: "2026-09-21T10:01:00.000Z",
    rsvp: null,
  };
}

function affiliationFixture(): GuestAffiliation {
  return {
    id: "018f0000-0000-7000-8000-000000000004",
    name: "Family",
    color: "#a855f7",
    sortOrder: 0,
    createdAt: "2026-09-21T10:00:00.000Z",
  };
}

function affiliationApi(): Pick<
  CoupleWorkspaceApi,
  | "listGuestAffiliations"
  | "createGuestAffiliation"
  | "updateGuestAffiliation"
  | "reorderGuestAffiliations"
  | "deleteGuestAffiliation"
  | "setGuestAffiliation"
> {
  return {
    listGuestAffiliations: vi.fn(async () => []),
    createGuestAffiliation: vi.fn(async () => affiliationFixture()),
    updateGuestAffiliation: vi.fn(async () => affiliationFixture()),
    reorderGuestAffiliations: vi.fn(async () => []),
    deleteGuestAffiliation: vi.fn(async () => undefined),
    setGuestAffiliation: vi.fn(async () => guestFixture()),
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
