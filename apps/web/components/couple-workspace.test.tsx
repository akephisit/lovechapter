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
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CoupleWorkspace, type CoupleWorkspaceApi } from "./couple-workspace";
import { UiLanguageProvider } from "./ui-language-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("CoupleWorkspace", () => {
  it("keeps a dirty settings draft when section or wedding navigation is cancelled", async () => {
    const first = weddingFixture();
    const second = { ...first, id: crypto.randomUUID(), name: "Dao & Lin" };
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: vi.fn(async () => page([first, second])),
      createWedding: vi.fn(),
      updateWedding: vi.fn(),
      listGuests: vi.fn(async () => page([])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
    };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: first.name });
    await userEvent.click(
      screen.getByRole("button", { name: "Wedding settings" }),
    );
    await userEvent.type(screen.getByLabelText("Wedding name"), " changed");
    await userEvent.click(screen.getByRole("button", { name: "Guests" }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByLabelText("Wedding name")).toHaveValue(
      "Mali & Arun changed",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Choose wedding" }),
    );
    await userEvent.click(screen.getByRole("button", { name: second.name }));
    expect(screen.getByRole("heading", { name: first.name })).toBeVisible();
    confirm.mockRestore();
  });
  it("updates the selected wedding and picker after saving settings", async () => {
    const first = weddingFixture();
    const other = { ...first, id: crypto.randomUUID(), name: "Dao & Lin" };
    const updateWedding = vi.fn(
      async (
        _id: string,
        input: {
          name: string;
          weddingDate: string | null;
          timeZone: string;
          locale: string;
        },
      ) => {
        const base = { ...first };
        delete base.weddingDate;
        return {
          ...base,
          name: input.name,
          timeZone: input.timeZone,
          locale: input.locale,
          ...(input.weddingDate ? { weddingDate: input.weddingDate } : {}),
        };
      },
    );
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      updateWedding,
      listWeddings: vi.fn(async () => page([first, other])),
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
    };
    render(
      <UiLanguageProvider language="th">
        <CoupleWorkspace
          identity={userFixture()}
          api={api}
          onSignOut={vi.fn()}
        />
      </UiLanguageProvider>,
    );
    await screen.findByRole("heading", { name: first.name });
    await userEvent.click(
      screen.getByRole("button", { name: "ตั้งค่างานแต่ง" }),
    );
    await userEvent.clear(screen.getByLabelText("ชื่องานแต่ง"));
    await userEvent.type(screen.getByLabelText("ชื่องานแต่ง"), "วันของเรา");
    await userEvent.click(
      screen.getByRole("button", { name: "บันทึกการตั้งค่า" }),
    );
    expect(
      await screen.findByRole("heading", { name: "วันของเรา", level: 1 }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "เลือกงานแต่ง" }));
    expect(screen.getByRole("button", { name: /วันของเรา/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "ภาพรวม" })).toBeVisible();
  });
  it("opens one wedding in Overview without preloading the guest editor", async () => {
    const wedding = weddingFixture();
    const listGuests = vi.fn(async () => page([guestFixture()]));
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: vi.fn(async () => page([wedding])),
      createWedding: vi.fn(),
      listGuests,
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
    };
    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: wedding.name }),
    ).toBeVisible();
    const sections = screen.getByRole("navigation", {
      name: /workspace sections/i,
    });
    expect(sections).toHaveTextContent("Overview");
    expect(sections).toHaveTextContent("Guests");
    expect(screen.queryByLabelText(/guest name/i)).not.toBeInTheDocument();
    expect(listGuests).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/wedding name/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guests" }));
    expect(await screen.findByText("Nok")).toBeVisible();
    expect(listGuests).toHaveBeenCalledWith(wedding.id);
  });

  it("reloads the bounded overview summaries after visiting Guests", async () => {
    const wedding = weddingFixture();
    const getRsvpSummary = vi
      .fn()
      .mockResolvedValueOnce({
        totalActive: 0,
        attending: 0,
        declined: 0,
        replied: 0,
        awaiting: 0,
      })
      .mockResolvedValueOnce({
        totalActive: 1,
        attending: 0,
        declined: 0,
        replied: 0,
        awaiting: 1,
      });
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      getRsvpSummary,
      listWeddings: vi.fn(async () => page([wedding])),
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([guestFixture()])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
    };
    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );
    expect(await screen.findByText(/0 guest parties/i)).toBeVisible();
    await openGuests();
    expect(await screen.findByText("Nok")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(await screen.findByText(/1 guest party/i)).toBeVisible();
    expect(getRsvpSummary).toHaveBeenCalledTimes(2);
  });

  it("offers retry instead of an empty guest editor when the guest read fails", async () => {
    const wedding = weddingFixture();
    const listGuests = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([guestFixture()]));
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: vi.fn(async () => page([wedding])),
      createWedding: vi.fn(),
      listGuests,
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
    };
    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );
    await openGuests();
    expect(
      await within(screen.getByRole("region", { name: "Guests" })).findByRole(
        "alert",
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText(/guest name/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nok")).toBeVisible();
  });

  it("offers a compact wedding picker and bounded load-more", async () => {
    const first = weddingFixture();
    const second = { ...first, id: crypto.randomUUID(), name: "Dao & Lin" };
    const third = { ...first, id: crypto.randomUUID(), name: "May & Noon" };
    const listWeddings = vi.fn(async (cursor?: string) =>
      cursor ? page([third]) : page([first, second], "next-weddings"),
    );
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings,
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
    };
    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: first.name }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: /choose wedding/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /load more weddings/i }),
    );
    expect(listWeddings).toHaveBeenLastCalledWith("next-weddings");
    await userEvent.click(
      await screen.findByRole("button", { name: third.name }),
    );
    expect(
      await screen.findByRole("heading", { name: third.name }),
    ).toBeVisible();
    expect(screen.queryByLabelText(/wedding name/i)).not.toBeInTheDocument();
  });

  it("keeps a failed wedding list distinct from an empty workspace and retries", async () => {
    const listWeddings = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([]));
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings,
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
    };
    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByLabelText(/wedding name/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(
      await screen.findByRole("heading", { name: /begin with the day/i }),
    ).toBeVisible();
    expect(listWeddings).toHaveBeenCalledTimes(2);
  });

  it("uses Thai for an empty wedding workspace without changing submitted locale or time zone", async () => {
    const created = {
      ...weddingFixture(),
      locale: "en-US",
      timeZone: "Europe/London",
    };
    const createWedding = vi.fn(async (_input: CreateWeddingInput) => created);
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: async () => page([]),
      createWedding,
      listGuests: async () => page([]),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
    };
    render(
      <UiLanguageProvider language="th">
        <CoupleWorkspace
          identity={userFixture()}
          api={api}
          onSignOut={vi.fn()}
        />
      </UiLanguageProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "เริ่มจากวันสำคัญ" }),
    ).toBeVisible();
    await userEvent.type(screen.getByLabelText("ชื่องานแต่ง"), "Mali & Arun");
    await userEvent.clear(screen.getByLabelText("เขตเวลา"));
    await userEvent.type(
      screen.getByLabelText("เขตเวลา"),
      "Europe/London{ArrowDown}{Enter}",
    );
    await userEvent.clear(screen.getByLabelText("ภาษาของงานแต่ง"));
    await userEvent.type(
      screen.getByLabelText("ภาษาของงานแต่ง"),
      "en-US{ArrowDown}{Enter}",
    );
    await userEvent.click(screen.getByRole("button", { name: "สร้างงานแต่ง" }));
    expect(createWedding).toHaveBeenCalledWith({
      name: "Mali & Arun",
      timeZone: "Europe/London",
      locale: "en-US",
    });
  });

  it("does not reset the selected wedding or refetch it when UI language changes", async () => {
    const first = weddingFixture();
    const second = {
      ...first,
      id: crypto.randomUUID(),
      name: "Dao & Lin",
      locale: "en-US",
      timeZone: "Europe/London",
    };
    const listWeddings = vi.fn(async () =>
      page([first, second], "next-weddings"),
    );
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings,
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
    };
    const { rerender } = render(
      <UiLanguageProvider language="en">
        <CoupleWorkspace
          identity={userFixture()}
          api={api}
          onSignOut={vi.fn()}
        />
      </UiLanguageProvider>,
    );
    await screen.findByRole("heading", { name: "Mali & Arun" });
    await userEvent.click(
      screen.getByRole("button", { name: /choose wedding/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Dao & Lin" }));
    expect(
      await screen.findByRole("heading", { name: "Dao & Lin" }),
    ).toBeVisible();
    rerender(
      <UiLanguageProvider language="th">
        <CoupleWorkspace
          identity={userFixture()}
          api={api}
          onSignOut={vi.fn()}
        />
      </UiLanguageProvider>,
    );
    expect(screen.getByRole("heading", { name: "Dao & Lin" })).toBeVisible();
    expect(listWeddings).toHaveBeenCalledOnce();
  });
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
    await userEvent.click(
      await screen.findByRole("button", { name: "Planning" }),
    );
    expect(
      await screen.findByRole("heading", { name: /planning checklist/i }),
    ).toBeVisible();
    await waitFor(() => {
      expect(api.getPlanningOverview).toHaveBeenCalledWith(wedding.id);
    });
  });
  it("keeps a planning draft when section navigation is cancelled", async () => {
    const wedding = weddingFixture();
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: vi.fn(async () => page([wedding])),
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
      listPlanningTasks: vi.fn(async () => page([])),
      createPlanningTask: vi.fn(),
      updatePlanningTask: vi.fn(),
      deletePlanningTask: vi.fn(),
    };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Planning" }),
    );
    await userEvent.type(
      await screen.findByLabelText("Task title"),
      "Choose flowers",
    );
    await userEvent.click(screen.getByRole("button", { name: "Guests" }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByLabelText("Task title")).toHaveValue("Choose flowers");
    confirm.mockRestore();
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

    await openGuests();
    expect(await screen.findByText("Nok")).toBeVisible();
    expect(screen.getByLabelText(/search guests/i)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: /create invitation/i }),
    );
    expect(
      await screen.findByRole("link", { name: /open nok's invitation/i }),
    ).toBeVisible();
  });
  it("keeps CSV import/export and envelope printing reachable from Guests", async () => {
    const wedding = weddingFixture();
    const api: CoupleWorkspaceApi = {
      ...affiliationApi(),
      listWeddings: vi.fn(async () => page([wedding])),
      createWedding: vi.fn(),
      listGuests: vi.fn(async () => page([])),
      listGuestManagement: vi.fn(async () => page([])),
      addGuest: vi.fn(),
      createInvitation: vi.fn(),
      getGuest: vi.fn(),
      updateGuest: vi.fn(),
      archiveGuest: vi.fn(),
      restoreGuest: vi.fn(),
      downloadGuestCsv: vi.fn(),
      uploadGuestCsv: vi.fn(),
      getGuestImportPreview: vi.fn(),
      updateGuestImportMapping: vi.fn(),
      commitGuestImport: vi.fn(),
      listEnvelopeTemplates: vi.fn(),
      createEnvelopeTemplate: vi.fn(),
      updateEnvelopeTemplate: vi.fn(),
      deleteEnvelopeTemplate: vi.fn(),
      getEnvelopePrintData: vi.fn(),
    };
    render(
      <CoupleWorkspace
        identity={userFixture()}
        api={api}
        onSignOut={vi.fn()}
      />,
    );
    await openGuests();
    expect(
      await screen.findByRole("button", { name: "Export filtered CSV" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Print envelopes" }),
    ).toBeVisible();
    expect(screen.getByText(/import guests/i)).toBeVisible();
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
      await screen.findByRole("heading", { name: /begin with the day/i }),
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
    await openGuests();
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

    await openGuests();
    expect(await screen.findByText("Nok")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /load more guests/i }));
    expect(await screen.findByText("Dao")).toBeVisible();
    expect(listGuests).toHaveBeenCalledWith(wedding.id, "next-page");

    await user.click(
      screen.getByRole("button", { name: /refresh responses/i }),
    );
    expect(await screen.findByText(/attending · 2/i)).toBeVisible();
    expect(listGuests).toHaveBeenLastCalledWith(wedding.id, undefined);
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

    await openGuests();
    expect(await screen.findByText("Nok")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: /create invitation/i }),
    );
    expect(
      await screen.findByRole("link", { name: /open nok's invitation/i }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: /choose wedding/i }));
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

    await openGuests();
    expect(await screen.findByText("Nok")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /choose wedding/i }));
    await user.click(
      screen.getByRole("button", { name: new RegExp(secondWedding.name, "i") }),
    );
    await openGuests();
    await user.click(screen.getByRole("button", { name: /choose wedding/i }));
    await user.click(
      screen.getByRole("button", { name: new RegExp(firstWedding.name, "i") }),
    );
    await openGuests();
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
      ...affiliationApi(),
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

    await openGuests();
    expect(
      await screen.findByRole("heading", { name: /guest affiliations/i }),
    ).toBeVisible();
    expect(screen.getAllByText("Family")).not.toHaveLength(0);
    await user.type(screen.getByLabelText(/new affiliation name/i), "Friends");
    await user.click(screen.getByRole("button", { name: /add affiliation/i }));
    expect(createGuestAffiliation).toHaveBeenCalledWith(wedding.id, {
      name: "Friends",
      color: "#8c5261",
    });
    expect(await screen.findAllByText("Friends")).not.toHaveLength(0);

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

    await openGuests();
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

    await openGuests();
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
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
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

    await openGuests();
    expect(await screen.findByText(/no affiliations yet/i)).toBeVisible();
    await user.type(screen.getByLabelText(/new affiliation name/i), "Friends");
    await user.click(screen.getByRole("button", { name: /add affiliation/i }));
    await user.click(screen.getByRole("button", { name: /choose wedding/i }));
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
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
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

    await openGuests();
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

async function openGuests(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "Guests" }));
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
  | "updateWedding"
  | "getPlanningOverview"
  | "getRsvpSummary"
  | "listGuestAffiliations"
  | "createGuestAffiliation"
  | "updateGuestAffiliation"
  | "reorderGuestAffiliations"
  | "deleteGuestAffiliation"
  | "setGuestAffiliation"
> {
  return {
    updateWedding: vi.fn(),
    getPlanningOverview: vi.fn(async () => ({
      total: 0,
      completed: 0,
      upcoming: [],
    })),
    getRsvpSummary: vi.fn(async () => ({
      totalActive: 0,
      attending: 0,
      declined: 0,
      replied: 0,
      awaiting: 0,
    })),
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
