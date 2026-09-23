import type { Attendance, PostalAddressInput } from "@lovechapter/contracts";
import type {
  GuestListRepositoryInput,
  ListCursor,
  NormalizedGuestUpdate,
} from "@lovechapter/domain";
import { sql, type SQL } from "drizzle-orm";

import {
  guestAffiliations,
  guestPostalAddresses,
  guests,
  invitations,
  rsvps,
  users,
  weddingMembers,
  weddings,
} from "./schema";

export function buildSyncUserQuery(input: {
  id: string;
  provider: string;
  subject: string;
  displayName: string;
  email: string | null;
}): SQL {
  return sql`insert into ${users}
      (${sql.identifier(users.id.name)}, ${sql.identifier(users.authProvider.name)}, ${sql.identifier(users.authSubject.name)}, ${sql.identifier(users.displayName.name)}, ${sql.identifier(users.email.name)})
    values (${input.id}, ${input.provider}, ${input.subject}, ${input.displayName}, ${input.email})
    on conflict ("auth_provider","auth_subject") do update set
      "email" = excluded."email",
      "updated_at" = now()
    returning
      ${users.id} as "id",
      ${users.displayName} as "display_name",
      ${users.email} as "email",
      ${users.onboardingCompletedAt} as "onboarding_completed_at"`;
}

export function buildUpdateUserProfileQuery(input: {
  userId: string;
  displayName: string;
}): SQL {
  return sql`update ${users}
    set ${sql.identifier(users.displayName.name)} = ${input.displayName},
        ${sql.identifier(users.onboardingCompletedAt.name)} = now(),
        ${sql.identifier(users.updatedAt.name)} = now()
    where ${users.id} = ${input.userId}
    returning
      ${users.id} as "id",
      ${users.displayName} as "display_name",
      ${users.email} as "email",
      ${users.onboardingCompletedAt} as "onboarding_completed_at"`;
}

export function buildCreateWeddingQuery(input: {
  id: string;
  userId: string;
  name: string;
  weddingDate: string | null;
  timeZone: string;
  locale: string;
}): SQL {
  return sql`insert into ${weddings}
      (${sql.identifier(weddings.id.name)}, ${sql.identifier(weddings.name.name)}, ${sql.identifier(weddings.weddingDate.name)}, ${sql.identifier(weddings.timeZone.name)}, ${sql.identifier(weddings.locale.name)}, ${sql.identifier(weddings.createdByUserId.name)}, ${sql.identifier(weddings.workspaceOwnerUserId.name)})
    values (${input.id}, ${input.name}, ${input.weddingDate}, ${input.timeZone}, ${input.locale}, ${input.userId}, ${input.userId})
    returning
      ${weddings.id} as "id",
      ${weddings.name} as "name",
      ${weddings.weddingDate} as "wedding_date",
      ${weddings.timeZone} as "time_zone",
      ${weddings.locale} as "locale",
      ${weddings.createdAt} as "created_at"`;
}

export function buildCreateOwnerMembershipQuery(input: {
  userId: string;
  weddingId: string;
}): SQL {
  return sql`insert into ${weddingMembers}
      (${sql.identifier(weddingMembers.weddingId.name)}, ${sql.identifier(weddingMembers.userId.name)}, ${sql.identifier(weddingMembers.role.name)})
    values (${input.weddingId}, ${input.userId}, 'owner')`;
}

export function buildListWeddingsQuery(input: {
  userId: string;
  limit: number;
  cursor?: ListCursor;
}): SQL {
  const cursorPredicate = input.cursor
    ? sql`and (${weddingMembers.createdAt}, ${weddingMembers.weddingId}) < (${input.cursor.createdAt}, ${input.cursor.id})`
    : sql``;
  return sql`select
      ${weddings.id} as "id",
      ${weddings.name} as "name",
      ${weddings.weddingDate} as "wedding_date",
      ${weddings.timeZone} as "time_zone",
      ${weddings.locale} as "locale",
      ${weddingMembers.role} as "role",
      ${weddings.createdAt} as "created_at",
      ${weddingMembers.createdAt} as "cursor_created_at"
    from ${weddings}
    inner join ${weddingMembers}
      on ${weddingMembers.weddingId} = ${weddings.id}
     and ${weddingMembers.userId} = ${input.userId}
    where true ${cursorPredicate}
    order by ${weddingMembers.createdAt} desc, ${weddingMembers.weddingId} desc
    limit ${input.limit + 1}`;
}

