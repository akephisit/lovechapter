"use client";

import type {
  BulkGuestAffiliationInput,
  BulkGuestIdsInput,
  BulkGuestResult,
  CreateGuestInput,
  GuestAffiliation,
  GuestDetail,
  GuestListInput,
  GuestSummary,
  GuestView,
  InvitationCreated,
  Page,
  SetGuestAffiliationInput,
  UpdateGuestInput,
} from "@lovechapter/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  EnvelopeWorkspace,
  type EnvelopeApi,
} from "../envelope-print/envelope-workspace";
import {
  GuestImportWorkspace,
  type GuestImportApi,
} from "../guest-import/guest-import-workspace";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { GuestDetailDialog } from "./guest-detail-dialog";
import { GuestFiltersForm, type GuestFilters } from "./guest-filters";
import { GuestForm } from "./guest-form";
import { GuestList, type GuestSelection } from "./guest-list";

export interface GuestWorkspaceApi {
  listGuests(weddingId: string, cursor?: string): Promise<Page<GuestSummary>>;
  listGuestManagement?(
    weddingId: string,
    input: GuestListInput,
  ): Promise<Page<GuestSummary>>;
  addGuest(weddingId: string, input: CreateGuestInput): Promise<GuestSummary>;
  setGuestAffiliation(
    weddingId: string,
    guestId: string,
    input: SetGuestAffiliationInput,
  ): Promise<GuestSummary>;
  createInvitation?(
    weddingId: string,
    guestId: string,
  ): Promise<InvitationCreated>;
  replaceInvitation?(
    weddingId: string,
    guestId: string,
  ): Promise<InvitationCreated>;
  getGuest?(weddingId: string, guestId: string): Promise<GuestDetail>;
  updateGuest?(
    weddingId: string,
    guestId: string,
    input: UpdateGuestInput,
  ): Promise<GuestDetail>;
  archiveGuest?(weddingId: string, guestId: string): Promise<GuestDetail>;
  restoreGuest?(weddingId: string, guestId: string): Promise<GuestDetail>;
  bulkSetGuestAffiliation?(
    weddingId: string,
    input: BulkGuestAffiliationInput,
  ): Promise<BulkGuestResult>;
  bulkArchiveGuests?(
    weddingId: string,
    input: BulkGuestIdsInput,
  ): Promise<BulkGuestResult>;
  downloadGuestCsv?(
    weddingId: string,
    filters: Partial<
      Pick<GuestListInput, "search" | "affiliation" | "rsvp" | "view">
    >,
  ): Promise<void>;
  uploadGuestCsv?: GuestImportApi["uploadGuestCsv"];
  getGuestImportPreview?: GuestImportApi["getGuestImportPreview"];
  updateGuestImportMapping?: GuestImportApi["updateGuestImportMapping"];
  commitGuestImport?: GuestImportApi["commitGuestImport"];
  createGuestAffiliation?: GuestImportApi["createGuestAffiliation"];
  listEnvelopeTemplates?: EnvelopeApi["listEnvelopeTemplates"];
  createEnvelopeTemplate?: EnvelopeApi["createEnvelopeTemplate"];
  updateEnvelopeTemplate?: EnvelopeApi["updateEnvelopeTemplate"];
  deleteEnvelopeTemplate?: EnvelopeApi["deleteEnvelopeTemplate"];
  getEnvelopePrintData?: EnvelopeApi["getEnvelopePrintData"];
}

type GuestWorkspaceProps = {
  weddingId: string;
  weddingName: string;
  affiliations: GuestAffiliation[];
  initialPage: Page<GuestSummary>;
  initialView?: GuestView;
  api: GuestWorkspaceApi;
  onAffiliationCreated?: (affiliation: GuestAffiliation) => void;
};

export function GuestWorkspace(props: GuestWorkspaceProps) {
  return <WeddingGuestWorkspace key={props.weddingId} {...props} />;
}

