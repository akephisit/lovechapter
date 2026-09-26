import type { GuestImportMapping } from "@lovechapter/contracts";
import type {
  GuestImportStagedRow,
  GuestImportCandidateKey,
} from "@lovechapter/domain";
import { sql, type SQL } from "drizzle-orm";

import {
  guestImportBatches,
  guestImportRows,
  guests,
  weddingMembers,
} from "./schema";

type Scope = { userId: string; weddingId: string; batchId: string };

export function buildCleanupExpiredGuestImportsQuery(input: {
  now: string;
  limit: 500;
}): SQL {
  return sql`with expired as (
    select ${guestImportBatches.weddingId} as "wedding_id", ${guestImportBatches.id} as "id"
    from ${guestImportBatches}
    where ${guestImportBatches.expiresAt} <= ${input.now}
    order by ${guestImportBatches.expiresAt}, ${guestImportBatches.weddingId}, ${guestImportBatches.id}
    limit ${input.limit}
    for update skip locked
  )
  delete from ${guestImportBatches} using expired
  where ${guestImportBatches.weddingId} = expired."wedding_id"
    and ${guestImportBatches.id} = expired."id"
  returning ${guestImportBatches.id} as "id"`;
}

export function buildStageGuestImportBatchQuery(input: {
  id: string;
  userId: string;
  weddingId: string;
  sourceSha256: string;
  headers: string[];
  mapping: GuestImportMapping;
  affiliationMappings: Record<string, string>;
  rowCount: number;
  validCount: number;
  warningCount: number;
  invalidCount: number;
  excludedCount: number;
  expiresAt: string;
}): SQL {
  return sql`insert into ${guestImportBatches}
    (${sql.identifier(guestImportBatches.id.name)}, ${sql.identifier(guestImportBatches.weddingId.name)}, ${sql.identifier(guestImportBatches.createdByUserId.name)},
     ${sql.identifier(guestImportBatches.sourceSha256.name)}, ${sql.identifier(guestImportBatches.headers.name)}, ${sql.identifier(guestImportBatches.mapping.name)},
     ${sql.identifier(guestImportBatches.affiliationMappings.name)}, ${sql.identifier(guestImportBatches.rowCount.name)},
     ${sql.identifier(guestImportBatches.validCount.name)}, ${sql.identifier(guestImportBatches.warningCount.name)},
     ${sql.identifier(guestImportBatches.invalidCount.name)}, ${sql.identifier(guestImportBatches.excludedCount.name)}, ${sql.identifier(guestImportBatches.expiresAt.name)})
    select ${input.id}, ${input.weddingId}, ${input.userId}, ${input.sourceSha256},
      ${JSON.stringify(input.headers)}::jsonb, ${JSON.stringify(input.mapping)}::jsonb,
      ${JSON.stringify(input.affiliationMappings)}::jsonb, ${input.rowCount}, ${input.validCount},
      ${input.warningCount}, ${input.invalidCount}, ${input.excludedCount}, ${input.expiresAt}
    from ${weddingMembers}
    where ${weddingMembers.weddingId} = ${input.weddingId}
      and ${weddingMembers.userId} = ${input.userId}
    returning ${guestImportBatches.id} as "id"`;
}

export function buildLoadGuestImportCommitRowsQuery(input: Scope): SQL {
  return sql`select ${guestImportRows.id} as "id", ${guestImportRows.rowNumber} as "row_number",
      ${guestImportRows.candidate} as "candidate", ${guestImportRows.errors} as "errors",
      ${guestImportRows.warnings} as "warnings", ${guestImportRows.included} as "included",
      ${guestImportRows.sourceValues} as "source_values"
    from ${guestImportRows}
    inner join ${guestImportBatches}
      on ${guestImportBatches.weddingId} = ${guestImportRows.weddingId}
     and ${guestImportBatches.id} = ${guestImportRows.batchId}
     and ${guestImportBatches.expiresAt} > now()
    inner join ${weddingMembers}
      on ${weddingMembers.weddingId} = ${guestImportRows.weddingId}
     and ${weddingMembers.userId} = ${input.userId}
    where ${guestImportRows.weddingId} = ${input.weddingId}
      and ${guestImportRows.batchId} = ${input.batchId}
    order by ${guestImportRows.rowNumber} asc, ${guestImportRows.id} asc
    limit 5001`;
}

