// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UiLanguageProvider } from "../ui-language-provider";
import { GuestForm } from "./guest-form";

describe("GuestForm", () => {
  it("keeps a Unicode name and country code unchanged in a Thai form", async () => {
    const onCreate = vi.fn(async () => undefined);
    render(
      <UiLanguageProvider language="th">
        <GuestForm affiliations={[]} busy={false} onCreate={onCreate} />
      </UiLanguageProvider>,
    );
    await userEvent.type(screen.getByLabelText("ชื่อแขก"), "李 & มะลิ");
    await userEvent.click(
      screen.getByText("ข้อมูลติดต่อ ซอง และที่อยู่ (ไม่บังคับ)"),
    );
    await userEvent.click(screen.getByLabelText("เพิ่มที่อยู่ไปรษณีย์"));
    await userEvent.type(screen.getByLabelText("ที่อยู่บรรทัดที่ 1"), "Tokyo");
    await userEvent.type(screen.getByLabelText("รหัสประเทศ"), "JP");
    await userEvent.click(screen.getByRole("button", { name: "เพิ่มแขก" }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "李 & มะลิ",
        postalAddress: expect.objectContaining({ countryCode: "JP" }),
      }),
    );
  });
});
