import type { Attendance } from "@lovechapter/contracts";
import type { ListCursor } from "@lovechapter/domain";
import { sql, type SQL } from "drizzle-orm";

import {
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
      "display_name" = excluded."display_name",
      "email" = excluded."email",
      "updated_at" = now()
    returning
      ${users.id} as "id",
      ${users.displayName} as "display_name",
      ${users.email} as "email"`;
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
}): SQL {
  return sql`insert into ${guests}
      (${guests.id}, ${guests.weddingId}, ${guests.name}, ${guests.email}, ${guests.allowedPartySize})
    select ${input.id}, ${input.weddingId}, ${input.name}, ${input.email}, ${input.allowedPartySize}
    from ${weddingMembers}
    where ${weddingMembers.weddingId} = ${input.weddingId}
      and ${weddingMembers.userId} = ${input.userId}
    returning
      ${guests.id} as "id",
      ${guests.name} as "name",
      ${guests.email} as "email",
      ${guests.allowedPartySize} as "allowed_party_size",
      ${guests.createdAt} as "created_at"`;
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