export type ImportedGuestInsert = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  allowedPartySize: number;
  affiliationId: string | null;
  envelopeName: string | null;
  note: string | null;
};

export function buildInsertImportedGuestsQuery(
  input: Scope & { guests: ImportedGuestInsert[] },
): SQL {
  const payload = JSON.stringify(
    input.guests.map((guest) => ({
      id: guest.id,
      name: guest.name,
      email: guest.email,
      phone: guest.phone,
      allowed_party_size: guest.allowedPartySize,
      affiliation_id: guest.affiliationId,
      envelope_name: guest.envelopeName,
      note: guest.note,
    })),
  );
  return sql`insert into ${guests}
    (${sql.identifier(guests.id.name)}, ${sql.identifier(guests.weddingId.name)}, ${sql.identifier(guests.name.name)}, ${sql.identifier(guests.email.name)}, ${sql.identifier(guests.phone.name)},
     ${sql.identifier(guests.allowedPartySize.name)}, ${sql.identifier(guests.affiliationId.name)}, ${sql.identifier(guests.envelopeName.name)}, ${sql.identifier(guests.note.name)})
    select "source"."id", ${input.weddingId}, "source"."name", "source"."email", "source"."phone",
      "source"."allowed_party_size", "source"."affiliation_id", "source"."envelope_name", "source"."note"
    from jsonb_to_recordset(${payload}::jsonb) as "source"
      ("id" uuid, "name" text, "email" text, "phone" text, "allowed_party_size" integer,
       "affiliation_id" uuid, "envelope_name" text, "note" text)
    inner join ${guestImportBatches}
      on ${guestImportBatches.weddingId} = ${input.weddingId}
     and ${guestImportBatches.id} = ${input.batchId}
     and ${guestImportBatches.status} = 'previewed'
    inner join ${weddingMembers}
      on ${weddingMembers.weddingId} = ${guestImportBatches.weddingId}
     and ${weddingMembers.userId} = ${input.userId}
    returning ${guests.id} as "id"`;
}

export type ImportedAddressInsert = {
  guestId: string;
  addressLine1: string;
  addressLine2?: string;
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
  countryCode?: string;
};

export function buildInsertImportedAddressesQuery(
  input: Scope & { addresses: ImportedAddressInsert[] },
): SQL {
  const payload = JSON.stringify(
    input.addresses.map((address) => ({
      guest_id: address.guestId,
      address_line_1: address.addressLine1,
      address_line_2: address.addressLine2 ?? null,
      locality: address.locality ?? null,
      administrative_area: address.administrativeArea ?? null,
      postal_code: address.postalCode ?? null,
      country_code: address.countryCode ?? null,
    })),
  );
  return sql`insert into "guest_postal_addresses"
    ("wedding_id", "guest_id", "address_line_1", "address_line_2", "locality",
     "administrative_area", "postal_code", "country_code")
    select ${input.weddingId}, "source"."guest_id", "source"."address_line_1",
      "source"."address_line_2", "source"."locality", "source"."administrative_area",
      "source"."postal_code", "source"."country_code"
    from jsonb_to_recordset(${payload}::jsonb) as "source"
      ("guest_id" uuid, "address_line_1" text, "address_line_2" text, "locality" text,
       "administrative_area" text, "postal_code" text, "country_code" text)
    inner join ${guests}
      on ${guests.weddingId} = ${input.weddingId} and ${guests.id} = "source"."guest_id"
    inner join ${guestImportBatches}
      on ${guestImportBatches.weddingId} = ${input.weddingId}
     and ${guestImportBatches.id} = ${input.batchId}
     and ${guestImportBatches.status} = 'previewed'
    inner join ${weddingMembers}
      on ${weddingMembers.weddingId} = ${guestImportBatches.weddingId}
     and ${weddingMembers.userId} = ${input.userId}
    returning "guest_id" as "id"`;
}

