"use client";

import type {
  EnvelopePrintData,
  EnvelopePrintDataInput,
  EnvelopeTemplate,
  EnvelopeTemplateInput,
  GuestSummary,
} from "@lovechapter/contracts";
import { normalizeEnvelopeTemplateInput } from "@lovechapter/domain";
import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EnvelopePages } from "./envelope-pages";
import { EnvelopeTemplateForm } from "./envelope-template-form";

export interface EnvelopeApi {
  listEnvelopeTemplates(weddingId: string): Promise<EnvelopeTemplate[]>;
  createEnvelopeTemplate(
    weddingId: string,
    input: EnvelopeTemplateInput,
  ): Promise<EnvelopeTemplate>;
  updateEnvelopeTemplate(
    weddingId: string,
    templateId: string,
    input: EnvelopeTemplateInput,
  ): Promise<EnvelopeTemplate>;
  deleteEnvelopeTemplate(weddingId: string, templateId: string): Promise<void>;
  getEnvelopePrintData(
    weddingId: string,
    input: EnvelopePrintDataInput,
  ): Promise<EnvelopePrintData>;
}

const defaultTemplate: EnvelopeTemplateInput = {
  name: "DL envelopes",
  widthMm: 220,
  heightMm: 110,
  orientation: "landscape",
  marginTopMm: 10,
  marginRightMm: 10,
  marginBottomMm: 10,
  marginLeftMm: 10,
  alignment: "center",
  fontFamily: "noto-sans-thai",
  fontSizePt: 18,
  lineSpacingPercent: 130,
  showAddress: false,
};

