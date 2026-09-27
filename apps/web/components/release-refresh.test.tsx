// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReleaseRefresh, startReleaseRefresh } from "./release-refresh";

const oldSha = "a".repeat(40);
const newSha = "b".repeat(40);

function response(mode: "open" | "maintenance", publishedSha: string | null) {
  return Response.json({ mode, publishedSha });
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("returning-tab release refresh", () => {
  it("reloads once after a visible tab observes a newer open release", async () => {
    const reload = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => response("open", newSha));
    const controller = startReleaseRefresh({
      initialSha: oldSha,
      fetcher,
      reload,
      visible: () => true,
      documentTarget: document,
      windowTarget: window,
    });
    await controller.check();
    window.dispatchEvent(new Event("pageshow"));
    await flush();
    expect(reload).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "/release-status",
      expect.objectContaining({ cache: "no-store" }),
    );
    controller.dispose();
  });

  it("waits through maintenance and reloads after the site reopens", async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("maintenance", null))
      .mockResolvedValueOnce(response("open", newSha));
    const controller = startReleaseRefresh({
      initialSha: oldSha,
      fetcher,
      reload,
      visible: () => true,
      documentTarget: document,
      windowTarget: window,
    });
    await controller.check();
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reload).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("does not reload for unchanged, unavailable, or initially unknown versions", async () => {
    const reload = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("open", oldSha))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response("open", oldSha))
      .mockResolvedValueOnce(response("open", newSha));
    const controller = startReleaseRefresh({
      initialSha: null,
      fetcher,
      reload,
      visible: () => true,
      documentTarget: document,
      windowTarget: window,
    });
    await controller.check();
    await controller.check();
    await controller.check();
    expect(reload).not.toHaveBeenCalled();
    await controller.check();
    expect(reload).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("checks when a hidden tab becomes visible", async () => {
    let visible = false;
    const reload = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => response("open", newSha));
    const controller = startReleaseRefresh({
      initialSha: oldSha,
      fetcher,
      reload,
      visible: () => visible,
      documentTarget: document,
      windowTarget: window,
    });
    await controller.check();
    expect(fetcher).not.toHaveBeenCalled();
    visible = true;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await flush();
    });
    expect(reload).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("mounts one inert client component without visible UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response("open", oldSha)),
    );
    const page = render(<ReleaseRefresh initialSha={oldSha} />);
    expect(page.container).toBeEmptyDOMElement();
  });
});
