"use client";

import type {
  AuthenticatedUser,
  CreateGuestAffiliationInput,
  CreateGuestInput,
  CreateWeddingInput,
  GuestAffiliation,
  GuestSummary,
  InvitationCreated,
  Page,
  SetGuestAffiliationInput,
  UpdateGuestAffiliationInput,
  WeddingSummary,
} from "@lovechapter/contracts";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Copy,
  Heart,
  Link2,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";

export interface CoupleWorkspaceApi {
  listWeddings(cursor?: string): Promise<Page<WeddingSummary>>;
  createWedding(input: CreateWeddingInput): Promise<WeddingSummary>;
  listGuestAffiliations(weddingId: string): Promise<GuestAffiliation[]>;
  createGuestAffiliation(
    weddingId: string,
    input: CreateGuestAffiliationInput,
  ): Promise<GuestAffiliation>;
  updateGuestAffiliation(
    weddingId: string,
    affiliationId: string,
    input: UpdateGuestAffiliationInput,
  ): Promise<GuestAffiliation>;
  reorderGuestAffiliations(
    weddingId: string,
    ids: string[],
  ): Promise<GuestAffiliation[]>;
  deleteGuestAffiliation(
    weddingId: string,
    affiliationId: string,
  ): Promise<void>;
  listGuests(weddingId: string, cursor?: string): Promise<Page<GuestSummary>>;
  addGuest(weddingId: string, input: CreateGuestInput): Promise<GuestSummary>;
  setGuestAffiliation(
    weddingId: string,
    guestId: string,
    input: SetGuestAffiliationInput,
  ): Promise<GuestSummary>;
  createInvitation(
    weddingId: string,
    guestId: string,
  ): Promise<InvitationCreated>;
}

type Props = {
  identity: AuthenticatedUser;
  api: CoupleWorkspaceApi;
  onSignOut(): void;
};