function WeddingGuestWorkspace({
  weddingId,
  weddingName,
  affiliations,
  initialPage,
  initialView = "active",
  api,
  onAffiliationCreated,
}: GuestWorkspaceProps) {
  const [guests, setGuests] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [filters, setFilters] = useState<GuestFilters>({
    search: "",
    view: initialView,
  });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selection, setSelection] = useState<GuestSelection>(new Set());
  const [detail, setDetail] = useState<GuestDetail | null>(null);
  const [invitations, setInvitations] = useState<
    Record<string, InvitationCreated>
  >({});
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showEnvelopes, setShowEnvelopes] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestId = useRef(0);
  const mutationVersion = useRef(0);
  const skipFilterRequest = useRef(true);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(filters.search.trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  useEffect(() => {
    setGuests(initialPage.items);
    setNextCursor(initialPage.nextCursor);
    setFilters({ search: "", view: initialView });
    setDebouncedSearch("");
    setSelection(new Set());
    setInvitations({});
    requestId.current += 1;
    skipFilterRequest.current = true;
  }, [weddingId, initialView]);

  useEffect(() => {
    setGuests(initialPage.items);
    setNextCursor(initialPage.nextCursor);
  }, [initialPage.items, initialPage.nextCursor]);

  useEffect(() => {
    setGuests((current) =>
      current.map((guest) =>
        guest.affiliation &&
        !affiliations.some(
          (affiliation) => affiliation.id === guest.affiliation?.id,
        )
          ? { ...guest, affiliation: null }
          : guest,
      ),
    );
  }, [affiliations]);

  const requestFilters = useMemo<GuestListInput>(
    () => ({
      limit: 20,
      view: filters.view,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(filters.affiliation ? { affiliation: filters.affiliation } : {}),
      ...(filters.rsvp ? { rsvp: filters.rsvp } : {}),
    }),
    [debouncedSearch, filters.affiliation, filters.rsvp, filters.view],
  );

  useEffect(() => {
    if (skipFilterRequest.current) {
      skipFilterRequest.current = false;
      return;
    }
    setSelection(new Set());
    void loadPage(requestFilters, false);
  }, [requestFilters]);

  async function fetchPage(input: GuestListInput): Promise<Page<GuestSummary>> {
    return api.listGuestManagement
      ? api.listGuestManagement(weddingId, input)
      : api.listGuests(weddingId, input.cursor);
  }

  async function loadPage(input: GuestListInput, append: boolean) {
    const currentRequest = ++requestId.current;
    const currentMutation = mutationVersion.current;
    setBusy(true);
    setMessage(null);
    try {
      const page = await fetchPage(input);
      if (
        requestId.current !== currentRequest ||
        mutationVersion.current !== currentMutation
      ) {
        return;
      }
      setGuests((current) =>
        append ? appendUnique(current, page.items) : page.items,
      );
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (
        requestId.current === currentRequest &&
        mutationVersion.current === currentMutation
      ) {
        setMessage(readableError(error, "We couldn't load guests."));
      }
    } finally {
      if (requestId.current === currentRequest) setBusy(false);
    }
  }

  async function createGuest(input: CreateGuestInput) {
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.addGuest(weddingId, input);
      mutationVersion.current += 1;
      if (filters.view === "active") {
        const search = filters.search.trim();
        if (search || filters.affiliation || filters.rsvp) {
          await loadPage(
            {
              limit: 20,
              view: filters.view,
              ...(search ? { search } : {}),
              ...(filters.affiliation
                ? { affiliation: filters.affiliation }
                : {}),
              ...(filters.rsvp ? { rsvp: filters.rsvp } : {}),
            },
            false,
          );
        } else {
          setGuests((current) => appendUnique([created], current));
        }
      }
    } catch (error) {
      setMessage(readableError(error, "We couldn't add that guest."));
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(guest: GuestSummary) {
    if (!api.getGuest) return;
    setBusy(true);
    setMessage(null);
    try {
      setDetail(await api.getGuest(weddingId, guest.id));
    } catch (error) {
      setMessage(readableError(error, "We couldn't load that guest."));
    } finally {
      setBusy(false);
    }
  }

  async function saveDetail(input: UpdateGuestInput) {
    if (!detail || !api.updateGuest) return;
    setBusy(true);
    try {
      const updated = await api.updateGuest(weddingId, detail.id, input);
      mutationVersion.current += 1;
      setGuests((current) =>
        current.map((guest) =>
          guest.id === updated.id ? summary(updated) : guest,
        ),
      );
      setDetail(null);
    } catch (error) {
      setMessage(readableError(error, "We couldn't save that guest."));
    } finally {
      setBusy(false);
    }
  }

  async function archiveGuest(guest: GuestSummary) {
    if (!api.archiveGuest || !window.confirm(`Archive ${guest.name}?`)) return;
    setBusy(true);
    try {
      await api.archiveGuest(weddingId, guest.id);
      mutationVersion.current += 1;
      setGuests((current) => current.filter((item) => item.id !== guest.id));
      setInvitations((current) => {
        const next = { ...current };
        delete next[guest.id];
        return next;
      });
      removeSelection(guest.id);
    } catch (error) {
      setMessage(readableError(error, "We couldn't archive that guest."));
    } finally {
      setBusy(false);
    }
  }

  async function restoreGuest(guest: GuestSummary) {
    if (!api.restoreGuest) return;
    setBusy(true);
    try {
      await api.restoreGuest(weddingId, guest.id);
      mutationVersion.current += 1;
      setGuests((current) => current.filter((item) => item.id !== guest.id));
      removeSelection(guest.id);
    } catch (error) {
      setMessage(readableError(error, "We couldn't restore that guest."));
    } finally {
      setBusy(false);
    }
  }

  function removeSelection(guestId: string) {
    setSelection((current) => {
      const next = new Set(current);
      next.delete(guestId);
      return next;
    });
  }

  function toggleSelection(guestId: string) {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(guestId)) next.delete(guestId);
      else if (next.size < 200) next.add(guestId);
      return next;
    });
  }

  function selectVisible() {
    setSelection((current) => {
      const visible = guests.slice(0, 200).map((guest) => guest.id);
      if (visible.every((id) => current.has(id))) return new Set();
      return new Set(visible);
    });
  }

  async function bulkAffiliation(affiliationId: string | null) {
    if (!api.bulkSetGuestAffiliation || selection.size === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.bulkSetGuestAffiliation(weddingId, {
        guestIds: [...selection],
        affiliationId,
      });
      mutationVersion.current += 1;
      setSelection(new Set());
      await loadPage(requestFilters, false);
    } catch (error) {
      setMessage(readableError(error, "Bulk affiliation failed."));
    } finally {
      setBusy(false);
    }
  }

  async function bulkArchive() {
    if (!api.bulkArchiveGuests || selection.size === 0) return;
    if (
      !window.confirm(
        `Archive ${selection.size} guest${selection.size === 1 ? "" : "s"}? Their invitation links will be revoked.`,
      )
    )
      return;
    setBusy(true);
    setMessage(null);
    try {
      await api.bulkArchiveGuests(weddingId, { guestIds: [...selection] });
      mutationVersion.current += 1;
      setGuests((current) =>
        current.filter((guest) => !selection.has(guest.id)),
      );
      setInvitations((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => !selection.has(id)),
        ),
      );
      setSelection(new Set());
    } catch (error) {
      setMessage(readableError(error, "Bulk archive failed."));
    } finally {
      setBusy(false);
    }
  }

  async function createInvitation(guest: GuestSummary) {
    if (!api.createInvitation) return;
    setBusy(true);
    setMessage(null);
    try {
      const invitation = await api.createInvitation(weddingId, guest.id);
      setInvitations((current) => ({ ...current, [guest.id]: invitation }));
    } catch (error) {
      setMessage(readableError(error, "We couldn't create that invitation."));
    } finally {
      setBusy(false);
    }
  }

  async function replaceInvitation(guest: GuestSummary) {
    if (
      !api.replaceInvitation ||
      !window.confirm(
        `Issue a new invitation link for ${guest.name}? Any old link will stop working immediately. Share the new link with the guest.`,
      )
    )
      return;
    setBusy(true);
    setMessage(null);
    try {
      const invitation = await api.replaceInvitation(weddingId, guest.id);
      setInvitations((current) => ({ ...current, [guest.id]: invitation }));
    } catch (error) {
      setMessage(readableError(error, "We couldn't replace that invitation."));
    } finally {
      setBusy(false);
    }
  }

  async function copyInvitation(guest: GuestSummary) {
    const invitation = invitations[guest.id];
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.publicUrl);
    } catch {
      setMessage(
        "Copy failed. Select the invitation link and copy it manually.",
      );
    }
  }

  async function exportCsv() {
    if (!api.downloadGuestCsv) return;
    setDownloading(true);
    setMessage(null);
    try {
      const search = filters.search.trim();
      await api.downloadGuestCsv(weddingId, {
        view: filters.view,
        ...(search ? { search } : {}),
        ...(filters.affiliation ? { affiliation: filters.affiliation } : {}),
        ...(filters.rsvp ? { rsvp: filters.rsvp } : {}),
      });
    } catch (error) {
      setMessage(readableError(error, "We couldn't export the guest CSV."));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="bg-[#71384b] px-6 py-6 text-white">
          <p className="text-xs font-bold tracking-[0.2em] uppercase">
            Currently planning
          </p>
          <h2 className="font-serif text-3xl font-semibold">{weddingName}</h2>
        </div>
        <div className="p-5 sm:p-6">
          <h3 className="mb-4 font-serif text-2xl font-semibold">
            Add a guest
          </h3>
          <GuestForm
            affiliations={affiliations}
            busy={busy}
            onCreate={createGuest}
          />
        </div>
      </Card>

      {api.uploadGuestCsv &&
      api.getGuestImportPreview &&
      api.updateGuestImportMapping &&
      api.commitGuestImport &&
      api.createGuestAffiliation ? (
        <GuestImportWorkspace
          weddingId={weddingId}
          affiliations={affiliations}
          api={api as GuestImportApi}
          {...(onAffiliationCreated ? { onAffiliationCreated } : {})}
          onImported={() => {
            mutationVersion.current += 1;
            void loadPage(requestFilters, false);
          }}
        />
      ) : null}

      {message ? (
        <div
          role="alert"
          className="rounded-xl bg-[#fff3ed] p-3 text-[#743f45]"
        >
          {message}
        </div>
      ) : null}
      <GuestFiltersForm
        filters={filters}
        affiliations={affiliations}
        onChange={setFilters}
      />
      {api.downloadGuestCsv ? (
        <div className="rounded-xl bg-[#fff9f3] p-3 text-sm text-[#806d70]">
          Archived guests export only in Archived view. Invitation links are
          never included.
          <Button
            className="ml-3"
            type="button"
            variant="secondary"
            disabled={downloading}
            onClick={() => void exportCsv()}
          >
            Export filtered CSV
          </Button>
        </div>
      ) : null}
      {api.getEnvelopePrintData &&
      api.listEnvelopeTemplates &&
      api.createEnvelopeTemplate &&
      api.updateEnvelopeTemplate &&
      api.deleteEnvelopeTemplate &&
      filters.view === "active" ? (
        <div className="space-y-3">
          <Button
            variant="secondary"
            onClick={() => setShowEnvelopes((value) => !value)}
          >
            {showEnvelopes ? "Close envelope printing" : "Print envelopes"}
          </Button>
          {showEnvelopes ? (
            <EnvelopeWorkspace
              weddingId={weddingId}
              guests={guests}
              api={api as EnvelopeApi}
            />
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => void loadPage(requestFilters, false)}
        >
          Refresh responses
        </Button>
      </div>
      <GuestList
        guests={guests}
        affiliations={affiliations}
        selection={selection}
        view={filters.view}
        busy={busy}
        nextCursor={nextCursor}
        onToggle={toggleSelection}
        onSelectVisible={selectVisible}
        onEdit={(guest) => void openDetail(guest)}
        onArchive={(guest) => void archiveGuest(guest)}
        onRestore={(guest) => void restoreGuest(guest)}
        onLoadMore={() =>
          void (nextCursor
            ? loadPage({ ...requestFilters, cursor: nextCursor }, true)
            : undefined)
        }
        onBulkAffiliation={(affiliationId) =>
          void bulkAffiliation(affiliationId)
        }
        onBulkArchive={() => void bulkArchive()}
        invitations={invitations}
        onCreateInvitation={(guest) => void createInvitation(guest)}
        canReplaceInvitation={Boolean(api.replaceInvitation)}
        onReplaceInvitation={(guest) => void replaceInvitation(guest)}
        onCopyInvitation={(guest) => void copyInvitation(guest)}
      />

      {detail ? (
        <GuestDetailDialog
          guest={detail}
          busy={busy}
          onClose={() => setDetail(null)}
          onSave={saveDetail}
        />
      ) : null}
    </div>
  );
}

function summary(detail: GuestDetail): GuestSummary {
  const result: GuestSummary = {
    id: detail.id,
    name: detail.name,
    allowedPartySize: detail.allowedPartySize,
    affiliation: detail.affiliation,
    createdAt: detail.createdAt,
    rsvp: detail.rsvp,
  };
  if (detail.email) result.email = detail.email;
  if (detail.phone) result.phone = detail.phone;
  if (detail.archivedAt) result.archivedAt = detail.archivedAt;
  return result;
}

function appendUnique<T extends { id: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
