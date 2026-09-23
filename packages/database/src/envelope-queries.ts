import type { EnvelopeTemplateInput } from "@lovechapter/contracts";
import { sql, type SQL } from "drizzle-orm";

import {
  envelopePrintTemplates,
  guestPostalAddresses,
  guests,
  weddingMembers,
  weddings,
} from "./schema";

type Scope = { userId: string; weddingId: string };
const templateColumns = sql`${envelopePrintTemplates.id} as "id", ${envelopePrintTemplates.name} as "name",
  ${envelopePrintTemplates.widthMm} as "width_mm", ${envelopePrintTemplates.heightMm} as "height_mm",
  ${envelopePrintTemplates.orientation} as "orientation", ${envelopePrintTemplates.marginTopMm} as "margin_top_mm",
  ${envelopePrintTemplates.marginRightMm} as "margin_right_mm", ${envelopePrintTemplates.marginBottomMm} as "margin_bottom_mm",
  ${envelopePrintTemplates.marginLeftMm} as "margin_left_mm", ${envelopePrintTemplates.alignment} as "alignment",
  ${envelopePrintTemplates.fontFamily} as "font_family", ${envelopePrintTemplates.fontSizePt} as "font_size_pt",
  ${envelopePrintTemplates.lineSpacingPercent} as "line_spacing_percent", ${envelopePrintTemplates.showAddress} as "show_address",
  ${envelopePrintTemplates.createdAt} as "created_at", ${envelopePrintTemplates.updatedAt} as "updated_at"`;
const membership = (scope: Scope) => sql`exists (select 1 from ${weddingMembers}
  where ${weddingMembers.weddingId} = ${scope.weddingId} and ${weddingMembers.userId} = ${scope.userId})`;

export function buildLockEnvelopeWeddingQuery(scope: Scope): SQL {
  return sql`select ${weddings.id} as "id" from ${weddings}
    inner join ${weddingMembers} on ${weddingMembers.weddingId} = ${weddings.id}
      and ${weddingMembers.userId} = ${scope.userId}
    where ${weddings.id} = ${scope.weddingId} for update of ${weddings}`;
}
export function buildListEnvelopeTemplatesQuery(scope: Scope): SQL {
  return sql`select ${templateColumns} from ${envelopePrintTemplates}
    where ${envelopePrintTemplates.weddingId} = ${scope.weddingId} and ${membership(scope)}
    order by ${envelopePrintTemplates.updatedAt} desc, ${envelopePrintTemplates.id} desc limit 51`;
}
export function buildGetEnvelopeTemplateQuery(
  scope: Scope & { templateId: string },
): SQL {
  return sql`select ${templateColumns} from ${envelopePrintTemplates}
    where ${envelopePrintTemplates.weddingId} = ${scope.weddingId}
      and ${envelopePrintTemplates.id} = ${scope.templateId} and ${membership(scope)} limit 1`;
}
export function buildInsertEnvelopeTemplateQuery(
  input: Scope & { id: string; template: EnvelopeTemplateInput },
): SQL {
  const t = input.template;
  return sql`insert into ${envelopePrintTemplates}
    (${envelopePrintTemplates.id}, ${envelopePrintTemplates.weddingId}, ${envelopePrintTemplates.name},
     ${envelopePrintTemplates.widthMm}, ${envelopePrintTemplates.heightMm}, ${envelopePrintTemplates.orientation},
     ${envelopePrintTemplates.marginTopMm}, ${envelopePrintTemplates.marginRightMm},
     ${envelopePrintTemplates.marginBottomMm}, ${envelopePrintTemplates.marginLeftMm},
     ${envelopePrintTemplates.alignment}, ${envelopePrintTemplates.fontFamily},
     ${envelopePrintTemplates.fontSizePt}, ${envelopePrintTemplates.lineSpacingPercent}, ${envelopePrintTemplates.showAddress})
    select ${input.id}, ${input.weddingId}, ${t.name}, ${t.widthMm}, ${t.heightMm}, ${t.orientation},
      ${t.marginTopMm}, ${t.marginRightMm}, ${t.marginBottomMm}, ${t.marginLeftMm},
      ${t.alignment}, ${t.fontFamily}, ${t.fontSizePt}, ${t.lineSpacingPercent}, ${t.showAddress}
    where ${membership(input)} returning ${templateColumns}`;
}
export function buildUpdateEnvelopeTemplateQuery(
  input: Scope & { templateId: string; template: EnvelopeTemplateInput },
): SQL {
  const t = input.template;
  return sql`update ${envelopePrintTemplates} set
    ${envelopePrintTemplates.name} = ${t.name}, ${envelopePrintTemplates.widthMm} = ${t.widthMm},
    ${envelopePrintTemplates.heightMm} = ${t.heightMm}, ${envelopePrintTemplates.orientation} = ${t.orientation},
    ${envelopePrintTemplates.marginTopMm} = ${t.marginTopMm}, ${envelopePrintTemplates.marginRightMm} = ${t.marginRightMm},
    ${envelopePrintTemplates.marginBottomMm} = ${t.marginBottomMm}, ${envelopePrintTemplates.marginLeftMm} = ${t.marginLeftMm},
    ${envelopePrintTemplates.alignment} = ${t.alignment}, ${envelopePrintTemplates.fontFamily} = ${t.fontFamily},
    ${envelopePrintTemplates.fontSizePt} = ${t.fontSizePt}, ${envelopePrintTemplates.lineSpacingPercent} = ${t.lineSpacingPercent},
    ${envelopePrintTemplates.showAddress} = ${t.showAddress}, ${envelopePrintTemplates.updatedAt} = now()
    where ${envelopePrintTemplates.weddingId} = ${input.weddingId}
      and ${envelopePrintTemplates.id} = ${input.templateId} and ${membership(input)}
    returning ${templateColumns}`;
}
export function buildDeleteEnvelopeTemplateQuery(
  input: Scope & { templateId: string },
): SQL {
  return sql`delete from ${envelopePrintTemplates}
    where ${envelopePrintTemplates.weddingId} = ${input.weddingId}
      and ${envelopePrintTemplates.id} = ${input.templateId} and ${membership(input)}
    returning ${envelopePrintTemplates.id} as "id"`;
}
export function buildEnvelopePrintGuestsQuery(
  input: Scope & { guestIds: string[] },
): SQL {
  return sql`select ${guests.id} as "id", coalesce(nullif(${guests.envelopeName}, ''), ${guests.name}) as "envelope_name",
      ${guestPostalAddresses.addressLine1} as "address_line_1", ${guestPostalAddresses.addressLine2} as "address_line_2",
      ${guestPostalAddresses.locality} as "locality", ${guestPostalAddresses.administrativeArea} as "administrative_area",
      ${guestPostalAddresses.postalCode} as "postal_code", ${guestPostalAddresses.countryCode} as "country_code"
    from unnest(${sql.param(input.guestIds)}::uuid[]) with ordinality as requested(id, ordinality)
    inner join ${guests} on ${guests.id} = requested.id and ${guests.weddingId} = ${input.weddingId}
      and ${guests.archivedAt} is null
    inner join ${weddingMembers} on ${weddingMembers.weddingId} = ${guests.weddingId}
      and ${weddingMembers.userId} = ${input.userId}
    left join ${guestPostalAddresses} on ${guestPostalAddresses.weddingId} = ${guests.weddingId}
      and ${guestPostalAddresses.guestId} = ${guests.id}
    order by requested.ordinality`;
}