export function buildMarkGuestImportCommittedQuery(
  input: Scope & {
    expectedVersion: number;
    idempotencyKey: string;
    result: { created: number; excluded: number; guestIds: string[] };
  },
): SQL {
  return sql`update ${guestImportBatches}
    set ${sql.identifier(guestImportBatches.status.name)} = 'committed',
        ${sql.identifier(guestImportBatches.commitIdempotencyKey.name)} = ${input.idempotencyKey},
        ${sql.identifier(guestImportBatches.commitResult.name)} = ${JSON.stringify(input.result)}::jsonb,
        ${sql.identifier(guestImportBatches.committedAt.name)} = now(),
        ${sql.identifier(guestImportBatches.updatedAt.name)} = now()
    where ${guestImportBatches.weddingId} = ${input.weddingId}
      and ${guestImportBatches.id} = ${input.batchId}
      and ${guestImportBatches.status} = 'previewed'
      and ${guestImportBatches.previewVersion} = ${input.expectedVersion}
      and ${guestImportBatches.expiresAt} > now()
      and exists (select 1 from ${weddingMembers}
        where ${weddingMembers.weddingId} = ${input.weddingId}
          and ${weddingMembers.userId} = ${input.userId})
    returning ${guestImportBatches.id} as "id"`;
}

export function buildInsertGuestImportRowsQuery(
  input: Scope & { rows: GuestImportStagedRow[] },
): SQL {
  const payload = JSON.stringify(
    input.rows.map((row) => ({
      id: row.id,
      row_number: row.rowNumber,
      source_values: row.values,
      candidate: row.candidate,
      errors: row.errors,
      warnings: row.warnings,
      included: row.included,
    })),
  );
  return sql`insert into ${guestImportRows}
    (${sql.identifier(guestImportRows.id.name)}, ${sql.identifier(guestImportRows.weddingId.name)}, ${sql.identifier(guestImportRows.batchId.name)},
     ${sql.identifier(guestImportRows.rowNumber.name)}, ${sql.identifier(guestImportRows.sourceValues.name)}, ${sql.identifier(guestImportRows.candidate.name)},
     ${sql.identifier(guestImportRows.errors.name)}, ${sql.identifier(guestImportRows.warnings.name)}, ${sql.identifier(guestImportRows.included.name)})
    select "source"."id", ${input.weddingId}, ${input.batchId}, "source"."row_number",
      "source"."source_values", "source"."candidate", "source"."errors", "source"."warnings", "source"."included"
    from jsonb_to_recordset(${payload}::jsonb) as "source"
      ("id" uuid, "row_number" integer, "source_values" jsonb, "candidate" jsonb,
       "errors" jsonb, "warnings" jsonb, "included" boolean)
    inner join ${guestImportBatches}
      on ${guestImportBatches.weddingId} = ${input.weddingId}
     and ${guestImportBatches.id} = ${input.batchId}
    inner join ${weddingMembers}
      on ${weddingMembers.weddingId} = ${guestImportBatches.weddingId}
     and ${weddingMembers.userId} = ${input.userId}
    returning ${guestImportRows.id} as "id"`;
}

