import { afterEach, expect, it, vi } from "vitest";
import { setupBrowser } from "./background";

function fixture(enabled: boolean) {
  const old = Date.now() - 600_000;
  const tabs = [
    { id: 1, windowId: 1, active: true, url: "https://active.test" },
    { id: 2, windowId: 1, pinned: true, url: "https://pinned.test" },
    { id: 3, windowId: 1, audible: true, url: "https://audible.test" },
    { id: 4, windowId: 1, url: "chrome://settings" },
    { id: 5, windowId: 1, url: "https://closed.test", title: "Closed" },
    { id: 6, windowId: 1, incognito: true, url: "https://private.test" },
    { id: 7, windowId: 2, url: "https://last.test" },
    { id: 8, windowId: 1, url: "https://docs.excluded.test" },
  ];
  const savedState = {
    activity: Object.fromEntries(tabs.map((tab) => [tab.id, old])),
    redirects: {
      5: { chain: [], finalUrl: "https://closed.test", finalStatus: 200 },
    },
  };
  let history: unknown[] = [];
  let onAlarm: (alarm: { name: string }) => void = () => {};
  let onMessage: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (response: unknown) => void,
  ) => boolean | undefined = () => undefined;
  const listener = () => ({ addListener: vi.fn() });
  const remove = vi.fn(async (id: number) => {
    const i = tabs.findIndex((tab) => tab.id === id);
    tabs.splice(i, 1);
  });
  const sessionSet = vi.fn(async () => {});
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: async () => ({ browser_state: savedState }),
        set: sessionSet,
      },
      local: {
        get: async (keys: unknown) =>
          keys === "closed_tabs"
            ? { closed_tabs: history }
            : { enabled, timeoutMin: 5, exclusions: ["excluded.test"] },
        set: async (data: { closed_tabs: unknown[] }) => {
          history = data.closed_tabs;
        },
      },
    },
    tabs: {
      query: async (filter: { windowId?: number }) =>
        tabs.filter(
          (tab) =>
            filter.windowId === undefined || tab.windowId === filter.windowId,
        ),
      get: async (id: number) => tabs.find((tab) => tab.id === id),
      remove,
      onActivated: listener(),
      onCreated: listener(),
      onUpdated: listener(),
      onRemoved: listener(),
    },
    alarms: {
      create: vi.fn(),
      onAlarm: {
        addListener: (callback: typeof onAlarm) => {
          onAlarm = callback;
        },
      },
    },
    webNavigation: { onBeforeNavigate: listener() },
    webRequest: { onBeforeRedirect: listener(), onCompleted: listener() },
    runtime: {
      id: "helper",
      getURL: (path: string) => `chrome-extension://helper/${path}`,
      onMessage: {
        addListener: (callback: typeof onMessage) => {
          onMessage = callback;
        },
      },
    },
  });
  setupBrowser();
  return {
    remove,
    sessionSet,
    history: () => history,
    alarm: () => onAlarm({ name: "tabCleanup" }),
    message: (
      sender: chrome.runtime.MessageSender,
      respond: (response: unknown) => void,
    ) => onMessage({ type: "getRedirects", tabId: 5 }, sender, respond),
  };
}

afterEach(() => vi.unstubAllGlobals());

it("keeps tab cleanup off unless explicitly enabled", async () => {
  const browser = fixture(false);
  browser.alarm();
  await vi.waitFor(() => expect(browser.sessionSet).toHaveBeenCalledTimes(2));
  expect(browser.remove).not.toHaveBeenCalled();
});

it("restores inactivity after worker restart, protects tabs, and keeps incognito out of history", async () => {
  const browser = fixture(true);
  browser.alarm();
  await vi.waitFor(() => expect(browser.sessionSet).toHaveBeenCalledTimes(2));
  expect(browser.remove.mock.calls.map(([id]) => id)).toEqual([5, 6]);
  expect(browser.history()).toEqual([
    expect.objectContaining({ url: "https://closed.test" }),
  ]);
});

it("serves persisted redirects only to its own extension pages", async () => {
  const browser = fixture(false);
  const respond = vi.fn();
  expect(
    browser.message({ id: "helper", url: "https://example.test" }, respond),
  ).toBeUndefined();
  expect(respond).not.toHaveBeenCalled();
  expect(
    browser.message(
      { id: "helper", url: "chrome-extension://helper/popup.html" },
      respond,
    ),
  ).toBe(true);
  await vi.waitFor(() =>
    expect(respond).toHaveBeenCalledWith({
      chain: [],
      finalUrl: "https://closed.test",
      finalStatus: 200,
    }),
  );
});