export function buildListGuestsQuery(
  input: GuestListRepositoryInput & { userId: string; weddingId: string },
): SQL {
  const {
    cursorPredicate,
    archivePredicate,
    searchPredicate,
    affiliationPredicate,
    rsvpPredicate,
  } = guestListPredicates(input);
  return sql`with "authorized_wedding" as (
      select ${weddingMembers.weddingId} as "wedding_id"
      from ${weddingMembers}
      where ${weddingMembers.weddingId} = ${input.weddingId}
        and ${weddingMembers.userId} = ${input.userId}
      limit 1
    )
    select
      true as "authorized",
      ${guests.id} as "id",
      ${guests.name} as "name",
      ${guests.email} as "email",
      ${guests.phone} as "phone",
      ${guests.allowedPartySize} as "allowed_party_size",
      ${guestAffiliations.id} as "affiliation_id",
      ${guestAffiliations.name} as "affiliation_name",
      ${guestAffiliations.color} as "affiliation_color",
      ${guestAffiliations.sortOrder} as "affiliation_sort_order",
      ${guestAffiliations.createdAt} as "affiliation_created_at",
      ${guests.createdAt} as "created_at",
      ${guests.archivedAt} as "archived_at",
      ${rsvps.attendance} as "rsvp_attendance",
      ${rsvps.partySize} as "rsvp_party_size",
      ${rsvps.note} as "rsvp_note",
      ${rsvps.updatedAt} as "rsvp_updated_at"
    from "authorized_wedding"
    left join ${guests}
      on ${guests.weddingId} = "authorized_wedding"."wedding_id"
     ${archivePredicate}
     ${cursorPredicate}
     ${searchPredicate}
     ${affiliationPredicate}
     ${rsvpPredicate}
    left join ${rsvps}
      on ${rsvps.weddingId} = ${guests.weddingId}
     and ${rsvps.guestId} = ${guests.id}
    left join ${guestAffiliations}
      on ${guestAffiliations.weddingId} = ${guests.weddingId}
     and ${guestAffiliations.id} = ${guests.affiliationId}
    order by ${guests.createdAt} desc nulls last, ${guests.id} desc nulls last
    limit ${input.limit + 1}`;
}

function guestListPredicates(input: GuestListRepositoryInput) {
  const cursorPredicate = input.cursor
    ? sql`and (${guests.createdAt}, ${guests.id}) < (${input.cursor.createdAt}, ${input.cursor.id})`
    : sql``;
  const archivePredicate =
    input.view === "archived"
      ? sql`and ${guests.archivedAt} is not null`
      : sql`and ${guests.archivedAt} is null`;
  const searchPredicate = input.search
    ? sql`and (
        lower(${guests.name}) like lower(${`${escapeLike(input.search)}%`}) escape '\\'
        or lower(coalesce(${guests.email}, '')) like lower(${`${escapeLike(input.search)}%`}) escape '\\'
        or lower(coalesce(${guests.phone}, '')) like lower(${`${escapeLike(input.search)}%`}) escape '\\'
      )`
    : sql``;
  const affiliationPredicate =
    input.affiliation === "unassigned"
      ? sql`and ${guests.affiliationId} is null`
      : input.affiliation
        ? sql`and ${guests.affiliationId} = ${input.affiliation}`
        : sql``;
  const rsvpPredicate =
    input.rsvp === "pending"
      ? sql`and not exists (
          select 1 from ${rsvps}
          where ${rsvps.weddingId} = ${guests.weddingId}
            and ${rsvps.guestId} = ${guests.id}
        )`
      : input.rsvp
        ? sql`and exists (
            select 1 from ${rsvps}
            where ${rsvps.weddingId} = ${guests.weddingId}
              and ${rsvps.guestId} = ${guests.id}
              and ${rsvps.attendance} = ${input.rsvp}
          )`
        : sql``;
  return {
    cursorPredicate,
    archivePredicate,
    searchPredicate,
    affiliationPredicate,
    rsvpPredicate,
  };
}

export function buildListGuestExportPageQuery(
  input: GuestListRepositoryInput & {
    userId: string;
    weddingId: string;
    limit: 500;
  },
): SQL {
  const {
    cursorPredicate,
    archivePredicate,
    searchPredicate,
    affiliationPredicate,
    rsvpPredicate,
  } = guestListPredicates(input);
  return sql`with "authorized_wedding" as (
      select ${weddingMembers.weddingId} as "wedding_id"
      from ${weddingMembers}
      where ${weddingMembers.weddingId} = ${input.weddingId}
        and ${weddingMembers.userId} = ${input.userId}
      limit 1
    )
    select
      true as "authorized",
      ${guests.id} as "cursor_id",
      ${guests.createdAt} as "cursor_created_at",
      ${guests.name} as "name",
      ${guests.email} as "email",
      ${guests.phone} as "phone",
      ${guests.allowedPartySize} as "allowed_party_size",
      ${guestAffiliations.name} as "affiliation",
      ${guests.envelopeName} as "envelope_name",
      ${guestPostalAddresses.addressLine1} as "address_line_1",
      ${guestPostalAddresses.addressLine2} as "address_line_2",
      ${guestPostalAddresses.locality} as "locality",
      ${guestPostalAddresses.administrativeArea} as "administrative_area",
      ${guestPostalAddresses.postalCode} as "postal_code",
      ${guestPostalAddresses.countryCode} as "country_code",
      ${guests.note} as "note",
      ${rsvps.attendance} as "rsvp_status",
      ${rsvps.partySize} as "rsvp_party_size"
    from "authorized_wedding"
    left join ${guests}
      on ${guests.weddingId} = "authorized_wedding"."wedding_id"
     ${archivePredicate}
     ${cursorPredicate}
     ${searchPredicate}
     ${affiliationPredicate}
     ${rsvpPredicate}
    left join ${rsvps}
      on ${rsvps.weddingId} = ${guests.weddingId}
     and ${rsvps.guestId} = ${guests.id}
    left join ${guestAffiliations}
      on ${guestAffiliations.weddingId} = ${guests.weddingId}
     and ${guestAffiliations.id} = ${guests.affiliationId}
    left join ${guestPostalAddresses}
      on ${guestPostalAddresses.weddingId} = ${guests.weddingId}
     and ${guestPostalAddresses.guestId} = ${guests.id}
    order by ${guests.createdAt} desc nulls last, ${guests.id} desc nulls last
    limit ${input.limit + 1}`;
}

