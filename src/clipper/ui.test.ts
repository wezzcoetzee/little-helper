import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Clipper } from "../ui/Clipper";
import type { ClipperEvent } from "./types";
const tab = { id: 1, url: "https://example.com/" };
const captured = (text: string) => ({
  html: `<p>${text}</p>`,
  title: text,
  url: tab.url,
});
let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof setup>;
let messageListener: (
  event: ClipperEvent,
  sender: chrome.runtime.MessageSender,
) => void;
function setup() {
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  return {
    runtime: {
      id: "test",
      onMessage: {
        addListener: vi.fn((listener) => {
          messageListener = listener;
        }),
        removeListener: vi.fn(),
      },
    },
    tabs: {
      query: vi.fn(async () => [tab]),
      get: vi.fn(async () => tab),
      sendMessage: vi.fn(
        async (
          _tabId: number,
          _message: { type: string; requestId?: string },
        ) => ({ capture: captured("Fresh capture") }),
      ),
      onActivated: event(),
      onUpdated: event(),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({
          clipperOptions: {
            includeFrontMatter: false,
            includeLinks: true,
            includeImages: false,
          },
        })),
        set: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn<() => Promise<Record<string, unknown>>>(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api = setup();
  vi.stubGlobal("chrome", api);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function click(label: string) {
  await act(async () =>
    Simulate.click(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === label,
      )!,
    ),
  );
}
const markdown = () => container.querySelector("textarea")!.value;

describe("clipper request races", () => {
  it("does not restore an old saved capture over a new extraction", async () => {
    let resolveSaved!: (value: Record<string, unknown>) => void;
    api.storage.session.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSaved = resolve;
        }),
    );
    await act(async () => root.render(createElement(Clipper)));
    await click("Smart extract");
    expect(markdown()).toBe("Fresh capture");
    await act(async () =>
      resolveSaved({ "clipperCapture:1": captured("Old saved capture") }),
    );
    expect(markdown()).toBe("Fresh capture");
  });
  it("rejects an earlier picker result if a newer extraction starts during its active-tab check", async () => {
    await act(async () => root.render(createElement(Clipper)));
    await click("Pick element");
    const pickMessage = api.tabs.sendMessage.mock.calls[0];
    const request = pickMessage[1].requestId;
    if (!request) throw new Error("Picker request was not started");
    let resolveTab!: (value: (typeof tab)[]) => void;
    api.tabs.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTab = resolve;
        }),
    );
    act(() =>
      messageListener(
        {
          type: "CLIPPER_RESULT",
          tabId: 1,
          requestId: request,
          capture: captured("Stale picker"),
        },
        { id: "test" },
      ),
    );
    await click("Full page");
    expect(markdown()).toBe("Fresh capture");
    await act(async () => resolveTab([tab]));
    expect(markdown()).toBe("Fresh capture");
  });
});