export function CoupleWorkspace({ identity, api, onSignOut }: Props) {
  const [weddings, setWeddings] = useState<WeddingSummary[]>([]);
  const [weddingCursor, setWeddingCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<WeddingSummary | null>(null);
  const [guests, setGuests] = useState<GuestSummary[]>([]);
  const [affiliations, setAffiliations] = useState<GuestAffiliation[]>([]);
  const [guestCursor, setGuestCursor] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<
    Record<string, InvitationCreated>
  >({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedGuestId, setCopiedGuestId] = useState<string | null>(null);
  const guestRequestId = useRef(0);
  const weddingGeneration = useRef(0);
  const workspaceMutationVersion = useRef(0);

  useEffect(() => {
    let current = true;
    void api
      .listWeddings()
      .then(async (weddingPage) => {
        if (!current) return;
        setWeddings(weddingPage.items);
        setWeddingCursor(weddingPage.nextCursor);
        const first = weddingPage.items[0];
        if (!first) return;
        setSelected(first);
        const generation = ++weddingGeneration.current;
        const requestId = ++guestRequestId.current;
        const mutationVersion = workspaceMutationVersion.current;
        const [guestPage, loadedAffiliations] = await Promise.all([
          api.listGuests(first.id),
          api.listGuestAffiliations(first.id),
        ]);
        if (
          current &&
          weddingGeneration.current === generation &&
          guestRequestId.current === requestId &&
          workspaceMutationVersion.current === mutationVersion
        ) {
          setGuests(guestPage.items);
          setGuestCursor(guestPage.nextCursor);
          setAffiliations(loadedAffiliations);
        }
      })
      .catch(() => {
        if (current) {
          setMessage(
            "The planning workspace is not connected yet. Please try again.",
          );
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      weddingGeneration.current += 1;
      guestRequestId.current += 1;
    };
  }, [api]);

  async function createWedding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("wedding");
    setMessage(null);
    try {
      const weddingDate = stringValue(data, "weddingDate");
      const created = await api.createWedding({
        name: stringValue(data, "name"),
        ...(weddingDate ? { weddingDate } : {}),
        timeZone: stringValue(data, "timeZone"),
        locale: stringValue(data, "locale"),
      });
      setWeddings((current) => [created, ...current]);
      weddingGeneration.current += 1;
      guestRequestId.current += 1;
      setSelected(created);
      setGuests([]);
      setAffiliations([]);
      setGuestCursor(null);
      setInvitations({});
      form.reset();
    } catch (error) {
      setMessage(readableError(error, "We couldn't create that wedding."));
    } finally {
      setBusy(null);
    }
  }

  async function chooseWedding(wedding: WeddingSummary) {
    const generation = ++weddingGeneration.current;
    const requestId = ++guestRequestId.current;
    const mutationVersion = workspaceMutationVersion.current;
    setSelected(wedding);
    setGuests([]);
    setAffiliations([]);
    setGuestCursor(null);
    setInvitations({});
    setBusy("guests");
    setMessage(null);
    try {
      const [page, loadedAffiliations] = await Promise.all([
        api.listGuests(wedding.id),
        api.listGuestAffiliations(wedding.id),
      ]);
      if (
        weddingGeneration.current === generation &&
        guestRequestId.current === requestId &&
        workspaceMutationVersion.current === mutationVersion
      ) {
        setGuests(page.items);
        setGuestCursor(page.nextCursor);
        setAffiliations(loadedAffiliations);
      }
    } catch (error) {
      if (
        weddingGeneration.current === generation &&
        guestRequestId.current === requestId
      ) {
        setMessage(readableError(error, "We couldn't load this guest list."));
      }
    } finally {
      if (
        weddingGeneration.current === generation &&
        guestRequestId.current === requestId
      ) {
        setBusy(null);
      }
    }
  }

  async function addGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const weddingId = selected.id;
    const generation = weddingGeneration.current;
    setBusy("guest");
    setMessage(null);
    try {
      const email = stringValue(data, "email");
      const affiliationId = stringValue(data, "affiliationId");
      const created = await api.addGuest(weddingId, {
        name: stringValue(data, "guestName"),
        ...(email ? { email } : {}),
        ...(affiliationId ? { affiliationId } : {}),
        allowedPartySize: Number(data.get("allowedPartySize")),
      });
      if (weddingGeneration.current === generation) {
        workspaceMutationVersion.current += 1;
        setGuests((current) => [created, ...current]);
        form.reset();
      }
    } catch (error) {
      if (weddingGeneration.current === generation) {
        setMessage(readableError(error, "We couldn't add that guest."));
      }
    } finally {
      if (weddingGeneration.current === generation) setBusy(null);
    }
  }

  async function createGuestAffiliation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const weddingId = selected.id;
    const generation = weddingGeneration.current;
    setBusy("affiliation:create");
    setMessage(null);
    try {
      const created = await api.createGuestAffiliation(weddingId, {
        name: stringValue(data, "name"),
        color: stringValue(data, "color"),
      });
      if (weddingGeneration.current === generation) {
        workspaceMutationVersion.current += 1;
        setAffiliations((current) => [...current, created]);
        form.reset();
      }
    } catch (error) {
      if (weddingGeneration.current === generation) {
        setMessage(readableError(error, "We couldn't add that affiliation."));
      }
    } finally {
      if (weddingGeneration.current === generation) setBusy(null);
    }
  }

  async function updateGuestAffiliation(
    affiliation: GuestAffiliation,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const weddingId = selected.id;
    const generation = weddingGeneration.current;
    setBusy(`affiliation:update:${affiliation.id}`);
    setMessage(null);
    try {
      const updated = await api.updateGuestAffiliation(
        weddingId,
        affiliation.id,
        {
          name: stringValue(data, "name"),
          color: stringValue(data, "color"),
        },
      );
      if (weddingGeneration.current === generation) {
        workspaceMutationVersion.current += 1;
        setAffiliations((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        setGuests((current) =>
          current.map((guest) =>
            guest.affiliation?.id === updated.id
              ? { ...guest, affiliation: updated }
              : guest,
          ),
        );
      }
    } catch (error) {
      if (weddingGeneration.current === generation) {
        setMessage(
          readableError(error, "We couldn't update that affiliation."),
        );
      }
    } finally {
      if (weddingGeneration.current === generation) setBusy(null);
    }
  }

  async function moveGuestAffiliation(
    affiliationId: string,
    direction: -1 | 1,
  ) {
    if (!selected) return;
    const weddingId = selected.id;
    const generation = weddingGeneration.current;
    const currentIndex = affiliations.findIndex(
      (item) => item.id === affiliationId,
    );
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= affiliations.length) {
      return;
    }
    const ids = affiliations.map((item) => item.id);
    [ids[currentIndex], ids[nextIndex]] = [ids[nextIndex]!, ids[currentIndex]!];
    setBusy("affiliation:order");
    setMessage(null);
    try {
      const reordered = await api.reorderGuestAffiliations(weddingId, ids);
      if (weddingGeneration.current === generation) {
        workspaceMutationVersion.current += 1;
        setAffiliations(reordered);
      }
    } catch (error) {
      if (weddingGeneration.current === generation) {
        setMessage(readableError(error, "We couldn't reorder affiliations."));
      }
    } finally {
      if (weddingGeneration.current === generation) setBusy(null);
    }
  }

  async function deleteGuestAffiliation(affiliation: GuestAffiliation) {
    if (!selected) return;
    if (
      !window.confirm(
        `Delete “${affiliation.name}”? Guests in this affiliation will become unassigned.`,
      )
    ) {
      return;
    }
    const weddingId = selected.id;
    const generation = weddingGeneration.current;
    setBusy(`affiliation:delete:${affiliation.id}`);
    setMessage(null);
    try {
      await api.deleteGuestAffiliation(weddingId, affiliation.id);
      if (weddingGeneration.current === generation) {
        workspaceMutationVersion.current += 1;
        setAffiliations((current) =>
          current.filter((item) => item.id !== affiliation.id),
        );
        setGuests((current) =>
          current.map((guest) =>
            guest.affiliation?.id === affiliation.id
              ? { ...guest, affiliation: null }
              : guest,
          ),
        );
      }
    } catch (error) {
      if (weddingGeneration.current === generation) {
        setMessage(
          readableError(error, "We couldn't delete that affiliation."),
        );
      }
    } finally {
      if (weddingGeneration.current === generation) setBusy(null);
    }
  }

  async function setGuestAffiliation(
    guest: GuestSummary,
    affiliationId: string | null,
  ) {
    if (!selected) return;
    const weddingId = selected.id;
    const generation = weddingGeneration.current;
    setBusy(`guest:affiliation:${guest.id}`);
    setMessage(null);
    try {
      const updated = await api.setGuestAffiliation(weddingId, guest.id, {
        affiliationId,
      });
      if (weddingGeneration.current === generation) {
        workspaceMutationVersion.current += 1;
        setGuests((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
    } catch (error) {
      if (weddingGeneration.current === generation) {
        setMessage(
          readableError(error, "We couldn't change that guest affiliation."),
        );
      }
    } finally {
      if (weddingGeneration.current === generation) setBusy(null);
    }
  }

  async function createInvitation(guest: GuestSummary) {
    if (!selected) return;
    const weddingId = selected.id;
    const generation = weddingGeneration.current;
    setBusy(`invitation:${guest.id}`);
    setMessage(null);
    try {
      const invitation = await api.createInvitation(weddingId, guest.id);
      if (weddingGeneration.current === generation) {
        setInvitations((current) => ({
          ...current,
          [guest.id]: invitation,
        }));
      }
    } catch (error) {
      if (weddingGeneration.current === generation) {
        setMessage(readableError(error, "We couldn't create that invitation."));
      }
    } finally {
      if (weddingGeneration.current === generation) setBusy(null);
    }
  }

  async function loadMoreWeddings() {
    if (!weddingCursor) return;
    setBusy("more-weddings");
    setMessage(null);
    try {
      const page = await api.listWeddings(weddingCursor);
      setWeddings((current) => appendUnique(current, page.items));
      setWeddingCursor(page.nextCursor);
    } catch (error) {
      setMessage(readableError(error, "We couldn't load more weddings."));
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreGuests() {
    if (!selected || !guestCursor) return;
    const weddingId = selected.id;
    const generation = weddingGeneration.current;
    const mutationVersion = workspaceMutationVersion.current;
    const requestId = ++guestRequestId.current;
    setBusy("more-guests");
    setMessage(null);
    try {
      const page = await api.listGuests(weddingId, guestCursor);
      if (
        weddingGeneration.current === generation &&
        guestRequestId.current === requestId &&
        workspaceMutationVersion.current === mutationVersion
      ) {
        setGuests((current) => appendUnique(current, page.items));
        setGuestCursor(page.nextCursor);
      }
    } catch (error) {
      if (
        weddingGeneration.current === generation &&
        guestRequestId.current === requestId &&
        workspaceMutationVersion.current === mutationVersion
      ) {
        setMessage(readableError(error, "We couldn't load more guests."));
      }
    } finally {
      if (
        weddingGeneration.current === generation &&
        guestRequestId.current === requestId
      ) {
        setBusy(null);
      }
    }
  }

  async function refreshGuests() {
    if (!selected) return;
    const weddingId = selected.id;
    const generation = weddingGeneration.current;
    const mutationVersion = workspaceMutationVersion.current;
    const requestId = ++guestRequestId.current;
    setBusy("refresh-guests");
    setMessage(null);
    try {
      const page = await api.listGuests(weddingId);
      if (
        weddingGeneration.current === generation &&
        guestRequestId.current === requestId &&
        workspaceMutationVersion.current === mutationVersion
      ) {
        setGuests(page.items);
        setGuestCursor(page.nextCursor);
      }
    } catch (error) {
      if (
        weddingGeneration.current === generation &&
        guestRequestId.current === requestId &&
        workspaceMutationVersion.current === mutationVersion
      ) {
        setMessage(readableError(error, "We couldn't refresh responses."));
      }
    } finally {
      if (
        weddingGeneration.current === generation &&
        guestRequestId.current === requestId
      ) {
        setBusy(null);
      }
    }
  }

  async function copyInvitation(guest: GuestSummary) {
    const invitation = invitations[guest.id];
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.publicUrl);
      setCopiedGuestId(guest.id);
    } catch {
      setMessage(
        "Copy failed. Select the invitation link and copy it manually.",
      );
    }
  }

  return (
    <main className="min-h-screen overflow-hidden px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[34rem] bg-[radial-gradient(circle_at_15%_10%,rgba(205,150,143,0.25),transparent_35%),radial-gradient(circle_at_85%_5%,rgba(177,138,163,0.2),transparent_32%)]" />
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-[#71384b] text-white shadow-lg">
              <Heart
                aria-hidden="true"
                className="size-5"
                fill="currentColor"
              />
            </span>
            <div>
              <p className="font-serif text-xl font-semibold tracking-tight text-[#432f35]">
                LoveChapter
              </p>
              <p className="text-xs tracking-[0.18em] text-[#8c7478] uppercase">
                Wedding workspace
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-[#574248]">
              {identity.displayName}
            </span>
            <Button variant="ghost" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </header>

        <section className="mb-8 max-w-3xl">
          <p className="mb-3 text-sm font-bold tracking-[0.22em] text-[#925c68] uppercase">
            Your story, thoughtfully gathered
          </p>
          <h1 className="font-serif text-4xl leading-[1.05] font-semibold text-[#3e2d31] sm:text-5xl lg:text-6xl">
            Plan the chapter everyone will remember.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[#725f62] sm:text-lg">
            Start with one wedding, welcome your guests, and keep every reply in
            one calm place.
          </p>
        </section>

        {message ? (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-[#d6aaa4] bg-[#fff3ed] px-4 py-3 text-sm text-[#743f45]"
          >
            {message}
          </div>
        ) : null}

        {loading ? (
          <Card className="p-8 text-center text-[#725f62]" aria-live="polite">
            Opening your workspace…
          </Card>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.45fr)]">
            <div className="space-y-6">
              <WeddingForm busy={busy === "wedding"} onSubmit={createWedding} />
              {weddings.length > 0 ? (
                <Card className="p-5">
                  <h2 className="mb-3 text-sm font-bold tracking-[0.16em] text-[#806a6d] uppercase">
                    Your weddings
                  </h2>
                  <div className="space-y-2">
                    {weddings.map((wedding) => (
                      <button
                        key={wedding.id}
                        type="button"
                        onClick={() => void chooseWedding(wedding)}
                        className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold text-[#523b41] transition hover:bg-[#f6ece6] focus-visible:ring-2 focus-visible:ring-[#7d4152] focus-visible:outline-none"
                      >
                        {wedding.name}
                        {selected?.id === wedding.id ? (
                          <Badge>Open</Badge>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  {weddingCursor ? (
                    <Button
                      className="mt-3 w-full"
                      variant="ghost"
                      disabled={busy === "more-weddings"}
                      onClick={() => void loadMoreWeddings()}
                    >
                      {busy === "more-weddings"
                        ? "Loading…"
                        : "Load more weddings"}
                    </Button>
                  ) : null}
                </Card>
              ) : null}
            </div>

            {selected ? (
              <WeddingWorkspace
                wedding={selected}
                guests={guests}
                affiliations={affiliations}
                invitations={invitations}
                busy={busy}
                nextCursor={guestCursor}
                copiedGuestId={copiedGuestId}
                onAddGuest={addGuest}
                onCreateAffiliation={createGuestAffiliation}
                onUpdateAffiliation={updateGuestAffiliation}
                onMoveAffiliation={moveGuestAffiliation}
                onDeleteAffiliation={deleteGuestAffiliation}
                onSetGuestAffiliation={setGuestAffiliation}
                onCreateInvitation={createInvitation}
                onCopyInvitation={copyInvitation}
                onLoadMore={loadMoreGuests}
                onRefresh={refreshGuests}
              />
            ) : (
              <Card className="relative overflow-hidden p-8 sm:p-10">
                <div className="absolute top-0 right-0 size-44 translate-x-16 -translate-y-16 rounded-full bg-[#e7d2cb]/60" />
                <CalendarDays className="mb-5 size-8 text-[#8c5261]" />
                <h2 className="font-serif text-3xl font-semibold text-[#432f35]">
                  Begin with the day
                </h2>
                <p className="mt-3 max-w-xl leading-7 text-[#756266]">
                  Create your wedding to unlock the guest list and private RSVP
                  invitations. You can keep the date open for now.
                </p>
              </Card>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function WeddingForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-full bg-[#f0e2db] text-sm font-bold text-[#71384b]">
          01
        </span>
        <div>
          <h2 className="font-serif text-2xl font-semibold text-[#432f35]">
            Create a wedding
          </h2>
          <p className="text-sm text-[#806d70]">A home for this celebration.</p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Wedding name" htmlFor="wedding-name">
          <Input id="wedding-name" name="name" required maxLength={120} />
        </Field>
        <Field label="Wedding date (optional)" htmlFor="wedding-date">
          <Input id="wedding-date" name="weddingDate" type="date" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Field label="Time zone" htmlFor="wedding-time-zone">
            <Input
              id="wedding-time-zone"
              name="timeZone"
              defaultValue="Asia/Bangkok"
              required
            />
          </Field>
          <Field label="Locale" htmlFor="wedding-locale">
            <Input
              id="wedding-locale"
              name="locale"
              defaultValue="en"
              required
            />
          </Field>
        </div>
        <Button className="w-full" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create wedding"}
        </Button>
      </form>
    </Card>
  );
}

function GuestAffiliationManager({
  affiliations,
  busy,
  onCreate,
  onUpdate,
  onMove,
  onDelete,
}: {
  affiliations: GuestAffiliation[];
  busy: string | null;
  onCreate(event: FormEvent<HTMLFormElement>): void;
  onUpdate(
    affiliation: GuestAffiliation,
    event: FormEvent<HTMLFormElement>,
  ): void;
  onMove(affiliationId: string, direction: -1 | 1): Promise<void>;
  onDelete(affiliation: GuestAffiliation): Promise<void>;
}) {
  return (
    <Card className="p-5 sm:p-7">
      <div className="mb-5">
        <p className="text-xs font-bold tracking-[0.18em] text-[#925c68] uppercase">
          Organize your guests
        </p>
        <h3 className="font-serif text-2xl font-semibold text-[#432f35]">
          Guest affiliations
        </h3>
        <p className="mt-1 text-sm leading-6 text-[#806d70]">
          Create the affiliations that fit this wedding. Nothing is predefined,
          and deleting one keeps its guests as unassigned.
        </p>
      </div>

      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
        onSubmit={onCreate}
      >
        <Field label="New affiliation name" htmlFor="new-affiliation-name">
          <Input
            id="new-affiliation-name"
            name="name"
            required
            maxLength={80}
          />
        </Field>
        <Field label="Color" htmlFor="new-affiliation-color">
          <Input
            className="w-20 px-2"
            id="new-affiliation-color"
            name="color"
            type="color"
            defaultValue="#8c5261"
            aria-label="New affiliation color"
          />
        </Field>
        <Button type="submit" disabled={busy === "affiliation:create"}>
          {busy === "affiliation:create" ? "Adding…" : "Add affiliation"}
        </Button>
      </form>

      {affiliations.length === 0 ? (
        <p className="mt-4 rounded-xl bg-[#f8f1ed] px-4 py-3 text-sm text-[#806d70]">
          No affiliations yet. Guests can still be added without one.
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {affiliations.map((affiliation, index) => (
            <form
              key={affiliation.id}
              className="grid gap-3 rounded-2xl border border-[#eadbd3] bg-white/70 p-3 sm:grid-cols-[auto_1fr_auto_auto_auto_auto] sm:items-end"
              onSubmit={(event) => onUpdate(affiliation, event)}
            >
              <Input
                className="w-14 px-2"
                name="color"
                type="color"
                defaultValue={affiliation.color}
                aria-label={`${affiliation.name} color`}
              />
              <Field
                label={`${affiliation.name} name`}
                htmlFor={`affiliation-name-${affiliation.id}`}
              >
                <Input
                  id={`affiliation-name-${affiliation.id}`}
                  name="name"
                  defaultValue={affiliation.name}
                  required
                  maxLength={80}
                />
              </Field>
              <Button
                className="px-3"
                type="submit"
                variant="secondary"
                disabled={busy === `affiliation:update:${affiliation.id}`}
              >
                Save
              </Button>
              <Button
                className="px-3"
                type="button"
                variant="ghost"
                aria-label={`Move ${affiliation.name} up`}
                disabled={index === 0 || busy === "affiliation:order"}
                onClick={() => void onMove(affiliation.id, -1)}
              >
                <ChevronUp aria-hidden="true" className="size-4" />
              </Button>
              <Button
                className="px-3"
                type="button"
                variant="ghost"
                aria-label={`Move ${affiliation.name} down`}
                disabled={
                  index === affiliations.length - 1 ||
                  busy === "affiliation:order"
                }
                onClick={() => void onMove(affiliation.id, 1)}
              >
                <ChevronDown aria-hidden="true" className="size-4" />
              </Button>
              <Button
                className="px-3 text-[#8a3544]"
                type="button"
                variant="ghost"
                aria-label={`Delete ${affiliation.name}`}
                disabled={busy === `affiliation:delete:${affiliation.id}`}
                onClick={() => void onDelete(affiliation)}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </form>
          ))}
        </div>
      )}
    </Card>
  );
}

function WeddingWorkspace({
  wedding,
  guests,
  affiliations,
  invitations,
  busy,
  nextCursor,
  copiedGuestId,
  onAddGuest,
  onCreateAffiliation,
  onUpdateAffiliation,
  onMoveAffiliation,
  onDeleteAffiliation,
  onSetGuestAffiliation,
  onCreateInvitation,
  onCopyInvitation,
  onLoadMore,
  onRefresh,
}: {
  wedding: WeddingSummary;
  guests: GuestSummary[];
  affiliations: GuestAffiliation[];
  invitations: Record<string, InvitationCreated>;
  busy: string | null;
  nextCursor: string | null;
  copiedGuestId: string | null;
  onAddGuest(event: FormEvent<HTMLFormElement>): void;
  onCreateAffiliation(event: FormEvent<HTMLFormElement>): void;
  onUpdateAffiliation(
    affiliation: GuestAffiliation,
    event: FormEvent<HTMLFormElement>,
  ): void;
  onMoveAffiliation(affiliationId: string, direction: -1 | 1): Promise<void>;
  onDeleteAffiliation(affiliation: GuestAffiliation): Promise<void>;
  onSetGuestAffiliation(
    guest: GuestSummary,
    affiliationId: string | null,
  ): Promise<void>;
  onCreateInvitation(guest: GuestSummary): Promise<void>;
  onCopyInvitation(guest: GuestSummary): Promise<void>;
  onLoadMore(): Promise<void>;
  onRefresh(): Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <GuestAffiliationManager
        affiliations={affiliations}
        busy={busy}
        onCreate={onCreateAffiliation}
        onUpdate={onUpdateAffiliation}
        onMove={onMoveAffiliation}
        onDelete={onDeleteAffiliation}
      />

      <Card className="overflow-hidden">
        <div className="border-b border-[#eadbd3] bg-[linear-gradient(120deg,rgba(113,56,75,0.96),rgba(137,79,88,0.9))] px-6 py-7 text-white sm:px-8">
          <p className="mb-1 text-xs font-bold tracking-[0.2em] text-[#f4dfe0] uppercase">
            Currently planning
          </p>
          <h2 className="font-serif text-3xl font-semibold sm:text-4xl">
            {wedding.name}
          </h2>
          <p className="mt-2 text-sm text-white/75">
            {wedding.weddingDate ?? "Date to be announced"} · {wedding.timeZone}
          </p>
        </div>
        <div className="p-5 sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-[#f0e2db] text-sm font-bold text-[#71384b]">
              02
            </span>
            <div>
              <h3 className="font-serif text-2xl font-semibold text-[#432f35]">
                Add a guest
              </h3>
              <p className="text-sm text-[#806d70]">
                Each guest receives a private invitation link.
              </p>
            </div>
          </div>
          <form
            onSubmit={onAddGuest}
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.2fr_1.2fr_0.9fr_0.7fr_auto] xl:items-end"
          >
            <Field label="Guest name" htmlFor="guest-name">
              <Input
                id="guest-name"
                name="guestName"
                required
                maxLength={120}
              />
            </Field>
            <Field label="Email (optional)" htmlFor="guest-email">
              <Input
                id="guest-email"
                name="email"
                type="email"
                maxLength={320}
              />
            </Field>
            <Field label="Guest affiliation" htmlFor="guest-affiliation">
              <Select id="guest-affiliation" name="affiliationId">
                <option value="">No affiliation</option>
                {affiliations.map((affiliation) => (
                  <option key={affiliation.id} value={affiliation.id}>
                    {affiliation.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Party allowance" htmlFor="party-allowance">
              <Input
                id="party-allowance"
                name="allowedPartySize"
                type="number"
                min={1}
                max={20}
                defaultValue={1}
                required
              />
            </Field>
            <Button type="submit" disabled={busy === "guest"}>
              {busy === "guest" ? "Adding…" : "Add guest"}
            </Button>
          </form>
        </div>
      </Card>

      <section aria-labelledby="guest-list-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-4 px-1">
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-[#925c68] uppercase">
              Responses
            </p>
            <h3
              id="guest-list-title"
              className="font-serif text-2xl font-semibold text-[#432f35]"
            >
              Guest list
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Badge>{guests.length} loaded</Badge>
            <Button
              variant="ghost"
              disabled={busy === "refresh-guests"}
              onClick={() => void onRefresh()}
            >
              {busy === "refresh-guests" ? "Refreshing…" : "Refresh responses"}
            </Button>
          </div>
        </div>
        {guests.length === 0 ? (
          <Card className="p-7 text-center">
            <Users className="mx-auto mb-3 size-7 text-[#a2737e]" />
            <p className="font-medium text-[#655156]">No guests yet</p>
            <p className="mt-1 text-sm text-[#8a7679]">
              Add your first guest above when you are ready.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3">
            {guests.map((guest) => {
              const invitation = invitations[guest.id];
              return (
                <Card key={guest.id} className="p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-serif text-xl font-semibold text-[#432f35]">
                          {guest.name}
                        </p>
                        <ResponseBadge guest={guest} />
                        {guest.affiliation ? (
                          <Badge
                            style={{
                              borderColor: guest.affiliation.color,
                              color: guest.affiliation.color,
                            }}
                          >
                            {guest.affiliation.name}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-[#806d70]">
                        Up to {guest.allowedPartySize} attending
                        {guest.email ? ` · ${guest.email}` : ""}
                      </p>
                      <Select
                        className="mt-3 max-w-xs"
                        aria-label={`${guest.name} affiliation`}
                        value={guest.affiliation?.id ?? ""}
                        disabled={busy === `guest:affiliation:${guest.id}`}
                        onChange={(event) =>
                          void onSetGuestAffiliation(
                            guest,
                            event.currentTarget.value || null,
                          )
                        }
                      >
                        <option value="">No affiliation</option>
                        {affiliations.map((affiliation) => (
                          <option key={affiliation.id} value={affiliation.id}>
                            {affiliation.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button
                      variant="secondary"
                      disabled={busy === `invitation:${guest.id}`}
                      onClick={() => void onCreateInvitation(guest)}
                    >
                      <Link2 aria-hidden="true" className="mr-2 size-4" />
                      {busy === `invitation:${guest.id}`
                        ? "Creating…"
                        : "Create invitation"}
                    </Button>
                  </div>
                  {invitation ? (
                    <div className="mt-4 rounded-2xl border border-[#dfc8bf] bg-[#fff9f3] p-4">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0">
                          <a
                            href={invitation.publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-semibold break-all text-[#71384b] underline decoration-[#c49aa2] underline-offset-4 hover:text-[#4f2634]"
                            aria-label={`Open ${guest.name}'s invitation`}
                          >
                            {invitation.publicUrl}
                          </a>
                          <p className="mt-1 text-xs leading-5 text-[#8b7477]">
                            This secure link is shown only for this session.
                            Copy it before leaving.
                          </p>
                          <Button
                            className="mt-2 px-3 py-1.5"
                            variant="ghost"
                            onClick={() => void onCopyInvitation(guest)}
                          >
                            <Copy aria-hidden="true" className="mr-2 size-4" />
                            Copy invitation link
                          </Button>
                          {copiedGuestId === guest.id ? (
                            <span
                              role="status"
                              className="ml-2 text-xs text-[#456648]"
                            >
                              Copied
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </Card>
              );
            })}
            {nextCursor ? (
              <Button
                className="mx-auto mt-2"
                variant="secondary"
                disabled={busy === "more-guests"}
                onClick={() => void onLoadMore()}
              >
                {busy === "more-guests" ? "Loading…" : "Load more guests"}
              </Button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function ResponseBadge({ guest }: { guest: GuestSummary }) {
  if (!guest.rsvp) return <Badge>Awaiting response</Badge>;
  return guest.rsvp.attendance === "attending" ? (
    <Badge className="bg-[#dcebdc] text-[#355b3a]">
      Attending · {guest.rsvp.partySize}
    </Badge>
  ) : (
    <Badge className="bg-[#eee8e5] text-[#685b5b]">Declined</Badge>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function stringValue(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function appendUnique<T extends { id: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}
