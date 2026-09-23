import type {
  EnvelopePrintData,
  PostalAddressInput,
} from "@lovechapter/contracts";

import {
  buildEnvelopePrintCss,
  envelopePageDimensions,
} from "../../lib/envelope-print";

export function EnvelopePages({ data }: { data: EnvelopePrintData }) {
  const { widthMm, heightMm } = envelopePageDimensions(data.template);
  return (
    <div className="envelope-print-root space-y-3">
      <style>{buildEnvelopePrintCss(data.template)}</style>
      {data.guests.map((guest) => (
        <div
          key={guest.id}
          className="envelope-print-page rounded border border-[#d7beb5] bg-white text-black shadow-sm"
          style={{
            width: `${widthMm}mm`,
            height: `${heightMm}mm`,
            padding: `${data.template.marginTopMm}mm ${data.template.marginRightMm}mm ${data.template.marginBottomMm}mm ${data.template.marginLeftMm}mm`,
            fontFamily:
              data.template.fontFamily === "noto-sans-thai"
                ? '"Noto Sans Thai Variable", sans-serif'
                : '"Noto Serif Thai Variable", serif',
            fontSize: `${data.template.fontSizePt}pt`,
            lineHeight: `${data.template.lineSpacingPercent}%`,
            textAlign: data.template.alignment,
          }}
        >
          <p>{guest.envelopeName}</p>
          {data.template.showAddress ? (
            guest.postalAddress ? (
              <address className="whitespace-pre-line not-italic">
                {addressLines(guest.postalAddress).map((line) => (
                  <span className="block" key={line}>
                    {line}
                  </span>
                ))}
              </address>
            ) : (
              <p className="envelope-preview-warning text-sm text-red-700">
                Missing postal address
              </p>
            )
          ) : null}
        </div>
      ))}
    </div>
  );
}

function addressLines(address: PostalAddressInput): string[] {
  return [
    address.addressLine1,
    address.addressLine2,
    [address.locality, address.administrativeArea, address.postalCode]
      .filter(Boolean)
      .join(" "),
    address.countryCode,
  ].filter((line): line is string => Boolean(line));
}