export function buildGetGuestQuery(input: {
  userId: string;
  weddingId: string;
  guestId: string;
}): SQL {
  return sql`select
      ${guests.id} as "id",
      ${guests.name} as "name",
      ${guests.email} as "email",
      ${guests.phone} as "phone",
      ${guests.allowedPartySize} as "allowed_party_size",
      ${guests.envelopeName} as "envelope_name",
      ${guests.note} as "note",
      ${guests.createdAt} as "created_at",
      ${guests.updatedAt} as "updated_at",
      ${guests.archivedAt} as "archived_at",
      ${guestAffiliations.id} as "affiliation_id",
      ${guestAffiliations.name} as "affiliation_name",
      ${guestAffiliations.color} as "affiliation_color",
      ${guestAffiliations.sortOrder} as "affiliation_sort_order",
      ${guestAffiliations.createdAt} as "affiliation_created_at",
      ${rsvps.attendance} as "rsvp_attendance",
      ${rsvps.partySize} as "rsvp_party_size",
      ${rsvps.note} as "rsvp_note",
      ${rsvps.updatedAt} as "rsvp_updated_at",
      ${guestPostalAddresses.addressLine1} as "address_line_1",
      ${guestPostalAddresses.addressLine2} as "address_line_2",
      ${guestPostalAddresses.locality} as "locality",
      ${guestPostalAddresses.administrativeArea} as "administrative_area",
      ${guestPostalAddresses.postalCode} as "postal_code",
      ${guestPostalAddresses.countryCode} as "country_code"
    from ${guests}
    inner join ${weddingMembers}
      on ${weddingMembers.weddingId} = ${guests.weddingId}
     and ${weddingMembers.userId} = ${input.userId}
    left join ${guestAffiliations}
      on ${guestAffiliations.weddingId} = ${guests.weddingId}
     and ${guestAffiliations.id} = ${guests.affiliationId}
    left join ${rsvps}
      on ${rsvps.weddingId} = ${guests.weddingId}
     and ${rsvps.guestId} = ${guests.id}
    left join ${guestPostalAddresses}
      on ${guestPostalAddresses.weddingId} = ${guests.weddingId}
     and ${guestPostalAddresses.guestId} = ${guests.id}
    where ${guests.weddingId} = ${input.weddingId}
      and ${guests.id} = ${input.guestId}
    limit 1`;
}

export function buildCreateGuestQuery(input: {
  id: string;
  userId: string;
  weddingId: string;
  name: string;
  email: string | null;
  phone: string | null;
  allowedPartySize: number;
  affiliationId: string | null;
  envelopeName: string | null;
  note: string | null;
}): SQL {
  return sql`with "inserted_guest" as (
    insert into ${guests}
      (${sql.identifier(guests.id.name)}, ${sql.identifier(guests.weddingId.name)}, ${sql.identifier(guests.name.name)}, ${sql.identifier(guests.email.name)}, ${sql.identifier(guests.phone.name)}, ${sql.identifier(guests.allowedPartySize.name)}, ${sql.identifier(guests.affiliationId.name)}, ${sql.identifier(guests.envelopeName.name)}, ${sql.identifier(guests.note.name)})
    select ${input.id}, ${input.weddingId}, ${input.name}, ${input.email}, ${input.phone}, ${input.allowedPartySize}, ${input.affiliationId}, ${input.envelopeName}, ${input.note}
    from ${weddingMembers}
    where ${weddingMembers.weddingId} = ${input.weddingId}
      and ${weddingMembers.userId} = ${input.userId}
      and (${input.affiliationId}::uuid is null or exists (
        select 1 from ${guestAffiliations}
        where ${guestAffiliations.weddingId} = ${input.weddingId}
          and ${guestAffiliations.id} = ${input.affiliationId}
      ))
    returning ${guests.id}, ${guests.weddingId}, ${guests.name}, ${guests.email}, ${guests.phone},
      ${guests.allowedPartySize}, ${guests.affiliationId}, ${guests.createdAt}, ${guests.archivedAt}
  )
  select
    "inserted_guest"."id" as "id",
    "inserted_guest"."name" as "name",
    "inserted_guest"."email" as "email",
    "inserted_guest"."phone" as "phone",
    "inserted_guest"."allowed_party_size" as "allowed_party_size",
    "inserted_guest"."created_at" as "created_at",
    "inserted_guest"."archived_at" as "archived_at",
    ${guestAffiliations.id} as "affiliation_id",
    ${guestAffiliations.name} as "affiliation_name",
    ${guestAffiliations.color} as "affiliation_color",
    ${guestAffiliations.sortOrder} as "affiliation_sort_order",
    ${guestAffiliations.createdAt} as "affiliation_created_at"
  from "inserted_guest"
  left join ${guestAffiliations}
    on ${guestAffiliations.weddingId} = "inserted_guest"."wedding_id"
   and ${guestAffiliations.id} = "inserted_guest"."affiliation_id"`;
}

