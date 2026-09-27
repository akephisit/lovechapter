"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { UiLanguage } from "../lib/ui-language";
import { localizeStoredUiMessage } from "../lib/ui-copy";
import { useUiCopy, useUiLanguage } from "./ui-language-provider";

export function LanguageSwitcher() {
  const language = useUiLanguage();
  const copy = useUiCopy();
  const router = useRouter();
  const [selected, setSelected] = useState(language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSelected(language), [language]);

  async function change(next: UiLanguage) {
    if (next === language || busy) return;
    setSelected(next);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/ui-language", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: next }),
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error("Language preference was not saved");
      router.refresh();
    } catch {
      setSelected(language);
      setError(copy.errors.unexpected);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="ui-language">{copy.common.language}</label>
      <select
        id="ui-language"
        aria-label={copy.common.language}
        value={selected}
        disabled={busy}
        onChange={(event) =>
          void change(event.currentTarget.value as UiLanguage)
        }
        className="min-h-11 rounded-xl border border-[#d8c7bd] bg-white px-3 text-[#382a2d] focus-visible:ring-2 focus-visible:ring-[#7d4152]"
      >
        <option value="en">English</option>
        <option value="th">ไทย</option>
      </select>
      {error ? (
        <span role="alert">{localizeStoredUiMessage(error, copy)}</span>
      ) : null}
    </div>
  );
}