export function buildGuestImportBatchQuery(
  input: Scope,
  lock: boolean = false,
): SQL {
  return sql`select ${guestImportBatches.id} as "id", ${guestImportBatches.headers} as "headers",
      ${guestImportBatches.mapping} as "mapping", ${guestImportBatches.affiliationMappings} as "affiliation_mappings",
      ${guestImportBatches.previewVersion} as "preview_version", ${guestImportBatches.status} as "status",
      ${guestImportBatches.rowCount} as "row_count", ${guestImportBatches.validCount} as "valid_count",
      ${guestImportBatches.warningCount} as "warning_count", ${guestImportBatches.invalidCount} as "invalid_count",
      ${guestImportBatches.excludedCount} as "excluded_count",
      ${guestImportBatches.commitIdempotencyKey} as "commit_idempotency_key",
      ${guestImportBatches.commitResult} as "commit_result"
    from ${guestImportBatches}
    inner join ${weddingMembers}
      on ${weddingMembers.weddingId} = ${guestImportBatches.weddingId}
     and ${weddingMembers.userId} = ${input.userId}
    where ${guestImportBatches.weddingId} = ${input.weddingId}
      and ${guestImportBatches.id} = ${input.batchId}
      and ${guestImportBatches.expiresAt} > now()
    ${lock ? sql`for update of ${guestImportBatches}` : sql``}`;
}

export function buildGuestImportPreviewQuery(
  input: Scope & {
    limit: number;
    cursor?: { rowNumber: number; id: string };
  },
): SQL {
  const cursor = input.cursor
    ? sql`and (${guestImportRows.rowNumber}, ${guestImportRows.id}) > (${input.cursor.rowNumber}, ${input.cursor.id})`
    : sql``;
  return sql`select ${guestImportRows.id} as "id", ${guestImportRows.rowNumber} as "row_number",
      ${guestImportRows.candidate} as "candidate", ${guestImportRows.errors} as "errors",
      ${guestImportRows.warnings} as "warnings", ${guestImportRows.included} as "included"
    from ${guestImportRows}
    inner join ${guestImportBatches}
      on ${guestImportBatches.weddingId} = ${guestImportRows.weddingId}
     and ${guestImportBatches.id} = ${guestImportRows.batchId}
     and ${guestImportBatches.expiresAt} > now()
    inner join ${weddingMembers}
      on ${weddingMembers.weddingId} = ${guestImportRows.weddingId}
     and ${weddingMembers.userId} = ${input.userId}
    where ${guestImportRows.weddingId} = ${input.weddingId}
      and ${guestImportRows.batchId} = ${input.batchId}
      ${cursor}
    order by ${guestImportRows.rowNumber} asc, ${guestImportRows.id} asc
    limit ${input.limit + 1}`;
}

export function buildLoadGuestImportRowsQuery(input: Scope): SQL {
  return sql`select ${guestImportRows.id} as "id", ${guestImportRows.rowNumber} as "row_number",
      ${guestImportRows.sourceValues} as "source_values", ${guestImportRows.included} as "included"
    from ${guestImportRows}
    inner join ${weddingMembers}
      on ${weddingMembers.weddingId} = ${guestImportRows.weddingId}
     and ${weddingMembers.userId} = ${input.userId}
    where ${guestImportRows.weddingId} = ${input.weddingId}
      and ${guestImportRows.batchId} = ${input.batchId}
    order by ${guestImportRows.rowNumber} asc, ${guestImportRows.id} asc
    limit 5001`;
}

export function buildGuestImportDuplicateLookupQuery(input: {
  userId: string;
  weddingId: string;
  candidates: GuestImportCandidateKey[];
}): SQL {
  const payload = JSON.stringify(
    input.candidates.map((item) => ({
      row_id: item.rowId,
      normalized_email: item.normalizedEmail,
      normalized_name: item.normalizedName,
      normalized_phone: item.normalizedPhone,
    })),
  );
  return sql`with "source" as (
      select "data"."row_id", "data"."normalized_email", "data"."normalized_name", "data"."normalized_phone"
        from jsonb_to_recordset(${payload}::jsonb) as "data"
        ("row_id" uuid, "normalized_email" text, "normalized_name" text, "normalized_phone" text)
    ), "authorized_guests" as (
      select ${guests.name} as "name", ${guests.email} as "email", ${guests.phone} as "phone"
      from ${guests}
      inner join ${weddingMembers}
        on ${weddingMembers.weddingId} = ${guests.weddingId}
       and ${weddingMembers.userId} = ${input.userId}
      where ${guests.weddingId} = ${input.weddingId}
        and ${guests.archivedAt} is null
    )
    select distinct "source"."row_id" as "row_id", 'email' as "kind"
      from "source" inner join "authorized_guests" on "source"."normalized_email" is not null
       and lower("authorized_guests"."email") = "source"."normalized_email"
    union
    select distinct "source"."row_id" as "row_id", 'name_phone' as "kind"
      from "source" inner join "authorized_guests" on "source"."normalized_phone" is not null
       and lower("authorized_guests"."name") = "source"."normalized_name"
       and "authorized_guests"."phone" = "source"."normalized_phone"`;
}