export function buildUpdateGuestQuery(input: {
  userId: string;
  weddingId: string;
  guestId: string;
  patch: NormalizedGuestUpdate;
}): SQL {
  const assignments: SQL[] = [
    sql`${sql.identifier(guests.updatedAt.name)} = now()`,
  ];
  if (input.patch.name !== undefined) {
    assignments.push(
      sql`${sql.identifier(guests.name.name)} = ${input.patch.name}`,
    );
  }
  if (input.patch.email !== undefined) {
    assignments.push(
      sql`${sql.identifier(guests.email.name)} = ${input.patch.email}`,
    );
  }
  if (input.patch.phone !== undefined) {
    assignments.push(
      sql`${sql.identifier(guests.phone.name)} = ${input.patch.phone}`,
    );
  }
  if (input.patch.allowedPartySize !== undefined) {
    assignments.push(
      sql`${sql.identifier(guests.allowedPartySize.name)} = ${input.patch.allowedPartySize}`,
    );
  }
  if (input.patch.affiliationId !== undefined) {
    assignments.push(
      sql`${sql.identifier(guests.affiliationId.name)} = ${input.patch.affiliationId}`,
    );
  }
  if (input.patch.envelopeName !== undefined) {
    assignments.push(
      sql`${sql.identifier(guests.envelopeName.name)} = ${input.patch.envelopeName}`,
    );
  }
  if (input.patch.note !== undefined) {
    assignments.push(
      sql`${sql.identifier(guests.note.name)} = ${input.patch.note}`,
    );
  }
  const affiliationPredicate =
    input.patch.affiliationId === undefined ||
    input.patch.affiliationId === null
      ? sql``
      : sql`and exists (
          select 1 from ${guestAffiliations}
          where ${guestAffiliations.weddingId} = ${input.weddingId}
            and ${guestAffiliations.id} = ${input.patch.affiliationId}
        )`;
  return sql`update ${guests}
    set ${sql.join(assignments, sql`, `)}
    where ${guests.weddingId} = ${input.weddingId}
      and ${guests.id} = ${input.guestId}
      and exists (
        select 1 from ${weddingMembers}
        where ${weddingMembers.weddingId} = ${input.weddingId}
          and ${weddingMembers.userId} = ${input.userId}
      )
      ${affiliationPredicate}
    returning ${guests.id} as "id"`;
}

export function buildUpsertGuestPostalAddressQuery(input: {
  userId: string;
  weddingId: string;
  guestId: string;
  postalAddress: PostalAddressInput;
}): SQL {
  const address = input.postalAddress;
  return sql`insert into ${guestPostalAddresses}
      (${sql.identifier(guestPostalAddresses.weddingId.name)}, ${sql.identifier(guestPostalAddresses.guestId.name)}, ${sql.identifier(guestPostalAddresses.addressLine1.name)}, ${sql.identifier(guestPostalAddresses.addressLine2.name)}, ${sql.identifier(guestPostalAddresses.locality.name)}, ${sql.identifier(guestPostalAddresses.administrativeArea.name)}, ${sql.identifier(guestPostalAddresses.postalCode.name)}, ${sql.identifier(guestPostalAddresses.countryCode.name)})
    select ${input.weddingId}, ${input.guestId}, ${address.addressLine1}, ${address.addressLine2 ?? null}, ${address.locality ?? null}, ${address.administrativeArea ?? null}, ${address.postalCode ?? null}, ${address.countryCode ?? null}
    from ${weddingMembers}
    inner join ${guests}
      on ${guests.weddingId} = ${weddingMembers.weddingId}
     and ${guests.id} = ${input.guestId}
    where ${weddingMembers.weddingId} = ${input.weddingId}
      and ${weddingMembers.userId} = ${input.userId}
    on conflict (${sql.identifier(guestPostalAddresses.weddingId.name)}, ${sql.identifier(guestPostalAddresses.guestId.name)})
    do update set
      ${sql.identifier(guestPostalAddresses.addressLine1.name)} = excluded.${sql.raw('"address_line_1"')},
      ${sql.identifier(guestPostalAddresses.addressLine2.name)} = excluded.${sql.raw('"address_line_2"')},
      ${sql.identifier(guestPostalAddresses.locality.name)} = excluded.${sql.raw('"locality"')},
      ${sql.identifier(guestPostalAddresses.administrativeArea.name)} = excluded.${sql.raw('"administrative_area"')},
      ${sql.identifier(guestPostalAddresses.postalCode.name)} = excluded.${sql.raw('"postal_code"')},
      ${sql.identifier(guestPostalAddresses.countryCode.name)} = excluded.${sql.raw('"country_code"')},
      ${sql.identifier(guestPostalAddresses.updatedAt.name)} = now()`;
}

export function buildDeleteGuestPostalAddressQuery(input: {
  userId: string;
  weddingId: string;
  guestId: string;
}): SQL {
  return sql`delete from ${guestPostalAddresses}
    where ${guestPostalAddresses.weddingId} = ${input.weddingId}
      and ${guestPostalAddresses.guestId} = ${input.guestId}
      and exists (
        select 1 from ${weddingMembers}
        where ${weddingMembers.weddingId} = ${input.weddingId}
          and ${weddingMembers.userId} = ${input.userId}
      )`;
}

