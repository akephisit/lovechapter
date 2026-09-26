import type { EnvelopeTemplateInput } from "@lovechapter/contracts";
import { normalizeEnvelopeTemplateInput } from "@lovechapter/domain";

export function envelopePageDimensions(template: EnvelopeTemplateInput) {
  const checked = normalizeEnvelopeTemplateInput(template);
  return checked.orientation === "landscape"
    ? { widthMm: checked.widthMm, heightMm: checked.heightMm }
    : { widthMm: checked.heightMm, heightMm: checked.widthMm };
}

export function buildEnvelopePrintCss(template: EnvelopeTemplateInput): string {
  const checked = normalizeEnvelopeTemplateInput(template);
  const { widthMm, heightMm } = envelopePageDimensions(checked);
  const font =
    checked.fontFamily === "noto-sans-thai"
      ? '"Noto Sans Thai Variable", sans-serif'
      : '"Noto Serif Thai Variable", serif';
  return `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  @media print {
    body > *:not(.envelope-print-portal) { display: none !important; }
    .envelope-print-portal, .envelope-print-root { display: block !important; position: static !important; margin: 0 !important; padding: 0 !important; }
    .envelope-print-page { width: ${widthMm}mm; height: ${heightMm}mm;
      padding: ${checked.marginTopMm}mm ${checked.marginRightMm}mm ${checked.marginBottomMm}mm ${checked.marginLeftMm}mm;
      text-align: ${checked.alignment}; font-family: ${font}; font-size: ${checked.fontSizePt}pt;
      line-height: ${checked.lineSpacingPercent}%; color: #000; background: #fff;
      display: flex; flex-direction: column; justify-content: center; overflow: hidden;
      margin: 0 !important; border: 0 !important; box-shadow: none !important;
      page-break-inside: avoid; break-inside: avoid; page-break-after: always; break-after: page; }
    .envelope-print-page:last-child { page-break-after: auto; break-after: auto; }
    .envelope-preview-warning, .envelope-print-controls { display: none !important; }
  }`;
}
