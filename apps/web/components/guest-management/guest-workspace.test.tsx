// @vitest-environment jsdom

import type { GuestDetail, GuestSummary, Page } from "@lovechapter/contracts";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GuestWorkspace, type GuestWorkspaceApi } from "./guest-workspace";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GuestWorkspace", () => {
  it("confirms replacement and shows only the newly issued invitation link", async () => {
    const api = apiFixture();
    const original = {
      id: "original",
      guestId: guest().id,
      token: "old-secret",
      publicUrl: "https://web.example.test/i/old-secret",
    };
    const replacement = {
      ...original,
      id: "replacement",
      token: "new-secret",
      publicUrl: "https://web.example.test/i/new-secret",
    };
    api.createInvitation = vi.fn(async () => original);
    api.replaceInvitation = vi.fn(async () => replacement);
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const user = userEvent.setup();
    renderWorkspace(api, page([guest()]));
    await user.click(
      screen.getByRole("button", { name: /create invitation/i }),
    );
    expect(
      screen.getByRole("link", { name: /open nok's invitation/i }),
    ).toHaveAttribute("href", original.publicUrl);

    await user.click(
      screen.getByRole("button", { name: /issue a new link for nok/i }),
    );
    expect(api.replaceInvitation).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: /issue a new link for nok/i }),
    );

    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/old link/i));
    expect(api.replaceInvitation).toHaveBeenCalledWith(weddingId, guest().id);
    expect(
      screen.getByRole("link", { name: /open nok's invitation/i }),
    ).toHaveAttribute("href", replacement.publicUrl);
    expect(screen.queryByText(original.publicUrl)).toBeNull();
  });
  it("exports the search the user has typed even before list debounce completes", () => {
    vi.useFakeTimers();
    const api = apiFixture();
    renderWorkspace(api, page([guest()]));

    fireEvent.change(screen.getByLabelText(/search guests/i), {
      target: { value: "  Nok  " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /export filtered csv/i }),
    );

    expect(api.downloadGuestCsv).toHaveBeenCalledWith(weddingId, {
      view: "active",
      search: "Nok",
    });
  });

  it("exports the current filters and leaves selection after a download failure", async () => {
    const api = apiFixture();
    const failure = deferred<void>();
    api.downloadGuestCsv = vi.fn(() => failure.promise);
    const user = userEvent.setup();
    renderWorkspace(api, page([guest()]));
    await user.click(screen.getByRole("checkbox", { name: /select nok/i }));
    await user.click(
      screen.getByRole("button", { name: /export filtered csv/i }),
    );
    expect(api.downloadGuestCsv).toHaveBeenCalledWith(
      weddingId,
      expect.objectContaining({ view: "active" }),
    );
    expect(
      screen.getByRole("button", { name: /export filtered csv/i }),
    ).toBeDisabled();
    await act(async () => {
      failure.reject(new Error("Download failed"));
      await failure.promise.catch(() => {});
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Download failed",
    );
    expect(screen.getByText(/1 selected/i)).toBeVisible();
  });
  it("debounces search for 300 ms and ignores a stale filter response", async () => {
    vi.useFakeTimers();
    const first = deferred<Page<GuestSummary>>();
    const second = deferred<Page<GuestSummary>>();
    const api = apiFixture();
    api.listGuestManagement = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderWorkspace(api);

    fireEvent.change(screen.getByLabelText(/search guests/i), {
      target: { value: "Som" },
    });
    await act(async () => vi.advanceTimersByTime(299));
    expect(api.listGuestManagement).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(api.listGuestManagement).toHaveBeenCalledWith(
      weddingId,
      expect.objectContaining({ search: "Som", view: "active" }),
    );

    fireEvent.change(screen.getByLabelText(/rsvp status/i), {
      target: { value: "pending" },
    });
    expect(api.listGuestManagement).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve(page([{ ...guest(), id: "current", name: "Current" }]));
      await second.promise;
    });
    expect(screen.getByText("Current")).toBeVisible();
    await act(async () => {
      first.resolve(page([{ ...guest(), id: "stale", name: "Stale" }]));
      await first.promise;
    });
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
  });

  it("appends a page without duplicate guest IDs", async () => {
    const first = guest();
    const second = { ...guest(), id: "guest-2", name: "Dao" };
    const api = apiFixture();
    api.listGuestManagement = vi.fn(async () => page([first, second]));
    const user = userEvent.setup();
    renderWorkspace(api, page([first], "next"));

    await user.click(screen.getByRole("button", { name: /load more guests/i }));
    expect(await screen.findByText("Dao")).toBeVisible();
    expect(screen.getAllByText("Nok")).toHaveLength(1);
  });

  it("loads detail on demand and keeps mailing fields optional", async () => {
    const api = apiFixture();
    api.getGuest = vi.fn(async () => detail());
    const user = userEvent.setup();
    renderWorkspace(api, page([guest()]));

    await user.click(screen.getByRole("button", { name: /edit nok/i }));
    expect(api.getGuest).toHaveBeenCalledWith(weddingId, guest().id);
    const dialog = await screen.findByRole("dialog", { name: /edit nok/i });
    expect(dialog).toBeVisible();
    expect(
      within(dialog).getByText(
        /optional contact, envelope, and mailing details/i,
      ),
    ).toBeVisible();
    expect(
      within(dialog).queryByLabelText(/address line 1/i),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByLabelText(/include postal address/i));
    expect(within(dialog).getByLabelText(/address line 1/i)).toBeRequired();
  });

  it("closes a guest detail when switching weddings", async () => {
    const api = apiFixture();
    const user = userEvent.setup();
    const view = renderWorkspace(api, page([guest()]));
    await user.click(screen.getByRole("button", { name: /edit nok/i }));
    expect(
      await screen.findByRole("dialog", { name: /edit nok/i }),
    ).toBeVisible();

    view.rerender(
      <GuestWorkspace
        weddingId="018f0000-0000-7000-8000-000000000003"
        weddingName="New wedding"
        affiliations={[]}
        initialPage={page([])}
        api={api}
      />,
    );

    expect(screen.queryByRole("dialog", { name: /edit nok/i })).toBeNull();
  });

  it("ignores a guest detail response from the previous wedding", async () => {
    const pending = deferred<GuestDetail>();
    const api = apiFixture();
    api.getGuest = vi.fn(() => pending.promise);
    const user = userEvent.setup();
    const view = renderWorkspace(api, page([guest()]));
    await user.click(screen.getByRole("button", { name: /edit nok/i }));

    view.rerender(
      <GuestWorkspace
        weddingId="018f0000-0000-7000-8000-000000000003"
        weddingName="New wedding"
        affiliations={[]}
        initialPage={page([])}
        api={api}
      />,
    );
    await act(async () => {
      pending.resolve(detail());
      await pending.promise;
    });

    expect(screen.queryByRole("dialog", { name: /edit nok/i })).toBeNull();
  });

  it("does not show a new guest who does not match the current RSVP filter", async () => {
    const api = apiFixture();
    const user = userEvent.setup();
    renderWorkspace(api);

    await user.selectOptions(
      screen.getByLabelText(/rsvp status/i),
      "attending",
    );
    await user.type(screen.getByLabelText(/guest name/i), "Nok");
    await user.click(screen.getByRole("button", { name: /^add guest$/i }));

    expect(api.addGuest).toHaveBeenCalledWith(
      weddingId,
      expect.objectContaining({ name: "Nok" }),
    );
    expect(screen.queryByRole("button", { name: /edit nok/i })).toBeNull();
  });

  it("archives and restores only after confirmation", async () => {
    const api = apiFixture();
    api.archiveGuest = vi.fn(async () => ({
      ...detail(),
      archivedAt: "2026-09-23T00:00:00.000Z",
    }));
    api.restoreGuest = vi.fn(async () => detail());
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const user = userEvent.setup();
    const view = renderWorkspace(api, page([guest()]));

    await user.click(screen.getByRole("button", { name: /archive nok/i }));
    expect(api.archiveGuest).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /archive nok/i }));
    expect(api.archiveGuest).toHaveBeenCalledWith(weddingId, guest().id);
    expect(screen.queryByText("Nok")).not.toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);

    view.rerender(
      <GuestWorkspace
        weddingId={weddingId}
        weddingName="Mali & Arun"
        affiliations={[]}
        initialPage={page([
          { ...guest(), archivedAt: "2026-09-23T00:00:00.000Z" },
        ])}
        initialView="archived"
        api={api}
      />,
    );
    await user.click(screen.getByRole("button", { name: /restore nok/i }));
    expect(api.restoreGuest).toHaveBeenCalledWith(weddingId, guest().id);
    expect(screen.queryByText("Nok")).not.toBeInTheDocument();
  });

  it("keeps selection after a failed bulk action and caps select-all at 200", async () => {
    const guests = Array.from({ length: 201 }, (_, index) => ({
      ...guest(),
      id: `guest-${index}`,
      name: `Guest ${index}`,
    }));
    const api = apiFixture();
    api.bulkArchiveGuests = vi.fn(async () => {
      throw new Error("Bulk failed");
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderWorkspace(api, page(guests));

    await user.click(
      screen.getByRole("checkbox", { name: /select visible guests/i }),
    );
    expect(screen.getByText(/200 selected/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /archive selected/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bulk failed");
    expect(screen.getByText(/200 selected/i)).toBeVisible();
    expect(screen.getByText("Guest 0")).toBeVisible();
  }, 10_000);

  it("requires a count-aware confirmation before archiving selected guests", async () => {
    const api = apiFixture();
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const user = userEvent.setup();
    renderWorkspace(api, page([guest()]));
    await user.click(screen.getByRole("checkbox", { name: /select nok/i }));
    await user.click(screen.getByRole("button", { name: /archive selected/i }));
    expect(api.bulkArchiveGuests).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/1 guest/i));
    await user.click(screen.getByRole("button", { name: /archive selected/i }));
    expect(api.bulkArchiveGuests).toHaveBeenCalledWith(weddingId, {
      guestIds: [guest().id],
    });
  });
});

