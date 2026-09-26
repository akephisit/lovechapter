import { describe, expect, it } from "vitest";
import type { EnvelopeTemplateInput } from "@lovechapter/contracts";
import {
  buildEnvelopePrintCss,
  envelopePageDimensions,
} from "./envelope-print";

export const envelopeFixture: EnvelopeTemplateInput = {
  name: "DL",
  widthMm: 220,
  heightMm: 110,
  orientation: "landscape",
  marginTopMm: 10,
  marginRightMm: 10,
  marginBottomMm: 10,
  marginLeftMm: 10,
  alignment: "center",
  fontFamily: "noto-sans-thai",
  fontSizePt: 18,
  lineSpacingPercent: 130,
  showAddress: false,
};
describe("safe envelope print CSS", () => {
  it("formats physical page and bounded print properties", () => {
    expect(envelopePageDimensions(envelopeFixture)).toEqual({
      widthMm: 220,
      heightMm: 110,
    });
    const css = buildEnvelopePrintCss(envelopeFixture);
    expect(css).toContain("size: 220mm 110mm");
    expect(css).toContain("margin: 0");
    expect(css).toContain("font-size: 18pt");
    expect(css).toContain("line-height: 130%");
    expect(css).toContain("page-break-after: always");
    expect(css).toMatch(
      /body > \*:not\(\.envelope-print-portal\)\s*\{\s*display: none !important/,
    );
    expect(css).not.toContain("NaN");
  });
  it("swaps portrait dimensions and refuses unvalidated CSS values", () => {
    expect(
      envelopePageDimensions({ ...envelopeFixture, orientation: "portrait" }),
    ).toEqual({ widthMm: 110, heightMm: 220 });
    expect(() =>
      buildEnvelopePrintCss({ ...envelopeFixture, fontSizePt: NaN }),
    ).toThrow();
    expect(() =>
      buildEnvelopePrintCss({
        ...envelopeFixture,
        fontFamily: "evil" as EnvelopeTemplateInput["fontFamily"],
      }),
    ).toThrow();
  });
});
