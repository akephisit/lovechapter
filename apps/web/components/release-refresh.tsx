"use client";

import { useEffect } from "react";

const shaPattern = /^[0-9a-f]{40}$/u;

type RefreshOptions = {
  initialSha: string | null;
  fetcher: typeof fetch;
  reload(): void;
  visible(): boolean;
  documentTarget: EventTarget;
  windowTarget: EventTarget;
};

function parseStatus(value: unknown): {
  mode: "open" | "maintenance";
  publishedSha: string | null;
} {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("mode" in value) ||
    (value.mode !== "open" && value.mode !== "maintenance") ||
    !("publishedSha" in value) ||
    (value.publishedSha !== null &&
      (typeof value.publishedSha !== "string" ||
        !shaPattern.test(value.publishedSha))) ||
    (value.mode === "maintenance" && value.publishedSha !== null)
  ) {
    throw new Error("Release status is invalid");
  }
  return {
    mode: value.mode,
    publishedSha: value.publishedSha,
  };
}

/** Each loaded page remembers its own server-provided publication SHA. */
export function startReleaseRefresh(options: RefreshOptions) {
  let loadedSha = shaPattern.test(options.initialSha ?? "")
    ? options.initialSha
    : null;
  let disposed = false;
  let checking = false;
  let reloadIssued = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function retry() {
    if (disposed || reloadIssued || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void check();
    }, 5_000);
  }

  async function check(): Promise<void> {
    if (disposed || checking || reloadIssued || !options.visible()) return;
    checking = true;
    clearRetry();
    try {
      const response = await options.fetcher("/release-status", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Release status unavailable");
      const status = parseStatus(await response.json());
      if (status.mode === "maintenance") {
        retry();
      } else if (status.publishedSha) {
        if (loadedSha && loadedSha !== status.publishedSha) {
          reloadIssued = true;
          options.reload();
        } else if (!loadedSha) {
          loadedSha = status.publishedSha;
        }
      }
    } catch {
      retry();
    } finally {
      checking = false;
    }
  }

  const onReturn = () => {
    void check();
  };
  options.documentTarget.addEventListener("visibilitychange", onReturn);
  options.windowTarget.addEventListener("pageshow", onReturn);
  return {
    check,
    dispose() {
      disposed = true;
      clearRetry();
      options.documentTarget.removeEventListener("visibilitychange", onReturn);
      options.windowTarget.removeEventListener("pageshow", onReturn);
    },
  };
}

export function ReleaseRefresh({ initialSha }: { initialSha: string | null }) {
  useEffect(() => {
    const controller = startReleaseRefresh({
      initialSha,
      fetcher: fetch,
      reload: () => window.location.reload(),
      visible: () => document.visibilityState !== "hidden",
      documentTarget: document,
      windowTarget: window,
    });
    void controller.check();
    return () => controller.dispose();
  }, [initialSha]);
  return null;
}