export function buildArchiveGuestQuery(input: {
  userId: string;
  weddingId: string;
  guestId: string;
}): SQL {
  return sql`update ${guests}
    set ${sql.identifier(guests.archivedAt.name)} = now(), ${sql.identifier(guests.updatedAt.name)} = now()
    where ${guests.weddingId} = ${input.weddingId}
      and ${guests.id} = ${input.guestId}
      and ${guests.archivedAt} is null
      and exists (
        select 1 from ${weddingMembers}
        where ${weddingMembers.weddingId} = ${input.weddingId}
          and ${weddingMembers.userId} = ${input.userId}
      )
    returning ${guests.id} as "id"`;
}

export function buildRestoreGuestQuery(input: {
  userId: string;
  weddingId: string;
  guestId: string;
}): SQL {
  return sql`update ${guests}
    set ${sql.identifier(guests.archivedAt.name)} = null, ${sql.identifier(guests.updatedAt.name)} = now()
    where ${guests.weddingId} = ${input.weddingId}
      and ${guests.id} = ${input.guestId}
      and ${guests.archivedAt} is not null
      and exists (
        select 1 from ${weddingMembers}
        where ${weddingMembers.weddingId} = ${input.weddingId}
          and ${weddingMembers.userId} = ${input.userId}
      )
    returning ${guests.id} as "id"`;
}

export function buildRevokeGuestInvitationsQuery(input: {
  userId: string;
  weddingId: string;
  guestIds: string[];
}): SQL {
  return sql`update ${invitations}
    set ${sql.identifier(invitations.revokedAt.name)} = now(), ${sql.identifier(invitations.updatedAt.name)} = now()
    where ${invitations.weddingId} = ${input.weddingId}
      and ${invitations.guestId} = any(${input.guestIds}::uuid[])
      and ${invitations.revokedAt} is null
      and exists (
        select 1 from ${weddingMembers}
        where ${weddingMembers.weddingId} = ${input.weddingId}
          and ${weddingMembers.userId} = ${input.userId}
      )`;
}

export function buildBulkArchiveGuestsQuery(input: {
  userId: string;
  weddingId: string;
  guestIds: string[];
}): SQL {
  return sql`with "authorized_wedding" as (
      select ${weddingMembers.weddingId} as "wedding_id"
      from ${weddingMembers}
      where ${weddingMembers.weddingId} = ${input.weddingId}
        and ${weddingMembers.userId} = ${input.userId}
      limit 1
    ), "requested" as (
      select distinct "value"::uuid as "id"
      from unnest(${input.guestIds}::uuid[]) as "requested_ids"("value")
    ), "matched" as (
      select ${guests.id} as "id"
      from ${guests}
      inner join "authorized_wedding"
        on "authorized_wedding"."wedding_id" = ${guests.weddingId}
      inner join "requested" on "requested"."id" = ${guests.id}
      for update of ${guests}
    ), "valid" as (
      select "authorized_wedding"."wedding_id"
      from "authorized_wedding"
      where (select count(*) from "requested") = ${input.guestIds.length}
        and (select count(*) from "matched") = ${input.guestIds.length}
    ), "updated" as (
      update ${guests}
      set ${sql.identifier(guests.archivedAt.name)} = coalesce(${guests.archivedAt}, now()),
          ${sql.identifier(guests.updatedAt.name)} = now()
      from "matched", "valid"
      where ${guests.weddingId} = "valid"."wedding_id"
        and ${guests.id} = "matched"."id"
      returning ${guests.id} as "id"
    )
    select count("updated"."id")::integer as "affected"
    from "valid" left join "updated" on true
    group by "valid"."wedding_id"`;
}

export function buildBulkSetGuestAffiliationQuery(input: {
  userId: string;
  weddingId: string;
  guestIds: string[];
  affiliationId: string | null;
}): SQL {
  return sql`with "authorized_wedding" as (
      select ${weddingMembers.weddingId} as "wedding_id"
      from ${weddingMembers}
      where ${weddingMembers.weddingId} = ${input.weddingId}
        and ${weddingMembers.userId} = ${input.userId}
      limit 1
    ), "requested" as (
      select distinct "value"::uuid as "id"
      from unnest(${input.guestIds}::uuid[]) as "requested_ids"("value")
    ), "selected_affiliation" as (
      select ${guestAffiliations.id} as "id"
      from ${guestAffiliations}
      inner join "authorized_wedding"
        on "authorized_wedding"."wedding_id" = ${guestAffiliations.weddingId}
      where ${guestAffiliations.id} = ${input.affiliationId}
      for update of ${guestAffiliations}
    ), "matched" as (
      select ${guests.id} as "id"
      from ${guests}
      inner join "authorized_wedding"
        on "authorized_wedding"."wedding_id" = ${guests.weddingId}
      inner join "requested" on "requested"."id" = ${guests.id}
      for update of ${guests}
    ), "valid" as (
      select "authorized_wedding"."wedding_id"
      from "authorized_wedding"
      where (select count(*) from "requested") = ${input.guestIds.length}
        and (select count(*) from "matched") = ${input.guestIds.length}
        and (${input.affiliationId}::uuid is null or exists (select 1 from "selected_affiliation"))
    ), "updated" as (
      update ${guests}
      set ${sql.identifier(guests.affiliationId.name)} = ${input.affiliationId},
          ${sql.identifier(guests.updatedAt.name)} = now()
      from "matched", "valid"
      where ${guests.weddingId} = "valid"."wedding_id"
        and ${guests.id} = "matched"."id"
      returning ${guests.id} as "id"
    )
    select count("updated"."id")::integer as "affected"
    from "valid" left join "updated" on true
    group by "valid"."wedding_id"`;
}

