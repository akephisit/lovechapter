// @vitest-environment jsdom
import type {
  GuestImportPreview,
  GuestImportPreviewRow,
} from "@lovechapter/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  GuestImportWorkspace,
  type GuestImportApi,
} from "./guest-import-workspace";

const row: GuestImportPreviewRow = {
  id: "018f0000-0000-7000-8000-000000000004",
  rowNumber: 2,
  sourceName: "=2+2",
  sourceAffiliation: null,
  candidate: { name: "=2+2", allowedPartySize: 1 },
  errors: [],
  warnings: [],
  included: true,
};
function preview(items: GuestImportPreviewRow[] = [row]): GuestImportPreview {
  return {
    batchId: "018f0000-0000-7000-8000-000000000003",
    headers: ["name"],
    mapping: {
      name: 0,
      email: null,
      phone: null,
      allowedPartySize: null,
      affiliation: null,
      envelopeName: null,
      addressLine1: null,
      addressLine2: null,
      locality: null,
      administrativeArea: null,
      postalCode: null,
      countryCode: null,
      note: null,
    },
    affiliationMappings: {},
    mappingVersion: 1,
    status: "previewed",
    totals: { valid: items.length, warning: 0, invalid: 0, excluded: 0 },
    items,
    nextCursor: null,
  };
}
function fixture(items?: GuestImportPreviewRow[]) {
  const api: GuestImportApi = {
    uploadGuestCsv: vi.fn(async () => preview(items)),
    getGuestImportPreview: vi.fn(async () => preview(items)),
    updateGuestImportMapping: vi.fn(async () => ({
      ...preview(items),
      mappingVersion: 2,
    })),
    commitGuestImport: vi.fn(async () => ({
      created: 1,
      excluded: 0,
      guestIds: [crypto.randomUUID()],
    })),
    createGuestAffiliation: vi.fn(async (_weddingId, input) => ({
      id: crypto.randomUUID(),
      name: input.name,
      color: input.color,
      sortOrder: 0,
      createdAt: "2026-09-23T00:00:00.000Z",
    })),
  };
  const onImported = vi.fn();
  render(
    <GuestImportWorkspace
      weddingId="wedding"
      affiliations={[]}
      api={api}
      onImported={onImported}
    />,
  );
  return { api, onImported };
}

describe("GuestImportWorkspace", () => {
  it("keeps the same idempotency key across a failed commit and retry", async () => {
    const { api } = fixture();
    vi.mocked(api.commitGuestImport).mockRejectedValueOnce(
      new Error("Network error"),
    );
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText(/select csv/i), {
      target: {
        files: [new File(["name\nNok"], "guests.csv", { type: "text/csv" })],
      },
    });
    await user.click(screen.getByRole("button", { name: /upload csv/i }));
    await user.click(
      await screen.findByRole("button", { name: /review rows/i }),
    );
    await user.click(screen.getByRole("button", { name: /import guests/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
    await user.click(screen.getByRole("button", { name: /import guests/i }));
    const first = vi.mocked(api.commitGuestImport).mock.calls[0]?.[2];
    const second = vi.mocked(api.commitGuestImport).mock.calls[1]?.[2];
    expect(first?.idempotencyKey).toBe(second?.idempotencyKey);
  });

  it("adopts a concurrent mapping after a stale-version response before another edit", async () => {
    const { api } = fixture();
    const refreshed = {
      ...preview(),
      mappingVersion: 2,
      mapping: { ...preview().mapping, email: 1 },
      headers: ["name", "email"],
      affiliationMappings: { work: crypto.randomUUID() },
    };
    vi.mocked(api.updateGuestImportMapping)
      .mockRejectedValueOnce(
        Object.assign(new Error("Stale preview"), { status: 409 }),
      )
      .mockImplementationOnce(async (_weddingId, _batchId, input) => ({
        ...refreshed,
        mappingVersion: 3,
        mapping: input.mapping,
        affiliationMappings: input.affiliationMappings,
      }));
    vi.mocked(api.getGuestImportPreview).mockResolvedValue(refreshed);
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText(/select csv/i), {
      target: {
        files: [new File(["name,email\nNok,nok@example.test"], "guests.csv")],
      },
    });
    await user.click(screen.getByRole("button", { name: /upload csv/i }));
    await user.click(
      await screen.findByRole("button", { name: /review rows/i }),
    );
    await user.click(screen.getByRole("checkbox", { name: /exclude row 2/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Stale preview");
    await user.click(screen.getByRole("checkbox", { name: /exclude row 2/i }));
    expect(api.updateGuestImportMapping).toHaveBeenLastCalledWith(
      "wedding",
      preview().batchId,
      expect.objectContaining({
        expectedVersion: 2,
        mapping: refreshed.mapping,
        affiliationMappings: refreshed.affiliationMappings,
      }),
    );
  });

  it("allows explicit creation of a previously unknown guest side", async () => {
    const unknown = {
      ...row,
      candidate: null,
      sourceAffiliation: "Work",
      errors: ["Unknown affiliation"],
    };
    const { api } = fixture([unknown]);
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText(/select csv/i), {
      target: {
        files: [
          new File(["name,affiliation\nNok,Work"], "guests.csv", {
            type: "text/csv",
          }),
        ],
      },
    });
    await user.click(screen.getByRole("button", { name: /upload csv/i }));
    await user.click(
      await screen.findByRole("button", { name: /review rows/i }),
    );
    await user.click(screen.getByRole("button", { name: /create side/i }));
    expect(api.createGuestAffiliation).toHaveBeenCalledWith(
      "wedding",
      expect.objectContaining({ name: "Work" }),
    );
    expect(api.updateGuestImportMapping).toHaveBeenCalledWith(
      "wedding",
      preview().batchId,
      expect.objectContaining({
        affiliationMappings: { work: expect.any(String) },
      }),
    );
  });
  it("rejects oversized and non-CSV files before uploading", async () => {
    const { api } = fixture();
    fireEvent.change(screen.getByLabelText(/select csv/i), {
      target: { files: [new File(["a"], "a.txt", { type: "text/plain" })] },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /upload csv/i }));
    expect(api.uploadGuestCsv).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/csv/i);
  });

  it("maps, previews values as text, confirms warnings, commits with stable key and refreshes guests", async () => {
    const warned = { ...row, warnings: ["Likely duplicate email"] };
    const { api, onImported } = fixture([warned]);
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText(/select csv/i), {
      target: {
        files: [new File(["name\n=2+2"], "guests.csv", { type: "text/csv" })],
      },
    });
    await user.click(screen.getByRole("button", { name: /upload csv/i }));
    await user.click(
      await screen.findByRole("button", { name: /review rows/i }),
    );
    expect(screen.getByText("=2+2")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /import guests/i }),
    ).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /create anyway/i }));
    await user.click(screen.getByRole("button", { name: /import guests/i }));
    expect(api.commitGuestImport).toHaveBeenCalledWith(
      "wedding",
      preview().batchId,
      expect.objectContaining({
        expectedVersion: 1,
        includedRowIds: [row.id],
        createAnywayRowIds: [row.id],
        idempotencyKey: expect.any(String),
      }),
    );
    expect(onImported).toHaveBeenCalledOnce();
    expect(
      within(screen.getByRole("status")).getByText(/1 guest/i),
    ).toBeVisible();
  });
});