export function EnvelopeWorkspace({
  weddingId,
  guests,
  api,
}: {
  weddingId: string;
  guests: GuestSummary[];
  api: EnvelopeApi;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [template, setTemplate] =
    useState<EnvelopeTemplateInput>(defaultTemplate);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [saved, setSaved] = useState<EnvelopeTemplate[]>([]);
  const [data, setData] = useState<EnvelopePrintData | null>(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fontReady, setFontReady] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);
  const [fontsRetry, setFontsRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const cleanupPrint = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupPrint.current?.();
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    void api
      .listEnvelopeTemplates(weddingId)
      .then((items) => {
        if (alive) setSaved(items);
      })
      .catch((cause) => {
        if (alive) setError(readError(cause));
      });
    return () => {
      alive = false;
    };
  }, [api, weddingId]);

  useEffect(() => {
    let alive = true;
    setFontReady(false);
    setFontError(null);
    const fonts = document.fonts;
    if (!fonts) {
      setFontError(
        "Browser font readiness is unavailable; printing is disabled.",
      );
      return;
    }
    void fonts.ready
      .then(() => {
        if (alive) setFontReady(true);
      })
      .catch(() => {
        if (alive) setFontError("Fonts did not load. Retry before printing.");
      });
    return () => {
      alive = false;
    };
  }, [fontsRetry]);

  useEffect(() => {
    const generation = ++requestId.current;
    if (!selected.length) {
      setData(null);
      setLoading(false);
      return;
    }
    let checked: EnvelopeTemplateInput;
    try {
      checked = normalizeEnvelopeTemplateInput(template);
    } catch {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setData(null);
    const input: EnvelopePrintDataInput = templateId
      ? { guestIds: selected, templateId }
      : { guestIds: selected, template: checked };
    void api
      .getEnvelopePrintData(weddingId, input)
      .then((value) => {
        if (requestId.current === generation) {
          setData(value);
          setError(null);
        }
      })
      .catch((cause) => {
        if (requestId.current === generation) setError(readError(cause));
      })
      .finally(() => {
        if (requestId.current === generation) setLoading(false);
      });
  }, [api, weddingId, selected, template, templateId]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length >= 500
          ? current
          : [...current, id],
    );
  }
  function updateTemplate(next: EnvelopeTemplateInput) {
    setTemplate(next);
    setTemplateId(null);
  }
  async function save() {
    let checked: EnvelopeTemplateInput;
    try {
      checked = normalizeEnvelopeTemplateInput(template);
    } catch (cause) {
      setError(readError(cause));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const value = templateId
        ? await api.updateEnvelopeTemplate(weddingId, templateId, checked)
        : await api.createEnvelopeTemplate(weddingId, checked);
      setSaved((current) => [
        ...current.filter((item) => item.id !== value.id),
        value,
      ]);
      setTemplateId(value.id);
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function removeTemplate() {
    if (!templateId || !window.confirm("Delete this envelope template?"))
      return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteEnvelopeTemplate(weddingId, templateId);
      setSaved((current) => current.filter((item) => item.id !== templateId));
      setTemplateId(null);
    } catch (cause) {
      setError(readError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function printEnvelopes() {
    if (!data || !fontReady || busy || loading) return;
    setBusy(true);
    setError(null);
    let fontsLoaded = false;
    try {
      await document.fonts.ready;
      fontsLoaded = true;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.removeEventListener("afterprint", finish);
        window.clearTimeout(timeout);
        cleanupPrint.current = null;
        setPrinting(false);
        setBusy(false);
      };
      const timeout = window.setTimeout(finish, 120_000);
      window.addEventListener("afterprint", finish);
      cleanupPrint.current = () => {
        window.removeEventListener("afterprint", finish);
        window.clearTimeout(timeout);
      };
      flushSync(() => setPrinting(true));
      window.print();
    } catch {
      cleanupPrint.current?.();
      cleanupPrint.current = null;
      setPrinting(false);
      setBusy(false);
      if (fontsLoaded) {
        setError("Could not open the print dialog. Please retry.");
      } else {
        setFontReady(false);
        setFontError("Fonts did not load. Retry before printing.");
      }
    }
  }

  const available = guests.filter((guest) => !guest.archivedAt);
  const valid = (() => {
    try {
      normalizeEnvelopeTemplateInput(template);
      return true;
    } catch {
      return false;
    }
  })();
  return (
    <>
      {printing && data
        ? createPortal(
            <div className="envelope-print-portal">
              <EnvelopePages data={data} />
            </div>,
            document.body,
          )
        : null}
      <Card className="space-y-5 p-5 sm:p-6">
        <h3 className="font-serif text-2xl font-semibold">Print envelopes</h3>
        <p className="text-sm text-[#806d70]">
          Check your printer’s non-printable margins and test one physical
          envelope before the full run. One guest prints per page.
        </p>
        {error || fontError ? (
          <p role="alert" className="text-sm text-red-700">
            {error || fontError}{" "}
            {fontError ? (
              <Button
                variant="secondary"
                onClick={() => setFontsRetry((n) => n + 1)}
              >
                Retry fonts
              </Button>
            ) : null}
          </p>
        ) : null}
        <fieldset className="space-y-2">
          <legend className="font-semibold">
            Choose active guests · {selected.length}/500
          </legend>
          <Button
            variant="secondary"
            disabled={!available.length}
            onClick={() =>
              setSelected((current) =>
                [
                  ...new Set([
                    ...current,
                    ...available.map((guest) => guest.id),
                  ]),
                ].slice(0, 500),
              )
            }
          >
            Select loaded guests
          </Button>
          {available.map((guest) => (
            <label
              className="mr-4 inline-flex items-center gap-2"
              key={guest.id}
            >
              <input
                type="checkbox"
                aria-label={`Print ${guest.name}`}
                checked={selected.includes(guest.id)}
                disabled={
                  !selected.includes(guest.id) && selected.length >= 500
                }
                onChange={() => toggle(guest.id)}
              />
              {guest.name}
            </label>
          ))}
          {selected.length ? (
            <Button variant="ghost" onClick={() => setSelected([])}>
              Clear print selection
            </Button>
          ) : null}
        </fieldset>
        <fieldset className="space-y-3" disabled={busy}>
          <label className="grid gap-1 text-sm">
            Saved template
            <select
              className="rounded border p-2"
              disabled={busy}
              value={templateId ?? ""}
              onChange={(event) => {
                const value = saved.find(
                  (item) => item.id === event.target.value,
                );
                if (value) {
                  setTemplate(normalizeEnvelopeTemplateInput(value));
                  setTemplateId(value.id);
                } else setTemplateId(null);
              }}
            >
              <option value="">Unsaved layout</option>
              {saved.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <EnvelopeTemplateForm value={template} onChange={updateTemplate} />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={busy || !valid}
              onClick={() => void save()}
            >
              {templateId ? "Update template" : "Save template"}
            </Button>
            {templateId ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void removeTemplate()}
              >
                Delete template
              </Button>
            ) : null}
          </div>
        </fieldset>
        {loading ? <p role="status">Loading envelope preview…</p> : null}
        {data ? (
          <div className="space-y-3 overflow-x-auto">
            <p>{data.guests.length} envelopes ready.</p>
            <EnvelopePages data={data} />
          </div>
        ) : null}
        <Button
          className="envelope-print-controls"
          disabled={!data || !fontReady || busy || loading || !valid}
          onClick={() => void printEnvelopes()}
        >
          {busy ? "Preparing print…" : "Print envelopes"}
        </Button>
      </Card>
    </>
  );
}

function readError(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Envelope request failed.";
}