export function buildListGuestAffiliationsQuery(input: {
  userId: string;
  weddingId: string;
}): SQL {
  return sql`with "authorized_wedding" as (
    select ${weddingMembers.weddingId} as "wedding_id"
    from ${weddingMembers}
    where ${weddingMembers.weddingId} = ${input.weddingId}
      and ${weddingMembers.userId} = ${input.userId}
    limit 1
  )
  select
    true as "authorized",
    ${guestAffiliations.id} as "id",
    ${guestAffiliations.name} as "name",
    ${guestAffiliations.color} as "color",
    ${guestAffiliations.sortOrder} as "sort_order",
    ${guestAffiliations.createdAt} as "created_at"
  from "authorized_wedding"
  left join ${guestAffiliations}
    on ${guestAffiliations.weddingId} = "authorized_wedding"."wedding_id"
  order by ${guestAffiliations.sortOrder} asc nulls last,
    ${guestAffiliations.createdAt} asc nulls last,
    ${guestAffiliations.id} asc nulls last
  limit 101`;
}

export function buildCreateGuestAffiliationQuery(input: {
  id: string;
  userId: string;
  weddingId: string;
  name: string;
  color: string;
}): SQL {
  return sql`insert into ${guestAffiliations}
    (${sql.identifier(guestAffiliations.id.name)}, ${sql.identifier(guestAffiliations.weddingId.name)}, ${sql.identifier(guestAffiliations.name.name)}, ${sql.identifier(guestAffiliations.color.name)}, ${sql.identifier(guestAffiliations.sortOrder.name)})
  select ${input.id}, ${input.weddingId}, ${input.name}, ${input.color},
    coalesce(max(${guestAffiliations.sortOrder}), -1) + 1
  from ${weddingMembers}
  left join ${guestAffiliations}
    on ${guestAffiliations.weddingId} = ${weddingMembers.weddingId}
  where ${weddingMembers.weddingId} = ${input.weddingId}
    and ${weddingMembers.userId} = ${input.userId}
  group by ${weddingMembers.weddingId}
  having count(${guestAffiliations.id}) < 100
  returning
    ${guestAffiliations.id} as "id",
    ${guestAffiliations.name} as "name",
    ${guestAffiliations.color} as "color",
    ${guestAffiliations.sortOrder} as "sort_order",
    ${guestAffiliations.createdAt} as "created_at"`;
}

export function buildLockGuestAffiliationScopeQuery(input: {
  userId: string;
  weddingId: string;
  affiliationId?: string;
}): SQL {
  return sql`select ${weddings.id} as "wedding_id"
  from ${weddings}
  inner join ${weddingMembers}
    on ${weddingMembers.weddingId} = ${weddings.id}
   and ${weddingMembers.userId} = ${input.userId}
  ${
    input.affiliationId
      ? sql`inner join ${guestAffiliations}
          on ${guestAffiliations.weddingId} = ${weddings.id}
         and ${guestAffiliations.id} = ${input.affiliationId}`
      : sql``
  }
  where ${weddings.id} = ${input.weddingId}
  ${
    input.affiliationId
      ? sql`for update of ${weddings}, ${guestAffiliations}`
      : sql`for update of ${weddings}`
  }`;
}

export function buildUpdateGuestAffiliationQuery(input: {
  userId: string;
  weddingId: string;
  affiliationId: string;
  name: string;
  color: string;
}): SQL {
  return sql`update ${guestAffiliations}
  set ${sql.identifier(guestAffiliations.name.name)} = ${input.name},
      ${sql.identifier(guestAffiliations.color.name)} = ${input.color},
      ${sql.identifier(guestAffiliations.updatedAt.name)} = now()
  where ${guestAffiliations.weddingId} = ${input.weddingId}
    and ${guestAffiliations.id} = ${input.affiliationId}
    and exists (
      select 1 from ${weddingMembers}
      where ${weddingMembers.weddingId} = ${input.weddingId}
        and ${weddingMembers.userId} = ${input.userId}
    )
  returning
    ${guestAffiliations.id} as "id",
    ${guestAffiliations.name} as "name",
    ${guestAffiliations.color} as "color",
    ${guestAffiliations.sortOrder} as "sort_order",
    ${guestAffiliations.createdAt} as "created_at"`;
}

