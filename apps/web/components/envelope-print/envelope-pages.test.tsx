// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { envelopeFixture } from "../../lib/envelope-print.test";
import { EnvelopePages } from "./envelope-pages";

describe("EnvelopePages", () => {
  it("renders hostile values as text and missing address only warns in address mode", () => {
    const data = {
      template: envelopeFixture,
      guests: [
        {
          id: "1",
          envelopeName: "<script>alert(1)</script>",
          postalAddress: null,
        },
      ],
    };
    const { container, rerender } = render(<EnvelopePages data={data} />);
    expect(screen.getByText("<script>alert(1)</script>")).toBeVisible();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByText(/missing postal address/i)).toBeNull();
    rerender(
      <EnvelopePages
        data={{ ...data, template: { ...envelopeFixture, showAddress: true } }}
      />,
    );
    expect(screen.getByText(/missing postal address/i)).toBeVisible();
  });
});
