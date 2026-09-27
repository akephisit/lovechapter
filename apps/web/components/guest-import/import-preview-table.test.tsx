// @vitest-environment jsdom
import type { GuestImportPreviewRow } from "@lovechapter/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UiLanguageProvider } from "../ui-language-provider";
import { ImportPreviewTable } from "./import-preview-table";

describe("ImportPreviewTable", () => {
  it("names known invalid CSV fields in Thai instead of hiding their cause", () => {
    const row: GuestImportPreviewRow = {
      id: "018f0000-0000-7000-8000-000000000004",
      rowNumber: 2,
      sourceName: "Nok",
      sourceAffiliation: null,
      candidate: null,
      included: true,
      errors: [
        "Invalid country code",
        "Invalid guest email",
        "Party allowance must be between 1 and 20",
      ],
      warnings: [],
    };
    render(
      <UiLanguageProvider language="th">
        <ImportPreviewTable
          rows={[row]}
          confirmed={new Set()}
          onConfirm={vi.fn()}
          onExclude={vi.fn()}
          busy={false}
        />
      </UiLanguageProvider>,
    );
    expect(screen.getByText(/รหัสประเทศไม่ถูกต้อง/)).toBeVisible();
    expect(screen.getByText(/อีเมลแขกไม่ถูกต้อง/)).toBeVisible();
    expect(
      screen.getByText(/จำนวนคนที่เชิญต้องอยู่ระหว่าง 1 ถึง 20/),
    ).toBeVisible();
  });
});