const weddingId = "018f0000-0000-7000-8000-000000000001";

function renderWorkspace(
  api: GuestWorkspaceApi,
  initialPage = page<GuestSummary>([]),
) {
  return render(
    <GuestWorkspace
      weddingId={weddingId}
      weddingName="Mali & Arun"
      affiliations={[]}
      initialPage={initialPage}
      api={api}
    />,
  );
}

function apiFixture(): GuestWorkspaceApi {
  return {
    listGuests: vi.fn(async () => page([])),
    listGuestManagement: vi.fn(async () => page([])),
    addGuest: vi.fn(async () => guest()),
    setGuestAffiliation: vi.fn(async () => guest()),
    createInvitation: vi.fn(),
    getGuest: vi.fn(async () => detail()),
    updateGuest: vi.fn(async () => detail()),
    archiveGuest: vi.fn(async () => detail()),
    restoreGuest: vi.fn(async () => detail()),
    bulkSetGuestAffiliation: vi.fn(async () => ({ affected: 1 })),
    bulkArchiveGuests: vi.fn(async () => ({ affected: 1 })),
    downloadGuestCsv: vi.fn(async () => undefined),
  };
}

function guest(): GuestSummary {
  return {
    id: "018f0000-0000-7000-8000-000000000002",
    name: "Nok",
    allowedPartySize: 2,
    affiliation: null,
    createdAt: "2026-09-21T10:01:00.000Z",
    rsvp: null,
  };
}

function detail(): GuestDetail {
  return {
    ...guest(),
    postalAddress: null,
    updatedAt: "2026-09-22T10:00:00.000Z",
  };
}

function page<T>(items: T[], nextCursor: string | null = null): Page<T> {
  return { items, nextCursor };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}
