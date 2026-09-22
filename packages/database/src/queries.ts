import type { Attendance } from "@lovechapter/contracts";
import type { ListCursor } from "@lovechapter/domain";
import { sql, type SQL } from "drizzle-orm";

import {
  guestAffiliations,
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
      (${users.id}, ${users.authProvider}, ${users.authSubject}, ${users.displayName}, ${users.email})
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
    set ${users.displayName} = ${input.displayName},
        ${users.onboardingCompletedAt} = now(),
        ${users.updatedAt} = now()
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
      (${weddings.id}, ${weddings.name}, ${weddings.weddingDate}, ${weddings.timeZone}, ${weddings.locale}, ${weddings.createdByUserId}, ${weddings.workspaceOwnerUserId})
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
      (${weddingMembers.weddingId}, ${weddingMembers.userId}, ${weddingMembers.role})
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

export function buildListGuestsQuery(input: {
  userId: string;
  weddingId: string;
  limit: number;
  cursor?: ListCursor;
}): SQL {
  const cursorPredicate = input.cursor
    ? sql`and (${guests.createdAt}, ${guests.id}) < (${input.cursor.createdAt}, ${input.cursor.id})`
    : sql``;
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
      ${guests.allowedPartySize} as "allowed_party_size",
      ${guestAffiliations.id} as "affiliation_id",
      ${guestAffiliations.name} as "affiliation_name",
      ${guestAffiliations.color} as "affiliation_color",
      ${guestAffiliations.sortOrder} as "affiliation_sort_order",
      ${guestAffiliations.createdAt} as "affiliation_created_at",
      ${guests.createdAt} as "created_at",
      ${rsvps.attendance} as "rsvp_attendance",
      ${rsvps.partySize} as "rsvp_party_size",
      ${rsvps.note} as "rsvp_note",
      ${rsvps.updatedAt} as "rsvp_updated_at"
    from "authorized_wedding"
    left join ${guests}
      on ${guests.weddingId} = "authorized_wedding"."wedding_id"
     ${cursorPredicate}
    left join ${rsvps}
      on ${rsvps.weddingId} = ${guests.weddingId}
     and ${rsvps.guestId} = ${guests.id}
    left join ${guestAffiliations}
      on ${guestAffiliations.weddingId} = ${guests.weddingId}
     and ${guestAffiliations.id} = ${guests.affiliationId}
    order by ${guests.createdAt} desc nulls last, ${guests.id} desc nulls last
    limit ${input.limit + 1}`;
}

export function buildCreateGuestQuery(input: {
  id: string;
  userId: string;
  weddingId: string;
  name: string;
  email: string | null;
  allowedPartySize: number;
  affiliationId: string | null;
}): SQL {
  return sql`with "inserted_guest" as (
    insert into ${guests}
      (${guests.id}, ${guests.weddingId}, ${guests.name}, ${guests.email}, ${guests.allowedPartySize}, ${guests.affiliationId})
    select ${input.id}, ${input.weddingId}, ${input.name}, ${input.email}, ${input.allowedPartySize}, ${input.affiliationId}
    from ${weddingMembers}
    where ${weddingMembers.weddingId} = ${input.weddingId}
      and ${weddingMembers.userId} = ${input.userId}
      and (${input.affiliationId}::uuid is null or exists (
        select 1 from ${guestAffiliations}
        where ${guestAffiliations.weddingId} = ${input.weddingId}
          and ${guestAffiliations.id} = ${input.affiliationId}
      ))
    returning ${guests.id}, ${guests.weddingId}, ${guests.name}, ${guests.email},
      ${guests.allowedPartySize}, ${guests.affiliationId}, ${guests.createdAt}
  )
  select
    "inserted_guest"."id" as "id",
    "inserted_guest"."name" as "name",
    "inserted_guest"."email" as "email",
    "inserted_guest"."allowed_party_size" as "allowed_party_size",
    "inserted_guest"."created_at" as "created_at",
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
    (${guestAffiliations.id}, ${guestAffiliations.weddingId}, ${guestAffiliations.name}, ${guestAffiliations.color}, ${guestAffiliations.sortOrder})
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
  set ${guestAffiliations.name} = ${input.name},
      ${guestAffiliations.color} = ${input.color},
      ${guestAffiliations.updatedAt} = now()
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
    set ${guestAffiliations.sortOrder} = "requested_order"."sort_order",
        ${guestAffiliations.updatedAt} = now()
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
  set ${guests.affiliationId} = null,
      ${guests.updatedAt} = now()
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
    set ${guests.affiliationId} = ${input.affiliationId},
        ${guests.updatedAt} = now()
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
    returning ${guests.id}, ${guests.weddingId}, ${guests.name}, ${guests.email},
      ${guests.allowedPartySize}, ${guests.affiliationId}, ${guests.createdAt}
  )
  select
    "updated_guest"."id" as "id",
    "updated_guest"."name" as "name",
    "updated_guest"."email" as "email",
    "updated_guest"."allowed_party_size" as "allowed_party_size",
    "updated_guest"."created_at" as "created_at",
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
      (${invitations.id}, ${invitations.weddingId}, ${invitations.guestId}, ${invitations.tokenHash}, ${invitations.createdByUserId}, ${invitations.expiresAt})
    select ${input.id}, ${guests.weddingId}, ${guests.id}, ${input.tokenHash}, ${input.userId}, ${input.expiresAt}
    from ${guests}
    inner join ${weddingMembers}
      on ${weddingMembers.weddingId} = ${guests.weddingId}
     and ${weddingMembers.userId} = ${input.userId}
    where ${guests.weddingId} = ${input.weddingId}
      and ${guests.id} = ${input.guestId}
    returning
      ${invitations.id} as "id",
      ${invitations.guestId} as "guest_id",
      ${invitations.expiresAt} as "expires_at"`;
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
        and (${invitations.expiresAt} is null or ${invitations.expiresAt} > now())
      limit 1
    ), "upserted" as (
      insert into ${rsvps}
        (${rsvps.id}, ${rsvps.weddingId}, ${rsvps.guestId}, ${rsvps.invitationId}, ${rsvps.attendance}, ${rsvps.partySize}, ${rsvps.note})
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
