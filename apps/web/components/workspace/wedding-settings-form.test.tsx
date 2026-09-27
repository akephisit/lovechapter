// @vitest-environment jsdom

import type { WeddingSummary } from "@lovechapter/contracts";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UiLanguageProvider } from "../ui-language-provider";
import { WeddingSettingsForm } from "./wedding-settings-form";

const wedding: WeddingSummary = {
  id: "wed",
  name: "Mali & Arun",
  weddingDate: "2027-02-14",
  timeZone: "Asia/Bangkok",
  locale: "en",
  role: "owner",
  createdAt: "2026-09-28T00:00:00.000Z",
};

describe("WeddingSettingsForm", () => {
  it("can clear the date and save name, zone, and locale without changing UI language", async () => {
    const updateWedding = vi.fn(async (_id: string, input: unknown) => ({
      ...wedding,
      ...(input as object),
    }));
    const onSaved = vi.fn();
    render(
      <UiLanguageProvider language="en">
        <WeddingSettingsForm
          wedding={wedding}
          updateWedding={updateWedding}
          onSaved={onSaved}
          onDirtyChange={vi.fn()}
        />
      </UiLanguageProvider>,
    );
    await userEvent.clear(screen.getByLabelText("Wedding date (optional)"));
    await userEvent.clear(screen.getByLabelText("Wedding name"));
    await userEvent.type(screen.getByLabelText("Wedding name"), "New chapter");
    await userEvent.click(
      screen.getByRole("button", { name: "Save settings" }),
    );
    expect(updateWedding).toHaveBeenCalledWith("wed", {
      name: "New chapter",
      weddingDate: null,
      timeZone: "Asia/Bangkok",
      locale: "en",
    });
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New chapter", weddingDate: null }),
    );
    expect(
      screen.getByRole("heading", { name: "Wedding settings" }),
    ).toBeVisible();
  });

  it("retains the draft on failure and reports a localized retryable error", async () => {
    const updateWedding = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <UiLanguageProvider language="th">
        <WeddingSettingsForm
          wedding={wedding}
          updateWedding={updateWedding}
          onSaved={vi.fn()}
          onDirtyChange={vi.fn()}
        />
      </UiLanguageProvider>,
    );
    await userEvent.clear(screen.getByLabelText("ชื่องานแต่ง"));
    await userEvent.type(screen.getByLabelText("ชื่องานแต่ง"), "วันของเรา");
    await userEvent.click(
      screen.getByRole("button", { name: "บันทึกการตั้งค่า" }),
    );
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByLabelText("ชื่องานแต่ง")).toHaveValue("วันของเรา");
  });

  it("shows values without edit controls for a Collaborator", () => {
    render(
      <UiLanguageProvider language="en">
        <WeddingSettingsForm
          wedding={{ ...wedding, role: "collaborator" }}
          updateWedding={vi.fn()}
          onSaved={vi.fn()}
          onDirtyChange={vi.fn()}
        />
      </UiLanguageProvider>,
    );
    expect(screen.getByText("Mali & Arun")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Save settings" }),
    ).not.toBeInTheDocument();
  });
  it("locks the draft while saving so a late response cannot erase new typing", async () => {
    let resolveSave!: (value: WeddingSummary) => void;
    const updateWedding = vi.fn(
      () => new Promise<WeddingSummary>((resolve) => (resolveSave = resolve)),
    );
    render(
      <WeddingSettingsForm
        wedding={wedding}
        updateWedding={updateWedding}
        onSaved={vi.fn()}
        onDirtyChange={vi.fn()}
      />,
    );
    const name = screen.getByLabelText("Wedding name");
    await userEvent.clear(name);
    await userEvent.type(name, "Saved name");
    await userEvent.click(
      screen.getByRole("button", { name: "Save settings" }),
    );
    expect(name).toBeDisabled();
    await act(async () => resolveSave({ ...wedding, name: "Saved name" }));
    expect(name).toHaveValue("Saved name");
  });
});
