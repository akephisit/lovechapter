// @vitest-environment jsdom
import type { EnvelopePrintData, GuestSummary } from "@lovechapter/contracts";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { envelopeFixture } from "../../lib/envelope-print.test";
import { EnvelopeWorkspace, type EnvelopeApi } from "./envelope-workspace";

const guest: GuestSummary = {
  id: "018f0000-0000-7000-8000-000000000001",
  name: "Nok",
  allowedPartySize: 1,
  affiliation: null,
  rsvp: null,
  createdAt: "2026-09-23T00:00:00.000Z",
};
function fixture(
  data: EnvelopePrintData = {
    template: envelopeFixture,
    guests: [{ id: guest.id, envelopeName: "Nok", postalAddress: null }],
  },
  guests: GuestSummary[] = [guest],
) {
  const api: EnvelopeApi = {
    listEnvelopeTemplates: vi.fn(async () => []),
    createEnvelopeTemplate: vi.fn(),
    updateEnvelopeTemplate: vi.fn(),
    deleteEnvelopeTemplate: vi.fn(),
    getEnvelopePrintData: vi.fn(async (_weddingId, input) => ({
      ...data,
      template: input.template ?? data.template,
    })),
  };
  render(<EnvelopeWorkspace weddingId="wedding" guests={guests} api={api} />);
  return api;
}
afterEach(() => vi.unstubAllGlobals());
describe("EnvelopeWorkspace", () => {
  it("caps selected loaded active guests at 500 and excludes archived guests", async () => {
    const many: GuestSummary[] = Array.from({ length: 501 }, (_, index) => ({
      ...guest,
      id: `018f0000-0000-7000-8000-${String(index).padStart(12, "0")}`,
      name: `Guest ${index}`,
    }));
    many.push({
      ...guest,
      id: crypto.randomUUID(),
      name: "Archived",
      archivedAt: "2026-09-23T00:00:00.000Z",
    });
    fixture(undefined, many);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /select loaded guests/i }));
    expect(screen.getByText(/500\/500/)).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /print guest 500/i }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("checkbox", { name: /print archived/i }),
    ).toBeNull();
  });
  it("keeps font failure visible after preview and allows retry", async () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.reject(new Error("font")) },
    });
    fixture();
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /print nok/i }));
    await screen.findByText("Nok", { selector: ".envelope-print-page p" });
    expect(screen.getByRole("alert")).toHaveTextContent(/fonts did not load/i);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    await user.click(screen.getByRole("button", { name: /retry fonts/i }));
    expect(
      await screen.findByRole("button", { name: /^print envelopes$/i }),
    ).toBeEnabled();
  });
  it("warns on missing address in address mode and blocks invalid custom dimensions", async () => {
    const api = fixture();
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /print nok/i }));
    await screen.findByText("Nok", { selector: ".envelope-print-page p" });
    await user.click(
      screen.getByRole("checkbox", { name: /print postal address/i }),
    );
    expect(await screen.findByText(/missing postal address/i)).toBeVisible();
    await user.clear(screen.getByRole("spinbutton", { name: /width \(mm\)/i }));
    await user.type(
      screen.getByRole("spinbutton", { name: /width \(mm\)/i }),
      "50",
    );
    expect(
      screen.getByRole("button", { name: /save template/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^print envelopes$/i }),
    ).toBeDisabled();
    expect(api.getEnvelopePrintData).toHaveBeenCalled();
  });
  it("selects active guests separately and previews name-only with no address", async () => {
    const api = fixture();
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /print nok/i }));
    expect(
      await screen.findByText("Nok", { selector: ".envelope-print-page p" }),
    ).toBeVisible();
    expect(api.getEnvelopePrintData).toHaveBeenCalledWith(
      "wedding",
      expect.objectContaining({ guestIds: [guest.id] }),
    );
    expect(
      screen.queryByText(/missing postal address/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/test one physical envelope/i)).toBeVisible();
  });
  it("waits for self-hosted fonts before printing and remains retryable on rejection", async () => {
    let resolve!: () => void;
    const ready = new Promise<void>((done) => {
      resolve = done;
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready },
    });
    const print = vi.fn();
    vi.stubGlobal("print", print);
    fixture();
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /print nok/i }));
    expect(
      screen.getByRole("button", { name: /^print envelopes$/i }),
    ).toBeDisabled();
    resolve();
    expect(
      await screen.findByRole("button", { name: /^print envelopes$/i }),
    ).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: /^print envelopes$/i }),
    );
    expect(print).toHaveBeenCalledOnce();
    expect(
      document.body.querySelector(
        ".envelope-print-portal .envelope-print-page",
      ),
    ).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(
      document.body.querySelector(".envelope-print-portal"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^print envelopes$/i }),
    ).toBeEnabled();
  });
  it("keeps the template editor stable while a save is pending", async () => {
    let complete!: (
      value: Awaited<ReturnType<EnvelopeApi["createEnvelopeTemplate"]>>,
    ) => void;
    const pending = new Promise<
      Awaited<ReturnType<EnvelopeApi["createEnvelopeTemplate"]>>
    >((resolve) => {
      complete = resolve;
    });
    const api = fixture();
    vi.mocked(api.createEnvelopeTemplate).mockReturnValue(pending);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /save template/i }));
    expect(
      screen.getByRole("textbox", { name: /template name/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: /saved template/i }),
    ).toBeDisabled();
    await act(async () => {
      complete({
        ...envelopeFixture,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await pending;
    });
    expect(
      screen.getByRole("textbox", { name: /template name/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /update template/i }),
    ).toBeVisible();
  });
  it("reports a print-dialog failure without marking fonts as failed", async () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    vi.stubGlobal(
      "print",
      vi.fn(() => {
        throw new Error("Print dialog blocked");
      }),
    );
    fixture();
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /print nok/i }));
    await user.click(
      await screen.findByRole("button", { name: /^print envelopes$/i }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/print dialog/i);
    expect(
      screen.queryByRole("button", { name: /retry fonts/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^print envelopes$/i }),
    ).toBeEnabled();
  });
});
