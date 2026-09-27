"use client";

import type {
  UpdateWeddingInput,
  WeddingSummary,
} from "@lovechapter/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { safeUiError } from "../../lib/ui-error";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { StandardCodeCombobox } from "../ui/standard-code-combobox";
import { useUiCopy, useUiLanguage } from "../ui-language-provider";

function valuesOf(wedding: WeddingSummary): UpdateWeddingInput {
  return {
    name: wedding.name,
    weddingDate: wedding.weddingDate ?? null,
    timeZone: wedding.timeZone,
    locale: wedding.locale,
  };
}

export function WeddingSettingsForm({
  wedding,
  updateWedding,
  onSaved,
  onDirtyChange,
}: {
  wedding: WeddingSummary;
  updateWedding(
    weddingId: string,
    input: UpdateWeddingInput,
  ): Promise<WeddingSummary>;
  onSaved(wedding: WeddingSummary): void;
  onDirtyChange(dirty: boolean): void;
}) {
  const copy = useUiCopy();
  const language = useUiLanguage();
  const [draft, setDraft] = useState<UpdateWeddingInput>(() =>
    valuesOf(wedding),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const canEdit =
    wedding.role === "owner" ||
    wedding.role === "couple" ||
    wedding.role === "planner";

  function change(next: UpdateWeddingInput) {
    setDraft(next);
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(valuesOf(wedding)));
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await updateWedding(wedding.id, draft);
      if (!mounted.current) return;
      setDraft(valuesOf(saved));
      onSaved(saved);
      onDirtyChange(false);
    } catch (caught) {
      if (mounted.current)
        setError(safeUiError(caught, copy, copy.weddingSettings.error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Card className="space-y-5 border-[var(--rose-border)] p-5 sm:p-6">
      <div>
        <h2 className="font-serif text-2xl font-semibold text-[var(--rose-ink)]">
          {copy.weddingSettings.title}
        </h2>
        <p className="mt-1 text-sm text-[var(--rose-ink)]">
          {copy.weddingSettings.description}
        </p>
      </div>
      {!canEdit ? (
        <div className="space-y-2 text-sm text-[var(--rose-ink)]">
          <p>{copy.weddingSettings.readOnly}</p>
          <p>{wedding.name}</p>
          <p>
            {wedding.weddingDate
              ? new Intl.DateTimeFormat(language, {
                  dateStyle: "long",
                  timeZone: "UTC",
                }).format(new Date(`${wedding.weddingDate}T12:00:00.000Z`))
              : copy.workspace.datePending}
          </p>
          <p>
            {wedding.timeZone} · {wedding.locale}
          </p>
        </div>
      ) : (
        <form onSubmit={(event) => void save(event)} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="settings-name">{copy.workspace.weddingName}</Label>
            <Input
              id="settings-name"
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) =>
                change({ ...draft, name: event.target.value })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="settings-date">{copy.workspace.weddingDate}</Label>
            <Input
              id="settings-date"
              type="date"
              value={draft.weddingDate ?? ""}
              onChange={(event) =>
                change({ ...draft, weddingDate: event.target.value || null })
              }
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="settings-zone">{copy.workspace.timeZone}</Label>
              <StandardCodeCombobox
                kind="timeZone"
                uiLanguage={language}
                id="settings-zone"
                name="timeZone"
                value={draft.timeZone}
                onValueChange={(timeZone) => change({ ...draft, timeZone })}
                {...(draft.weddingDate ? { date: draft.weddingDate } : {})}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="settings-locale">{copy.workspace.locale}</Label>
              <StandardCodeCombobox
                kind="locale"
                uiLanguage={language}
                id="settings-locale"
                name="locale"
                value={draft.locale}
                onValueChange={(locale) => change({ ...draft, locale })}
              />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-[var(--rose-plum)]">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? copy.weddingSettings.saving : copy.weddingSettings.save}
          </Button>
        </form>
      )}
    </Card>
  );
}
