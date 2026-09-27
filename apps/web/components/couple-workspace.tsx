"use client";

import type {
  AuthenticatedUser,
  CreateGuestAffiliationInput,
  CreateWeddingInput,
  GuestAffiliation,
  GuestSummary,
  InvitationCreated,
  Page,
  PlanningOverview,
  RsvpSummary,
  UpdateGuestAffiliationInput,
  UpdateWeddingInput,
  WeddingSummary,
} from "@lovechapter/contracts";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Heart,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";

import { safeUiError } from "../lib/ui-error";
import {
  GuestWorkspace,
  type GuestWorkspaceApi,
} from "./guest-management/guest-workspace";
import {
  PlanningWorkspace,
  type PlanningWorkspaceApi,
} from "./planning/planning-workspace";
import {
  OperationsWorkspace,
  type OperationsWorkspaceApi,
} from "./operations/operations-workspace";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useUiCopy, useUiLanguage } from "./ui-language-provider";
import { localizeStoredUiMessage } from "../lib/ui-copy";
import { StandardCodeCombobox } from "./ui/standard-code-combobox";
import { LanguageSwitcher } from "./language-switcher";
import {
  WorkspaceNavigation,
  type WorkspaceSection,
} from "./workspace/workspace-navigation";
import { OverviewPanel } from "./workspace/overview-panel";
import { WeddingSettingsForm } from "./workspace/wedding-settings-form";
import { formatWeddingDate } from "../lib/format-wedding-date";
import { formDataEqual } from "../lib/form-data-equal";

