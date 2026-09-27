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
import { useUiCopy } from "../ui-language-provider";

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
  const copy = useUiCopy();
  const [bulkTarget, setBulkTarget] = useState("");
  return (
    <section aria-labelledby="guest-list-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3
            id="guest-list-title"
            className="font-serif text-2xl font-semibold text-[#432f35]"
          >
            {copy.guest.guestList}
          </h3>
          <p aria-live="polite" className="text-sm text-[#806d70]">
            {copy.guest.listCount(guests.length, selection.size)}
          </p>
        </div>
        {guests.length > 0 ? (
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              aria-label={copy.guest.selectVisible}
              checked={
                guests.length > 0 &&
                guests.slice(0, 200).every((guest) => selection.has(guest.id))
              }
              onChange={onSelectVisible}
            />
            {copy.guest.selectVisible}
          </label>
        ) : null}
      </div>

      {selection.size > 0 ? (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <label>
            <span className="mb-1 block text-sm font-semibold">
              {copy.guest.bulkAffiliation}
            </span>
            <Select
              aria-label={copy.guest.bulkAffiliation}
              value={bulkTarget}
              onChange={(event) => setBulkTarget(event.currentTarget.value)}
            >
              <option value="">{copy.guest.unassigned}</option>
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
            {copy.guest.assignSelected}
          </Button>
          {view === "active" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={onBulkArchive}
            >
              {copy.guest.archiveSelected}
            </Button>
          ) : null}
        </Card>
      ) : null}

      {guests.length === 0 ? (
        <Card className="p-7 text-center text-[#806d70]">
          {copy.guest.noMatches}
        </Card>
      ) : (
        guests.map((guest) => (
          <Card key={guest.id} className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <input
                  className="mt-1"
                  type="checkbox"
                  aria-label={copy.guest.select(guest.name)}
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
                    {copy.guest.upTo(guest.allowedPartySize)}
                    {guest.email ? ` · ${guest.email}` : ""}
                    {guest.phone ? ` · ${guest.phone}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={copy.guest.action(copy.guest.edit, guest.name)}
                  onClick={() => onEdit(guest)}
                >
                  {copy.guest.edit}
                </Button>
                {view === "active" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={copy.guest.action(
                      copy.guest.archive,
                      guest.name,
                    )}
                    onClick={() => onArchive(guest)}
                  >
                    {copy.guest.archive}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={copy.guest.action(
                      copy.guest.restore,
                      guest.name,
                    )}
                    onClick={() => onRestore(guest)}
                  >
                    {copy.guest.restore}
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
                    {copy.guest.createInvitation}
                  </Button>
                ) : null}
                {canReplaceInvitation ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    aria-label={copy.guest.issueNewLinkFor(guest.name)}
                    onClick={() => onReplaceInvitation(guest)}
                  >
                    {copy.guest.issueNewLink}
                  </Button>
                ) : null}
                {canReplaceInvitation ? (
                  <p className="text-xs text-[#806d70]">
                    {copy.guest.replaceHint}
                  </p>
                ) : null}
                {invitations[guest.id] ? (
                  <div className="mt-3 rounded-xl bg-[#fff9f3] p-3">
                    <a
                      href={invitations[guest.id]!.publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={copy.guest.openInvitation(guest.name)}
                      className="break-all text-[#71384b] underline"
                    >
                      {invitations[guest.id]!.publicUrl}
                    </a>
                    <p className="text-xs">{copy.guest.invitationNotice}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onCopyInvitation(guest)}
                    >
                      {copy.guest.copyInvitation}
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
          {busy ? copy.guest.loading : copy.guest.loadMore}
        </Button>
      ) : null}
    </section>
  );
}

function RsvpBadge({ guest }: { guest: GuestSummary }) {
  const copy = useUiCopy();
  if (!guest.rsvp) return <Badge>{copy.guest.awaiting}</Badge>;
  return guest.rsvp.attendance === "attending" ? (
    <Badge>{copy.guest.attendingCount(guest.rsvp.partySize)}</Badge>
  ) : (
    <Badge>{copy.guest.declined}</Badge>
  );
}