export function buildReorderGuestAffiliationsQuery(input: {
  userId: string;
  weddingId: string;
  affiliationIds: string[];
}): SQL {
  return sql`with "authorized_wedding" as (
    select ${weddingMembers.weddingId} as "wedding_id"
    from ${weddingMembers}
    where ${weddingMembers.weddingId} = ${input.weddingId}
      and ${weddingMembers.userId} = ${input.userId}
    limit 1
  ), "requested_order" as (
    select "value"::uuid as "id", ("ordinality" - 1)::integer as "sort_order"
    from unnest(${input.affiliationIds}::uuid[]) with ordinality
      as "requested"("value", "ordinality")
  ), "valid_order" as (
    select "authorized_wedding"."wedding_id"
    from "authorized_wedding"
    where (
      select count(*) from ${guestAffiliations}
      where ${guestAffiliations.weddingId} = "authorized_wedding"."wedding_id"
    ) = ${input.affiliationIds.length}
      and not exists (
        select 1 from ${guestAffiliations}
        where ${guestAffiliations.weddingId} = "authorized_wedding"."wedding_id"
          and not (${guestAffiliations.id} = any(${input.affiliationIds}::uuid[]))
      )
  ), "updated_affiliations" as (
    update ${guestAffiliations}
    set ${sql.identifier(guestAffiliations.sortOrder.name)} = "requested_order"."sort_order",
        ${sql.identifier(guestAffiliations.updatedAt.name)} = now()
    from "requested_order", "valid_order"
    where ${guestAffiliations.weddingId} = "valid_order"."wedding_id"
      and ${guestAffiliations.id} = "requested_order"."id"
    returning
      ${guestAffiliations.id} as "id",
      ${guestAffiliations.name} as "name",
      ${guestAffiliations.color} as "color",
      ${guestAffiliations.sortOrder} as "sort_order",
      ${guestAffiliations.createdAt} as "created_at"
  )
  select
    true as "authorized",
    "updated_affiliations"."id",
    "updated_affiliations"."name",
    "updated_affiliations"."color",
    "updated_affiliations"."sort_order",
    "updated_affiliations"."created_at"
  from "valid_order"
  left join "updated_affiliations" on true
  order by "updated_affiliations"."sort_order" asc nulls last,
    "updated_affiliations"."id" asc nulls last`;
}

export function buildUnassignGuestAffiliationQuery(input: {
  userId: string;
  weddingId: string;
  affiliationId: string;
}): SQL {
  return sql`update ${guests}
  set ${sql.identifier(guests.affiliationId.name)} = null,
      ${sql.identifier(guests.updatedAt.name)} = now()
  where ${guests.weddingId} = ${input.weddingId}
    and ${guests.affiliationId} = ${input.affiliationId}
    and exists (
      select 1 from ${weddingMembers}
      where ${weddingMembers.weddingId} = ${input.weddingId}
        and ${weddingMembers.userId} = ${input.userId}
    )`;
}

export function buildDeleteGuestAffiliationQuery(input: {
  userId: string;
  weddingId: string;
  affiliationId: string;
}): SQL {
  return sql`delete from ${guestAffiliations}
  where ${guestAffiliations.weddingId} = ${input.weddingId}
    and ${guestAffiliations.id} = ${input.affiliationId}
    and exists (
      select 1 from ${weddingMembers}
      where ${weddingMembers.weddingId} = ${input.weddingId}
        and ${weddingMembers.userId} = ${input.userId}
    )
  returning ${guestAffiliations.id} as "id"`;
}

export function buildSetGuestAffiliationQuery(input: {
  userId: string;
  weddingId: string;
  guestId: string;
  affiliationId: string | null;
}): SQL {
  return sql`with "updated_guest" as (
    update ${guests}
    set ${sql.identifier(guests.affiliationId.name)} = ${input.affiliationId},
        ${sql.identifier(guests.updatedAt.name)} = now()
    where ${guests.weddingId} = ${input.weddingId}
      and ${guests.id} = ${input.guestId}
      and exists (
        select 1 from ${weddingMembers}
        where ${weddingMembers.weddingId} = ${input.weddingId}
          and ${weddingMembers.userId} = ${input.userId}
      )
      and (${input.affiliationId}::uuid is null or exists (
        select 1 from ${guestAffiliations}
        where ${guestAffiliations.weddingId} = ${input.weddingId}
          and ${guestAffiliations.id} = ${input.affiliationId}
      ))
    returning ${guests.id}, ${guests.weddingId}, ${guests.name}, ${guests.email}, ${guests.phone},
      ${guests.allowedPartySize}, ${guests.affiliationId}, ${guests.createdAt}, ${guests.archivedAt}
  )
  select
    "updated_guest"."id" as "id",
    "updated_guest"."name" as "name",
    "updated_guest"."email" as "email",
    "updated_guest"."phone" as "phone",
    "updated_guest"."allowed_party_size" as "allowed_party_size",
    "updated_guest"."created_at" as "created_at",
    "updated_guest"."archived_at" as "archived_at",
    ${guestAffiliations.id} as "affiliation_id",
    ${guestAffiliations.name} as "affiliation_name",
    ${guestAffiliations.color} as "affiliation_color",
    ${guestAffiliations.sortOrder} as "affiliation_sort_order",
    ${guestAffiliations.createdAt} as "affiliation_created_at",
    ${rsvps.attendance} as "rsvp_attendance",
    ${rsvps.partySize} as "rsvp_party_size",
    ${rsvps.note} as "rsvp_note",
    ${rsvps.updatedAt} as "rsvp_updated_at"
  from "updated_guest"
  left join ${guestAffiliations}
    on ${guestAffiliations.weddingId} = "updated_guest"."wedding_id"
   and ${guestAffiliations.id} = "updated_guest"."affiliation_id"
  left join ${rsvps}
    on ${rsvps.weddingId} = "updated_guest"."wedding_id"
   and ${rsvps.guestId} = "updated_guest"."id"`;
}