export interface CoupleWorkspaceApi
  extends
    GuestWorkspaceApi,
    Partial<PlanningWorkspaceApi>,
    Partial<Omit<OperationsWorkspaceApi, "listGuests">> {
  listWeddings(cursor?: string): Promise<Page<WeddingSummary>>;
  createWedding(input: CreateWeddingInput): Promise<WeddingSummary>;
  updateWedding(
    weddingId: string,
    input: UpdateWeddingInput,
  ): Promise<WeddingSummary>;
  getPlanningOverview(weddingId: string): Promise<PlanningOverview>;
  getRsvpSummary(weddingId: string): Promise<RsvpSummary>;
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
  const copy = useUiCopy();
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const [weddings, setWeddings] = useState<WeddingSummary[]>([]);
  const [weddingCursor, setWeddingCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<WeddingSummary | null>(null);
  const [weddingScopeGeneration, setWeddingScopeGeneration] = useState(0);
  const [activeSection, setActiveSection] =
    useState<WorkspaceSection>("overview");
  const [showCreate, setShowCreate] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const dirtyForms = useRef(new Set<HTMLFormElement>());
  const dirtyEditors = useRef(new Set<"guest-import" | "envelope">());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [guestsLoaded, setGuestsLoaded] = useState(false);
  const [guestLoadError, setGuestLoadError] = useState(false);
  const [guestLoadMessage, setGuestLoadMessage] = useState<string | null>(null);
  const [guestRetry, setGuestRetry] = useState(0);
  const [guests, setGuests] = useState<GuestSummary[]>([]);
  const [invitations, setInvitations] = useState<
    Record<string, InvitationCreated>
  >({});
  const [affiliations, setAffiliations] = useState<GuestAffiliation[]>([]);
  const [guestCursor, setGuestCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [weddingListError, setWeddingListError] = useState(false);
  const [weddingListRetry, setWeddingListRetry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [creatingWedding, setCreatingWedding] = useState(false);
  const creatingWeddingRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const guestRequestId = useRef(0);
  const weddingGeneration = useRef(0);
  const workspaceMutationVersion = useRef(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setWeddingListError(false);
    void api
      .listWeddings()
      .then(async (weddingPage) => {
        if (!current) return;
        setWeddingListError(false);
        setMessage(null);
        setWeddings(weddingPage.items);
        setWeddingCursor(weddingPage.nextCursor);
        const first = weddingPage.items[0];
        if (!first) return;
        setWeddingScopeGeneration(weddingGeneration.current);
        setSelected(first);
      })
      .catch(() => {
        if (current) {
          setWeddingListError(true);
          setMessage(copyRef.current.workspace.disconnected);
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
  }, [api, weddingListRetry]);

  useEffect(() => {
    if (!selected || activeSection !== "guests") return;
    let current = true;
    const weddingId = selected.id;
    const generation = weddingGeneration.current;
    const requestId = ++guestRequestId.current;
    const mutationVersion = workspaceMutationVersion.current;
    setGuestsLoaded(false);
    setGuestLoadError(false);
    setGuestLoadMessage(null);
    setGuests([]);
    setAffiliations([]);
    void Promise.all([
      api.listGuests(weddingId),
      api.listGuestAffiliations(weddingId),
    ])
      .then(([page, loadedAffiliations]) => {
        if (
          current &&
          weddingGeneration.current === generation &&
          guestRequestId.current === requestId &&
          workspaceMutationVersion.current === mutationVersion
        ) {
          setGuests(page.items);
          setGuestCursor(page.nextCursor);
          setAffiliations(loadedAffiliations);
          setMessage(null);
        }
      })
      .catch((error: unknown) => {
        if (current && weddingGeneration.current === generation) {
          setGuestLoadError(true);
          setGuestLoadMessage(
            safeUiError(
              error,
              copyRef.current,
              copyRef.current.workspace.guestListError,
            ),
          );
        }
      })
      .finally(() => {
        if (current && weddingGeneration.current === generation) {
          setGuestsLoaded(true);
        }
      });
    return () => {
      current = false;
      guestRequestId.current += 1;
    };
  }, [api, selected?.id, activeSection, guestRetry]);

  function confirmDiscard(excluding?: HTMLFormElement): boolean {
    for (const form of dirtyForms.current) {
      if (!form.isConnected) dirtyForms.current.delete(form);
    }
    if (
      !settingsDirty &&
      ![...dirtyForms.current].some((form) => form !== excluding) &&
      dirtyEditors.current.size === 0
    )
      return true;
    if (!window.confirm(copy.weddingSettings.discardConfirm)) return false;
    setSettingsDirty(false);
    dirtyForms.current.clear();
    dirtyEditors.current.clear();
    return true;
  }

  function markFormDirty(target: EventTarget) {
    const form = (target as HTMLElement).closest("form");
    if (form instanceof HTMLFormElement) dirtyForms.current.add(form);
  }

  function changeSection(next: WorkspaceSection) {
    if (next === activeSection || !confirmDiscard()) return;
    setSettingsOpen(false);
    setActiveSection(next);
  }

  async function createWedding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingWeddingRef.current) return;
    const form = event.currentTarget;
    if (!confirmDiscard(form)) return;
    const data = new FormData(form);
    creatingWeddingRef.current = true;
    setCreatingWedding(true);
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
      setWeddingScopeGeneration(weddingGeneration.current);
      guestRequestId.current += 1;
      setSelected(created);
      setActiveSection("overview");
      setShowCreate(false);
      setPickerOpen(false);
      setGuestsLoaded(false);
      setGuests([]);
      setInvitations({});
      setAffiliations([]);
      setGuestCursor(null);
      form.reset();
    } catch (error) {
      setMessage(safeUiError(error, copy, copy.workspace.createError));
    } finally {
      creatingWeddingRef.current = false;
      setCreatingWedding(false);
    }
  }

  function chooseWedding(wedding: WeddingSummary) {
    if (!confirmDiscard()) return;
    weddingGeneration.current += 1;
    setWeddingScopeGeneration(weddingGeneration.current);
    guestRequestId.current += 1;
    setSelected(wedding);
    setActiveSection("overview");
    setSettingsOpen(false);
    setShowCreate(false);
    setPickerOpen(false);
    setGuestsLoaded(false);
    setGuests([]);
    setInvitations({});
    setAffiliations([]);
    setGuestCursor(null);
    setBusy(null);
    setMessage(null);
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
        setMessage(
          safeUiError(error, copy, copy.workspace.addAffiliationError),
        );
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
    const form = event.currentTarget;
    const data = new FormData(form);
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
        if (form.isConnected && formDataEqual(new FormData(form), data))
          dirtyForms.current.delete(form);
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
          safeUiError(error, copy, copy.workspace.updateAffiliationError),
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
        setMessage(
          safeUiError(error, copy, copy.workspace.reorderAffiliationError),
        );
      }
    } finally {
      if (weddingGeneration.current === generation) setBusy(null);
    }
  }

  async function deleteGuestAffiliation(affiliation: GuestAffiliation) {
    if (!selected) return;
    if (
      !window.confirm(copy.workspace.deleteAffiliationConfirm(affiliation.name))
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
          safeUiError(error, copy, copy.workspace.deleteAffiliationError),
        );
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
      setMessage(safeUiError(error, copy, copy.workspace.moreWeddingsError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen min-w-0 bg-[var(--rose-background)] px-4 py-5 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--rose-border)] pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-[var(--rose-plum)] text-white shadow-sm">
              <Heart
                aria-hidden="true"
                className="size-5"
                fill="currentColor"
              />
            </span>
            <div>
              <p className="font-serif text-xl font-semibold text-[var(--rose-ink)]">
                LoveChapter
              </p>
              <p className="text-xs tracking-[0.16em] text-[var(--rose-plum)] uppercase">
                {copy.workspace.label}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <LanguageSwitcher />
            <span className="max-w-40 truncate text-sm font-medium text-[var(--rose-ink)]">
              {identity.displayName}
            </span>
            <Button
              variant="ghost"
              disabled={creatingWedding}
              onClick={() => {
                if (confirmDiscard()) {
                  weddingGeneration.current += 1;
                  setWeddingScopeGeneration(weddingGeneration.current);
                  setInvitations({});
                  onSignOut();
                }
              }}
            >
              {copy.workspace.signOut}
            </Button>
          </div>
        </header>

        {message ? (
          <div
            role="alert"
            className="mb-5 rounded-2xl border border-[var(--rose-border)] bg-white px-4 py-3 text-sm text-[var(--rose-ink)]"
          >
            {localizeStoredUiMessage(message, copy)}
          </div>
        ) : null}

        {loading ? (
          <Card
            className="p-8 text-center text-[var(--rose-ink)]"
            aria-live="polite"
          >
            {copy.workspace.opening}
          </Card>
        ) : weddingListError ? (
          <Card className="mx-auto max-w-xl space-y-4 p-7 text-center">
            <p className="text-sm text-[var(--rose-ink)]">
              {copy.workspace.disconnected}
            </p>
            <Button onClick={() => setWeddingListRetry((value) => value + 1)}>
              {copy.workspace.retry}
            </Button>
          </Card>
        ) : !selected ? (
          <section className="mx-auto max-w-xl space-y-5">
            <div className="py-5 text-center">
              <CalendarDays
                aria-hidden="true"
                className="mx-auto mb-4 size-8 text-[var(--rose-plum)]"
              />
              <h1 className="font-serif text-3xl font-semibold text-[var(--rose-ink)]">
                {copy.workspace.beginTitle}
              </h1>
              <p className="mt-2 text-sm leading-6 text-[var(--rose-ink)]">
                {copy.workspace.beginDescription}
              </p>
            </div>
            <fieldset
              disabled={creatingWedding}
              className="min-w-0 border-0 p-0"
            >
              <WeddingForm busy={creatingWedding} onSubmit={createWedding} />
            </fieldset>
          </section>
        ) : (
          <fieldset
            disabled={creatingWedding}
            className="m-0 w-full min-w-0 border-0 p-0"
          >
            <section className="mb-6 rounded-[1.75rem] border border-[var(--rose-border)] bg-white/85 p-5 shadow-sm sm:p-6">
              <p className="text-xs font-bold tracking-[0.17em] text-[var(--rose-plum)] uppercase">
                {copy.workspace.current}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="font-serif text-3xl font-semibold break-words text-[var(--rose-ink)] sm:text-4xl">
                    {selected.name}
                  </h1>
                  <p className="mt-1 text-sm text-[var(--rose-ink)]">
                    {selected.weddingDate
                      ? formatWeddingDate(selected.weddingDate, selected.locale)
                      : copy.workspace.datePending}{" "}
                    · {selected.timeZone}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    aria-expanded={settingsOpen}
                    onClick={() => {
                      if (settingsOpen && !confirmDiscard()) return;
                      setSettingsOpen((open) => !open);
                    }}
                  >
                    {settingsOpen
                      ? copy.weddingSettings.close
                      : copy.weddingSettings.action}
                  </Button>
                  {weddings.length > 1 || weddingCursor ? (
                    <Button
                      variant="secondary"
                      aria-expanded={pickerOpen}
                      onClick={() => setPickerOpen((open) => !open)}
                    >
                      {copy.workspaceNavigation.chooseWedding}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (showCreate && !confirmDiscard()) return;
                      setShowCreate((shown) => !shown);
                    }}
                  >
                    {copy.workspaceNavigation.newWedding}
                  </Button>
                </div>
              </div>
              {pickerOpen ? (
                <div className="mt-4 rounded-2xl border border-[var(--rose-border)] bg-[var(--rose-soft)] p-2">
                  <div className="grid gap-1 sm:grid-cols-2">
                    {weddings.map((wedding) => (
                      <button
                        key={wedding.id}
                        type="button"
                        onClick={() => chooseWedding(wedding)}
                        className="min-h-11 rounded-xl px-3 py-2 text-left text-sm font-semibold text-[var(--rose-ink)] hover:bg-white focus-visible:ring-2 focus-visible:ring-[var(--rose-focus)] focus-visible:outline-none"
                      >
                        {wedding.name}
                        {selected.id === wedding.id
                          ? ` · ${copy.workspace.open}`
                          : ""}
                      </button>
                    ))}
                  </div>
                  {weddingCursor ? (
                    <Button
                      className="mt-2"
                      variant="ghost"
                      disabled={busy === "more-weddings"}
                      onClick={() => void loadMoreWeddings()}
                    >
                      {busy === "more-weddings"
                        ? copy.workspace.loading
                        : copy.workspace.loadMoreWeddings}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </section>

            {settingsOpen ? (
              <div className="mb-6 max-w-2xl">
                <WeddingSettingsForm
                  key={selected.id}
                  wedding={selected}
                  updateWedding={api.updateWedding}
                  onDirtyChange={setSettingsDirty}
                  onSaved={(saved) => {
                    setWeddings((current) =>
                      current.map((wedding) =>
                        wedding.id === saved.id ? saved : wedding,
                      ),
                    );
                    setSelected((current) =>
                      current?.id === saved.id ? saved : current,
                    );
                    setSettingsDirty(false);
                  }}
                />
              </div>
            ) : null}

            {showCreate ? (
              <div
                className="mb-6 max-w-xl"
                onInputCapture={(event) => markFormDirty(event.target)}
                onChangeCapture={(event) => markFormDirty(event.target)}
                onResetCapture={(event) =>
                  dirtyForms.current.delete(event.target as HTMLFormElement)
                }
              >
                <WeddingForm busy={creatingWedding} onSubmit={createWedding} />
              </div>
            ) : null}

            <div className="grid min-w-0 gap-5 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-7">
              <WorkspaceNavigation
                active={activeSection}
                onChange={changeSection}
              />
              <section
                aria-label={copy.workspaceNavigation[activeSection]}
                className="min-w-0 space-y-5"
                onInputCapture={(event) => markFormDirty(event.target)}
                onChangeCapture={(event) => markFormDirty(event.target)}
                onResetCapture={(event) =>
                  dirtyForms.current.delete(event.target as HTMLFormElement)
                }
              >
                {activeSection === "overview" ? (
                  <OverviewPanel
                    key={selected.id}
                    wedding={selected}
                    api={api}
                    onNavigate={changeSection}
                  />
                ) : null}
                {activeSection === "planning" && hasPlanningApi(api) ? (
                  <PlanningWorkspace
                    key={selected.id}
                    wedding={selected}
                    api={api}
                  />
                ) : null}
                {activeSection === "guests" ? (
                  guestLoadError ? (
                    <Card
                      role="alert"
                      className="space-y-4 p-6 text-[var(--rose-ink)]"
                    >
                      <p>{guestLoadMessage ?? copy.workspace.guestListError}</p>
                      <Button
                        onClick={() => setGuestRetry((value) => value + 1)}
                      >
                        {copy.workspace.retry}
                      </Button>
                    </Card>
                  ) : guestsLoaded ? (
                    <WeddingWorkspace
                      api={api}
                      wedding={selected}
                      guests={guests}
                      affiliations={affiliations}
                      busy={busy}
                      nextCursor={guestCursor}
                      onCreateAffiliation={createGuestAffiliation}
                      onUpdateAffiliation={updateGuestAffiliation}
                      onMoveAffiliation={moveGuestAffiliation}
                      onDeleteAffiliation={deleteGuestAffiliation}
                      onImportedAffiliation={(affiliation) =>
                        setAffiliations((current) => [...current, affiliation])
                      }
                      invitations={invitations}
                      onInvitationsChange={(update) => {
                        if (
                          weddingGeneration.current !== weddingScopeGeneration
                        )
                          return;
                        setInvitations((current) => {
                          if (
                            weddingGeneration.current !== weddingScopeGeneration
                          )
                            return current;
                          return typeof update === "function"
                            ? update(current)
                            : update;
                        });
                      }}
                      onImportDraftChange={(dirty) => {
                        if (
                          weddingGeneration.current !== weddingScopeGeneration
                        )
                          return;
                        if (dirty) dirtyEditors.current.add("guest-import");
                        else dirtyEditors.current.delete("guest-import");
                      }}
                      onEnvelopeDraftChange={(dirty) => {
                        if (
                          weddingGeneration.current !== weddingScopeGeneration
                        )
                          return;
                        if (dirty) dirtyEditors.current.add("envelope");
                        else dirtyEditors.current.delete("envelope");
                      }}
                    />
                  ) : (
                    <Card
                      aria-live="polite"
                      className="p-6 text-[var(--rose-ink)]"
                    >
                      {copy.workspace.loading}
                    </Card>
                  )
                ) : null}
                {(["budget", "schedule", "seating"] as const).includes(
                  activeSection as "budget" | "schedule" | "seating",
                ) && hasOperationsApi(api) ? (
                  <OperationsWorkspace
                    key={`operations:${selected.id}:${activeSection}`}
                    wedding={selected}
                    api={api}
                    section={activeSection as "budget" | "schedule" | "seating"}
                    onSaved={(form) => dirtyForms.current.delete(form)}
                  />
                ) : null}
              </section>
            </div>
          </fieldset>
        )}
      </div>
    </main>
  );
}

function hasPlanningApi(
  api: CoupleWorkspaceApi,
): api is CoupleWorkspaceApi & PlanningWorkspaceApi {
  return Boolean(
    api.listPlanningTasks &&
    api.createPlanningTask &&
    api.updatePlanningTask &&
    api.deletePlanningTask,
  );
}

function hasOperationsApi(
  api: CoupleWorkspaceApi,
): api is CoupleWorkspaceApi & OperationsWorkspaceApi {
  return Boolean(
    api.getBudgetOverview &&
    api.setBudget &&
    api.listBudgetCategories &&
    api.saveBudgetCategory &&
    api.deleteBudgetCategory &&
    api.listVendors &&
    api.saveVendor &&
    api.deleteVendor &&
    api.listExpenses &&
    api.saveExpense &&
    api.deleteExpense &&
    api.listRunSheet &&
    api.saveRunSheetItem &&
    api.deleteRunSheetItem &&
    api.listSeatingTables &&
    api.saveSeatingTable &&
    api.deleteSeatingTable &&
    api.listSeatingAssignments &&
    api.assignSeating,
  );
}

function WeddingForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  const copy = useUiCopy();
  const uiLanguage = useUiLanguage();
  const [weddingDate, setWeddingDate] = useState("");
  const [timeZone, setTimeZone] = useState("UTC");
  const [locale, setLocale] = useState("en");
  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      new Intl.DateTimeFormat("en", { timeZone: browserZone });
      setTimeZone(browserZone);
    } catch {
      /* Keep UTC. */
    }
    try {
      setLocale(new Intl.Locale(navigator.language).toString());
    } catch {
      /* Keep English. */
    }
  }, []);
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-full bg-[#f0e2db] text-sm font-bold text-[#71384b]">
          01
        </span>
        <div>
          <h2 className="font-serif text-2xl font-semibold text-[#432f35]">
            {copy.workspace.createTitle}
          </h2>
          <p className="text-sm text-[#806d70]">
            {copy.workspace.createDescription}
          </p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={copy.workspace.weddingName} htmlFor="wedding-name">
          <Input id="wedding-name" name="name" required maxLength={120} />
        </Field>
        <Field label={copy.workspace.weddingDate} htmlFor="wedding-date">
          <Input
            id="wedding-date"
            name="weddingDate"
            type="date"
            value={weddingDate}
            onChange={(event) => setWeddingDate(event.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Field label={copy.workspace.timeZone} htmlFor="wedding-time-zone">
            <StandardCodeCombobox
              kind="timeZone"
              uiLanguage={uiLanguage}
              id="wedding-time-zone"
              name="timeZone"
              value={timeZone}
              onValueChange={setTimeZone}
              date={weddingDate}
            />
          </Field>
          <Field label={copy.workspace.locale} htmlFor="wedding-locale">
            <StandardCodeCombobox
              kind="locale"
              uiLanguage={uiLanguage}
              id="wedding-locale"
              name="locale"
              value={locale}
              onValueChange={setLocale}
            />
          </Field>
        </div>
        <Button className="w-full" type="submit" disabled={busy}>
          {busy ? copy.workspace.creating : copy.workspace.create}
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
  const copy = useUiCopy();
  return (
    <Card className="p-5 sm:p-7">
      <div className="mb-5">
        <p className="text-xs font-bold tracking-[0.18em] text-[#925c68] uppercase">
          {copy.workspace.affiliationEyebrow}
        </p>
        <h3 className="font-serif text-2xl font-semibold text-[#432f35]">
          {copy.workspace.affiliationTitle}
        </h3>
        <p className="mt-1 text-sm leading-6 text-[#806d70]">
          {copy.workspace.affiliationDescription}
        </p>
      </div>

      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
        onSubmit={onCreate}
      >
        <Field
          label={copy.workspace.newAffiliation}
          htmlFor="new-affiliation-name"
        >
          <Input
            id="new-affiliation-name"
            name="name"
            required
            maxLength={80}
          />
        </Field>
        <Field label={copy.workspace.color} htmlFor="new-affiliation-color">
          <Input
            className="w-20 px-2"
            id="new-affiliation-color"
            name="color"
            type="color"
            defaultValue="#8c5261"
            aria-label={copy.workspace.color}
          />
        </Field>
        <Button type="submit" disabled={busy === "affiliation:create"}>
          {busy === "affiliation:create"
            ? copy.workspace.adding
            : copy.workspace.addAffiliation}
        </Button>
      </form>

      {affiliations.length === 0 ? (
        <p className="mt-4 rounded-xl bg-[#f8f1ed] px-4 py-3 text-sm text-[#806d70]">
          {copy.workspace.noAffiliations}
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
                aria-label={copy.workspace.affiliationColor(affiliation.name)}
              />
              <Field
                label={copy.workspace.affiliationName(affiliation.name)}
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
                {copy.workspace.save}
              </Button>
              <Button
                className="px-3"
                type="button"
                variant="ghost"
                aria-label={copy.workspace.moveUp(affiliation.name)}
                disabled={index === 0 || busy === "affiliation:order"}
                onClick={() => void onMove(affiliation.id, -1)}
              >
                <ChevronUp aria-hidden="true" className="size-4" />
              </Button>
              <Button
                className="px-3"
                type="button"
                variant="ghost"
                aria-label={copy.workspace.moveDown(affiliation.name)}
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
                aria-label={copy.workspace.delete(affiliation.name)}
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
  api,
  wedding,
  guests,
  affiliations,
  busy,
  nextCursor,
  onCreateAffiliation,
  onUpdateAffiliation,
  onMoveAffiliation,
  onDeleteAffiliation,
  onImportedAffiliation,
  invitations,
  onInvitationsChange,
  onImportDraftChange,
  onEnvelopeDraftChange,
}: {
  api: CoupleWorkspaceApi;
  wedding: WeddingSummary;
  guests: GuestSummary[];
  affiliations: GuestAffiliation[];
  busy: string | null;
  nextCursor: string | null;
  onCreateAffiliation(event: FormEvent<HTMLFormElement>): void;
  onUpdateAffiliation(
    affiliation: GuestAffiliation,
    event: FormEvent<HTMLFormElement>,
  ): void;
  onMoveAffiliation(affiliationId: string, direction: -1 | 1): Promise<void>;
  onDeleteAffiliation(affiliation: GuestAffiliation): Promise<void>;
  onImportedAffiliation(affiliation: GuestAffiliation): void;
  invitations: Record<string, InvitationCreated>;
  onInvitationsChange: Dispatch<
    SetStateAction<Record<string, InvitationCreated>>
  >;
  onImportDraftChange(dirty: boolean): void;
  onEnvelopeDraftChange(dirty: boolean): void;
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
      <GuestWorkspace
        key={wedding.id}
        weddingId={wedding.id}
        weddingName={wedding.name}
        affiliations={affiliations}
        initialPage={{ items: guests, nextCursor }}
        api={api}
        onAffiliationCreated={onImportedAffiliation}
        invitations={invitations}
        onInvitationsChange={onInvitationsChange}
        onImportDraftChange={onImportDraftChange}
        onEnvelopeDraftChange={onEnvelopeDraftChange}
      />
    </div>
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

function appendUnique<T extends { id: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}
