// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { StandardCodeCombobox } from "./standard-code-combobox";

describe("StandardCodeCombobox", () => {
  it("scrolls the keyboard-active option into view and keeps list options out of Tab order", async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scroll,
    });
    render(
      <StandardCodeCombobox
        kind="country"
        uiLanguage="en"
        id="country"
        name="countryCode"
        optional
      />,
    );
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    const openScrollCount = scroll.mock.calls.length;
    await userEvent.keyboard(
      "{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}",
    );
    expect(scroll.mock.calls.length).toBeGreaterThan(openScrollCount);
    expect(
      screen.getAllByRole("option").every((option) => option.tabIndex === -1),
    ).toBe(true);
  });
  it("searches and selects a country by keyboard, submitting only the code", async () => {
    const { container } = render(
      <>
        <label htmlFor="country">Country</label>
        <StandardCodeCombobox
          kind="country"
          uiLanguage="en"
          id="country"
          name="countryCode"
          optional
        />
      </>,
    );
    const input = screen.getByRole("combobox", { name: "Country" });
    await userEvent.type(input, "Thailand{ArrowDown}{Enter}");
    expect(container.querySelector('input[name="countryCode"]')).toHaveValue(
      "TH",
    );
    await userEvent.clear(input);
    await userEvent.type(input, "ZZZ");
    expect(container.querySelector('input[name="countryCode"]')).toHaveValue(
      "",
    );
  });

  it("does not validate a typed but unselected required code", async () => {
    const { container } = render(
      <StandardCodeCombobox
        kind="currency"
        uiLanguage="en"
        id="currency"
        name="currency"
      />,
    );
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "ZZZ");
    expect(container.querySelector('input[name="currency"]')).toHaveValue("");
    expect((input as HTMLInputElement).checkValidity()).toBe(false);
  });

  it("preserves a stored valid locale absent from curated choices", () => {
    const { container } = render(
      <StandardCodeCombobox
        kind="locale"
        uiLanguage="th"
        id="locale"
        name="locale"
        defaultValue="fr-CA"
      />,
    );
    expect(container.querySelector('input[name="locale"]')).toHaveValue(
      "fr-CA",
    );
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toContain(
      "fr-CA",
    );
  });

  it("retains a valid locale extension that is not in the curated list", () => {
    const stored = "fr-CA-u-ca-gregory";
    const { container } = render(
      <StandardCodeCombobox
        kind="locale"
        uiLanguage="en"
        id="locale-extension"
        name="locale"
        defaultValue={stored}
      />,
    );
    expect(container.querySelector('input[name="locale"]')).toHaveValue(stored);
  });

  it("allows an optional country to be blank", () => {
    const { container } = render(
      <StandardCodeCombobox
        kind="country"
        uiLanguage="th"
        id="country"
        name="countryCode"
        optional
      />,
    );
    expect(container.querySelector('input[name="countryCode"]')).toHaveValue(
      "",
    );
  });

  it("refreshes a selected zone label when the wedding date changes", () => {
    const props = {
      kind: "timeZone" as const,
      uiLanguage: "en" as const,
      id: "zone",
      name: "timeZone",
      value: "America/New_York",
    };
    const { rerender } = render(
      <StandardCodeCombobox {...props} date="2026-01-15" />,
    );
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toContain(
      "GMT-5",
    );
    rerender(<StandardCodeCombobox {...props} date="2026-07-15" />);
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toContain(
      "GMT-4",
    );
  });
});
