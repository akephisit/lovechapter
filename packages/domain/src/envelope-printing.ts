import {
  ENVELOPE_ALIGNMENTS,
  ENVELOPE_FONT_FAMILIES,
  ENVELOPE_ORIENTATIONS,
  type EnvelopePrintDataInput,
  type EnvelopeTemplateInput,
} from "@lovechapter/contracts";

import { DomainValidationError } from "./errors";

export function normalizeEnvelopeTemplateInput(
  input: EnvelopeTemplateInput,
): EnvelopeTemplateInput {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || Array.from(name).length > 80)
    throw new DomainValidationError("Template name must be 1–80 characters");
  const bounded = (value: number, min: number, max: number) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max;
  if (
    !bounded(input.widthMm, 90, 330) ||
    !bounded(input.heightMm, 55, 480) ||
    ![
      input.marginTopMm,
      input.marginRightMm,
      input.marginBottomMm,
      input.marginLeftMm,
    ].every((value) => bounded(value, 0, 480)) ||
    input.widthMm - input.marginLeftMm - input.marginRightMm < 20 ||
    input.heightMm - input.marginTopMm - input.marginBottomMm < 20 ||
    (input.orientation === "portrait" &&
      (input.heightMm - input.marginLeftMm - input.marginRightMm < 20 ||
        input.widthMm - input.marginTopMm - input.marginBottomMm < 20)) ||
    !bounded(input.fontSizePt, 8, 72) ||
    !bounded(input.lineSpacingPercent, 80, 250) ||
    !ENVELOPE_ORIENTATIONS.includes(input.orientation) ||
    !ENVELOPE_ALIGNMENTS.includes(input.alignment) ||
    !ENVELOPE_FONT_FAMILIES.includes(input.fontFamily) ||
    typeof input.showAddress !== "boolean"
  ) {
    throw new DomainValidationError(
      "Invalid envelope dimensions or print settings",
    );
  }
  return {
    name,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    orientation: input.orientation,
    marginTopMm: input.marginTopMm,
    marginRightMm: input.marginRightMm,
    marginBottomMm: input.marginBottomMm,
    marginLeftMm: input.marginLeftMm,
    alignment: input.alignment,
    fontFamily: input.fontFamily,
    fontSizePt: input.fontSizePt,
    lineSpacingPercent: input.lineSpacingPercent,
    showAddress: input.showAddress,
  };
}

export function normalizeEnvelopePrintDataInput(
  input: EnvelopePrintDataInput,
): EnvelopePrintDataInput {
  if (
    !Array.isArray(input.guestIds) ||
    input.guestIds.length < 1 ||
    input.guestIds.length > 500 ||
    new Set(input.guestIds).size !== input.guestIds.length ||
    input.guestIds.some(
      (id) =>
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    ) ||
    Boolean(input.templateId) === Boolean(input.template) ||
    (input.templateId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.templateId,
      ))
  ) {
    throw new DomainValidationError("Invalid envelope print selection");
  }
  return input.template
    ? {
        guestIds: [...input.guestIds],
        template: normalizeEnvelopeTemplateInput(input.template),
      }
    : { guestIds: [...input.guestIds], templateId: input.templateId! };
}
