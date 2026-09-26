import type {
  GuestAffiliation,
  GuestSummary,
  InvitationCreated,
} from "@lovechapter/contracts";
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Select } from "../ui/select";

export type GuestSelection = ReadonlySet<string>;

export function GuestList({
  guests,
  affiliations,
  selection,
  view,
  busy,
  nextCursor,
  onToggle,
  onSelectVisible,
  onEdit,
  onArchive,
  onRestore,
  onLoadMore,
  onBulkAffiliation,
  onBulkArchive,
  invitations,
  onCreateInvitation,
  canReplaceInvitation,
  onReplaceInvitation,
  onCopyInvitation,
}: {
  guests: GuestSummary[];
  affiliations: GuestAffiliation[];
  selection: GuestSelection;
  view: "active" | "archived";
  busy: boolean;
  nextCursor: string | null;
  onToggle(guestId: string): void;
  onSelectVisible(): void;
  onEdit(guest: GuestSummary): void;
  onArchive(guest: GuestSummary): void;
  onRestore(guest: GuestSummary): void;
  onLoadMore(): void;
  onBulkAffiliation(affiliationId: string | null): void;
  onBulkArchive(): void;
  invitations: Record<string, InvitationCreated>;
  onCreateInvitation(guest: GuestSummary): void;
  canReplaceInvitation: boolean;
  onReplaceInvitation(guest: GuestSummary): void;
  onCopyInvitation(guest: GuestSummary): void;
}) {
  const [bulkTarget, setBulkTarget] = useState("");
  return (
    <section aria-labelledby="guest-list-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3
            id="guest-list-title"
            className="font-serif text-2xl font-semibold text-[#432f35]"
          >
            Guest list
          </h3>
          <p aria-live="polite" className="text-sm text-[#806d70]">
            {guests.length} loaded · {selection.size} selected
          </p>
        </div>
        {guests.length > 0 ? (
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              aria-label="Select visible guests"
              checked={
                guests.length > 0 &&
                guests.slice(0, 200).every((guest) => selection.has(guest.id))
              }
              onChange={onSelectVisible}
            />
            Select visible guests
          </label>
        ) : null}
      </div>

      {selection.size > 0 ? (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <label>
            <span className="mb-1 block text-sm font-semibold">
              Bulk affiliation
            </span>
            <Select
              aria-label="Bulk affiliation"
              value={bulkTarget}
              onChange={(event) => setBulkTarget(event.currentTarget.value)}
            >
              <option value="">Unassigned</option>
              {affiliations.map((affiliation) => (
                <option key={affiliation.id} value={affiliation.id}>
                  {affiliation.name}
                </option>
              ))}
            </Select>
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onBulkAffiliation(bulkTarget || null)}
          >
            Assign selected
          </Button>
          {view === "active" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={onBulkArchive}
            >
              Archive selected
            </Button>
          ) : null}
        </Card>
      ) : null}

      {guests.length === 0 ? (
        <Card className="p-7 text-center text-[#806d70]">
          No guests match these filters.
        </Card>
      ) : (
        guests.map((guest) => (
          <Card key={guest.id} className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <input
                  className="mt-1"
                  type="checkbox"
                  aria-label={`Select ${guest.name}`}
                  checked={selection.has(guest.id)}
                  onChange={() => onToggle(guest.id)}
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-serif text-xl font-semibold text-[#432f35]">
                      {guest.name}
                    </p>
                    <RsvpBadge guest={guest} />
                    {guest.affiliation ? (
                      <Badge>{guest.affiliation.name}</Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-[#806d70]">
                    Up to {guest.allowedPartySize} attending
                    {guest.email ? ` · ${guest.email}` : ""}
                    {guest.phone ? ` · ${guest.phone}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Edit ${guest.name}`}
                  onClick={() => onEdit(guest)}
                >
                  Edit
                </Button>
                {view === "active" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Archive ${guest.name}`}
                    onClick={() => onArchive(guest)}
                  >
                    Archive
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Restore ${guest.name}`}
                    onClick={() => onRestore(guest)}
                  >
                    Restore
                  </Button>
                )}
              </div>
            </div>
            {view === "active" ? (
              <div className="mt-3">
                {!invitations[guest.id] ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onCreateInvitation(guest)}
                  >
                    Create invitation
                  </Button>
                ) : null}
                {canReplaceInvitation ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Issue a new link for ${guest.name}`}
                    onClick={() => onReplaceInvitation(guest)}
                  >
                    Issue new invitation link
                  </Button>
                ) : null}
                {canReplaceInvitation ? (
                  <p className="text-xs text-[#806d70]">
                    If a link already exists, issuing a new one stops the old
                    link from working.
                  </p>
                ) : null}
                {invitations[guest.id] ? (
                  <div className="mt-3 rounded-xl bg-[#fff9f3] p-3">
                    <a
                      href={invitations[guest.id]!.publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${guest.name}'s invitation`}
                      className="break-all text-[#71384b] underline"
                    >
                      {invitations[guest.id]!.publicUrl}
                    </a>
                    <p className="text-xs">
                      This secure link is shown only for this session. Copy it
                      before leaving.
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onCopyInvitation(guest)}
                    >
                      Copy invitation link
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>
        ))
      )}
      {nextCursor ? (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={onLoadMore}
        >
          {busy ? "Loading…" : "Load more guests"}
        </Button>
      ) : null}
    </section>
  );
}

function RsvpBadge({ guest }: { guest: GuestSummary }) {
  if (!guest.rsvp) return <Badge>Awaiting response</Badge>;
  return guest.rsvp.attendance === "attending" ? (
    <Badge>Attending · {guest.rsvp.partySize}</Badge>
  ) : (
    <Badge>Declined</Badge>
  );
}