export function buildCreateInvitationQuery(input: {
  id: string;
  userId: string;
  weddingId: string;
  guestId: string;
  tokenHash: string;
  expiresAt: string | null;
}): SQL {
  return sql`insert into ${invitations}
      (${sql.identifier(invitations.id.name)}, ${sql.identifier(invitations.weddingId.name)}, ${sql.identifier(invitations.guestId.name)}, ${sql.identifier(invitations.tokenHash.name)}, ${sql.identifier(invitations.createdByUserId.name)}, ${sql.identifier(invitations.expiresAt.name)})
    select ${input.id}, ${guests.weddingId}, ${guests.id}, ${input.tokenHash}, ${input.userId}, ${input.expiresAt}
    from ${guests}
    inner join ${weddingMembers}
      on ${weddingMembers.weddingId} = ${guests.weddingId}
     and ${weddingMembers.userId} = ${input.userId}
    where ${guests.weddingId} = ${input.weddingId}
      and ${guests.id} = ${input.guestId}
      and ${guests.archivedAt} is null
    returning
      ${invitations.id} as "id",
      ${invitations.guestId} as "guest_id",
      ${invitations.expiresAt} as "expires_at"`;
}

export function buildLockInvitationGuestQuery(input: {
  userId: string;
  weddingId: string;
  guestId: string;
}): SQL {
  return sql`select ${guests.id} as "id"
    from ${guests}
    inner join ${weddingMembers}
      on ${weddingMembers.weddingId} = ${guests.weddingId}
     and ${weddingMembers.userId} = ${input.userId}
    where ${guests.weddingId} = ${input.weddingId}
      and ${guests.id} = ${input.guestId}
      and ${guests.archivedAt} is null
    for update of ${guests}`;
}

export function buildPublicInvitationQuery(tokenHash: string): SQL {
  return sql`select
      ${invitations.id} as "invitation_id",
      ${guests.name} as "guest_name",
      ${guests.allowedPartySize} as "allowed_party_size",
      ${weddings.name} as "wedding_name",
      ${weddings.weddingDate} as "wedding_date",
      ${weddings.timeZone} as "time_zone",
      ${weddings.locale} as "locale",
      ${rsvps.attendance} as "rsvp_attendance",
      ${rsvps.partySize} as "rsvp_party_size",
      ${rsvps.note} as "rsvp_note",
      ${rsvps.updatedAt} as "rsvp_updated_at"
    from ${invitations}
    inner join ${guests}
      on ${guests.weddingId} = ${invitations.weddingId}
     and ${guests.id} = ${invitations.guestId}
    inner join ${weddings} on ${weddings.id} = ${invitations.weddingId}
    left join ${rsvps}
      on ${rsvps.weddingId} = ${invitations.weddingId}
     and ${rsvps.guestId} = ${invitations.guestId}
    where ${invitations.tokenHash} = ${tokenHash}
      and ${invitations.revokedAt} is null
      and ${guests.archivedAt} is null
      and (${invitations.expiresAt} is null or ${invitations.expiresAt} > now())
    limit 1`;
}

export function buildUpsertRsvpQuery(input: {
  id: string;
  tokenHash: string;
  attendance: Attendance;
  partySize: number;
  note: string | null;
}): SQL {
  return sql`with "valid_invitation" as (
      select
        ${invitations.id} as "invitation_id",
        ${invitations.weddingId} as "wedding_id",
        ${invitations.guestId} as "guest_id",
        ${guests.allowedPartySize} as "allowed_party_size"
      from ${invitations}
      inner join ${guests}
        on ${guests.weddingId} = ${invitations.weddingId}
       and ${guests.id} = ${invitations.guestId}
      where ${invitations.tokenHash} = ${input.tokenHash}
        and ${invitations.revokedAt} is null
        and ${guests.archivedAt} is null
        and (${invitations.expiresAt} is null or ${invitations.expiresAt} > now())
      limit 1
    ), "upserted" as (
      insert into ${rsvps}
        (${sql.identifier(rsvps.id.name)}, ${sql.identifier(rsvps.weddingId.name)}, ${sql.identifier(rsvps.guestId.name)}, ${sql.identifier(rsvps.invitationId.name)}, ${sql.identifier(rsvps.attendance.name)}, ${sql.identifier(rsvps.partySize.name)}, ${sql.identifier(rsvps.note.name)})
      select
        ${input.id}, "wedding_id", "guest_id", "invitation_id",
        ${input.attendance}, ${input.partySize}, ${input.note}
      from "valid_invitation"
      where (${input.attendance} = 'attending' and ${input.partySize} between 1 and "allowed_party_size")
         or (${input.attendance} = 'declined' and ${input.partySize} = 0)
      on conflict ("wedding_id","guest_id") do update set
        "invitation_id" = excluded."invitation_id",
        "attendance" = excluded."attendance",
        "party_size" = excluded."party_size",
        "note" = excluded."note",
        "updated_at" = now()
      returning
        'saved'::text as "kind",
        ${rsvps.attendance} as "attendance",
        ${rsvps.partySize} as "party_size",
        ${rsvps.note} as "note",
        ${rsvps.updatedAt} as "updated_at"
    )
    select "kind", "attendance", "party_size", "note", "updated_at",
      null::integer as "allowed_party_size"
    from "upserted"
    union all
    select
      case when exists (select 1 from "valid_invitation")
        then 'invalid_party_size' else 'not_found' end as "kind",
      null::"attendance_status" as "attendance",
      null::integer as "party_size",
      null::varchar as "note",
      null::timestamptz as "updated_at",
      (select "allowed_party_size" from "valid_invitation") as "allowed_party_size"
    where not exists (select 1 from "upserted")
    limit 1`;
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
