import {
  ENVELOPE_PRESETS,
  type EnvelopeTemplateInput,
} from "@lovechapter/contracts";
import { describe, expect, it } from "vitest";

import { DomainValidationError } from "./errors";
import {
  normalizeEnvelopePrintDataInput,
  normalizeEnvelopeTemplateInput,
} from "./envelope-printing";

export const exampleEnvelope: EnvelopeTemplateInput = {
  name: "Default",
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
describe("envelope template validation", () => {
  it("defines physical DL, C5 and C6 dimensions", () => {
    expect(ENVELOPE_PRESETS).toEqual({
      DL: { widthMm: 220, heightMm: 110 },
      C5: { widthMm: 229, heightMm: 162 },
      C6: { widthMm: 162, heightMm: 114 },
    });
  });
  it("accepts bounded values and trims the name", () => {
    expect(
      normalizeEnvelopeTemplateInput({ ...exampleEnvelope, name: " Print " })
        .name,
    ).toBe("Print");
  });
  it.each([
    { widthMm: 89 },
    { widthMm: 331 },
    { heightMm: 54 },
    { heightMm: 481 },
    { widthMm: NaN },
    { widthMm: 220.5 },
    { marginLeftMm: -1 },
    { marginLeftMm: 110, marginRightMm: 100 },
    { marginTopMm: 55, marginBottomMm: 40 },
    { orientation: "portrait", marginLeftMm: 46, marginRightMm: 45 },
    { fontSizePt: 7 },
    { fontSizePt: 73 },
    { lineSpacingPercent: 79 },
    { lineSpacingPercent: 251 },
    { name: " " },
    { name: "x".repeat(81) },
    { alignment: "evil" },
    { fontFamily: "url(https://example.test/font)" },
    { orientation: "sideways" },
    { showAddress: "yes" },
  ])("rejects invalid template input %o", (change) => {
    expect(() =>
      normalizeEnvelopeTemplateInput({
        ...exampleEnvelope,
        ...change,
      } as EnvelopeTemplateInput),
    ).toThrow(DomainValidationError);
  });
  it("requires exactly one template and 1–500 distinct UUIDs", () => {
    const guestIds = ["018f0000-0000-7000-8000-000000000001"];
    expect(
      normalizeEnvelopePrintDataInput({ guestIds, template: exampleEnvelope })
        .guestIds,
    ).toEqual(guestIds);
    for (const input of [
      { guestIds, template: exampleEnvelope, templateId: guestIds[0]! },
      { guestIds },
      { guestIds: [], template: exampleEnvelope },
      { guestIds: [guestIds[0]!, guestIds[0]!], template: exampleEnvelope },
      { guestIds: Array(501).fill(guestIds[0]), template: exampleEnvelope },
    ])
      expect(() => normalizeEnvelopePrintDataInput(input)).toThrow(
        DomainValidationError,
      );
  });
});