export function buildReplaceGuestImportRowsQuery(
  input: Scope & { rows: GuestImportStagedRow[] },
): SQL {
  const payload = JSON.stringify(
    input.rows.map((row) => ({
      id: row.id,
      candidate: row.candidate,
      errors: row.errors,
      warnings: row.warnings,
      included: row.included,
    })),
  );
  return sql`update ${guestImportRows}
    set ${sql.identifier(guestImportRows.candidate.name)} = "source"."candidate",
        ${sql.identifier(guestImportRows.errors.name)} = "source"."errors",
        ${sql.identifier(guestImportRows.warnings.name)} = "source"."warnings",
        ${sql.identifier(guestImportRows.included.name)} = "source"."included"
    from jsonb_to_recordset(${payload}::jsonb) as "source"
      ("id" uuid, "candidate" jsonb, "errors" jsonb, "warnings" jsonb, "included" boolean)
    where ${guestImportRows.weddingId} = ${input.weddingId}
      and ${guestImportRows.batchId} = ${input.batchId}
      and ${guestImportRows.id} = "source"."id"
      and exists (select 1 from ${weddingMembers}
        where ${weddingMembers.weddingId} = ${input.weddingId}
          and ${weddingMembers.userId} = ${input.userId})
    returning ${guestImportRows.id} as "id"`;
}

export function buildUpdateGuestImportPreviewQuery(
  input: Scope & {
    expectedVersion: number;
    mapping: GuestImportMapping;
    affiliationMappings: Record<string, string>;
    validCount: number;
    warningCount: number;
    invalidCount: number;
    excludedCount: number;
  },
): SQL {
  return sql`update ${guestImportBatches}
    set ${sql.identifier(guestImportBatches.mapping.name)} = ${JSON.stringify(input.mapping)}::jsonb,
        ${sql.identifier(guestImportBatches.affiliationMappings.name)} = ${JSON.stringify(input.affiliationMappings)}::jsonb,
        ${sql.identifier(guestImportBatches.previewVersion.name)} = ${guestImportBatches.previewVersion} + 1,
        ${sql.identifier(guestImportBatches.validCount.name)} = ${input.validCount},
        ${sql.identifier(guestImportBatches.warningCount.name)} = ${input.warningCount},
        ${sql.identifier(guestImportBatches.invalidCount.name)} = ${input.invalidCount},
        ${sql.identifier(guestImportBatches.excludedCount.name)} = ${input.excludedCount},
        ${sql.identifier(guestImportBatches.updatedAt.name)} = now()
    where ${guestImportBatches.weddingId} = ${input.weddingId}
      and ${guestImportBatches.id} = ${input.batchId}
      and ${guestImportBatches.status} = 'previewed'
      and ${guestImportBatches.previewVersion} = ${input.expectedVersion}
      and ${guestImportBatches.expiresAt} > now()
      and exists (select 1 from ${weddingMembers}
        where ${weddingMembers.weddingId} = ${input.weddingId}
          and ${weddingMembers.userId} = ${input.userId})
    returning ${guestImportBatches.id} as "id"`;
}
