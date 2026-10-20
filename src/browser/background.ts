import { cleanupTimeout, excludedHost, webUrl } from "./cleanup";

type RedirectTrace = {
  chain: {
    url: string;
    statusCode: number;
    statusLine: string;
    redirectUrl: string;
  }[];
  finalUrl: string | null;
  finalStatus: number | null;
};
type BrowserState = {
  activity: Record<string, number>;
  redirects: Record<string, RedirectTrace>;
};
const SESSION_KEY = "browser_state";
const emptyTrace = (): RedirectTrace => ({
  chain: [],
  finalUrl: null,
  finalStatus: null,
});

export function setupBrowser(): void {
  let state: BrowserState = { activity: {}, redirects: {} };
  const recentActivity = new Map<number, number>();
  let queue = chrome.storage.session.get(SESSION_KEY).then(async (data) => {
    if (data[SESSION_KEY]) state = data[SESSION_KEY] as BrowserState;
    const tabs = await chrome.tabs.query({});
    const ids = new Set(tabs.map((tab) => String(tab.id)));
    for (const id of Object.keys(state.activity))
      if (!ids.has(id)) delete state.activity[id];
    for (const id of Object.keys(state.redirects))
      if (!ids.has(id)) delete state.redirects[id];
    for (const tab of tabs) {
      if (tab.id !== undefined && !state.activity[tab.id])
        state.activity[tab.id] = Date.now();
    }
    await chrome.storage.session.set({ [SESSION_KEY]: state });
  });

  // One queue owns state and history so event bursts cannot overwrite newer writes.
  function enqueue(task: () => void | Promise<void>): Promise<void> {
    queue = queue
      .catch((error: unknown) => console.warn("Browser state:", error))
      .then(async () => {
        await task();
        await chrome.storage.session.set({ [SESSION_KEY]: state });
      });
    void queue.catch((error: unknown) => console.warn("Browser task:", error));
    return queue;
  }
  const markActive = (tabId: number) => {
    const time = Date.now();
    recentActivity.set(tabId, time);
    void enqueue(() => {
      state.activity[tabId] = time;
      recentActivity.delete(tabId);
    });
  };

  chrome.tabs.onActivated.addListener(({ tabId }) => markActive(tabId));
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id !== undefined) markActive(tab.id);
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === "complete" || change.url || change.audible)
      markActive(tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void enqueue(() => {
      delete state.activity[tabId];
      delete state.redirects[tabId];
    });
  });

  void chrome.alarms.create("tabCleanup", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== "tabCleanup") return;
    void enqueue(async () => {
      const settings = await chrome.storage.local.get([
        "enabled",
        "timeoutMin",
        "exclusions",
      ]);
      if (settings.enabled !== true) return;
      const tabs = await chrome.tabs.query({});
      const counts = new Map<number, number>();
      for (const tab of tabs)
        counts.set(tab.windowId, (counts.get(tab.windowId) ?? 0) + 1);
      const now = Date.now();
      for (const tab of tabs) {
        if (tab.id === undefined) continue;
        if (tab.active || tab.audible) {
          state.activity[tab.id] = now;
          continue;
        }
        const url = webUrl(tab.url);
        if (
          !url ||
          tab.pinned ||
          (counts.get(tab.windowId) ?? 0) <= 1 ||
          excludedHost(url.hostname, settings.exclusions)
        )
          continue;
        const lastActive = Math.max(
          state.activity[tab.id] ?? 0,
          recentActivity.get(tab.id) ?? 0,
        );
        if (!lastActive) {
          state.activity[tab.id] = now;
          continue;
        }
        if (now - lastActive < cleanupTimeout(settings.timeoutMin) * 60_000)
          continue;
        try {
          // Recheck protection immediately before removal: a user may switch tabs during storage reads.
          const current = await chrome.tabs.get(tab.id);
          if (
            current.active ||
            current.pinned ||
            current.audible ||
            current.url !== tab.url
          )
            continue;
          if (
            Date.now() - (recentActivity.get(tab.id) ?? lastActive) <
            cleanupTimeout(settings.timeoutMin) * 60_000
          )
            continue;
          if (
            (await chrome.tabs.query({ windowId: current.windowId })).length <=
            1
          )
            continue;
          await chrome.tabs.remove(tab.id);
          counts.set(tab.windowId, (counts.get(tab.windowId) ?? 1) - 1);
          delete state.activity[tab.id];
          if (!tab.incognito) {
            const stored = await chrome.storage.local.get("closed_tabs");
            const history = Array.isArray(stored.closed_tabs)
              ? stored.closed_tabs
              : [];
            await chrome.storage.local.set({
              closed_tabs: [
                {
                  url: tab.url,
                  title: tab.title || tab.url,
                  favIconUrl: tab.favIconUrl || "",
                  time: Date.now(),
                },
                ...history,
              ].slice(0, 50),
            });
          }
        } catch (error) {
          console.warn("Tab cleanup:", error);
        }
      }
    });
  });

  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0)
      void enqueue(() => {
        state.redirects[details.tabId] = emptyTrace();
      });
  });
  chrome.webRequest.onBeforeRedirect.addListener(
    (details) => {
      if (details.type !== "main_frame" || details.tabId < 0) return;
      void enqueue(() => {
        const trace = (state.redirects[details.tabId] ??= emptyTrace());
        trace.chain.push({
          url: details.url,
          statusCode: details.statusCode,
          statusLine: details.statusLine || "",
          redirectUrl: details.redirectUrl,
        });
        if (trace.chain.length > 100) trace.chain.shift();
      });
    },
    { urls: ["http://*/*", "https://*/*"] },
  );
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (details.type !== "main_frame" || details.tabId < 0) return;
      void enqueue(() => {
        const trace = (state.redirects[details.tabId] ??= emptyTrace());
        trace.finalUrl = details.url;
        trace.finalStatus = details.statusCode;
      });
    },
    { urls: ["http://*/*", "https://*/*"] },
  );

  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith(chrome.runtime.getURL(""))
    )
      return;
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message) ||
      !("tabId" in message)
    )
      return;
    const { type, tabId } = message;
    if (!Number.isInteger(tabId) || typeof tabId !== "number" || tabId < 0)
      return;
    if (type === "getRedirects") {
      void queue
        .then(() => respond(state.redirects[tabId] ?? emptyTrace()))
        .catch(() => respond(emptyTrace()));
      return true;
    }
    if (type === "pip") {
      void chrome.scripting
        .executeScript({
          target: { tabId },
          func: async () => {
            try {
              if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                return { action: "exited" };
              }
              const videos = Array.from(
                document.querySelectorAll("video"),
              ).filter(
                (video) =>
                  video.readyState > 0 && !video.disablePictureInPicture,
              );
              const playing = videos.filter(
                (video) => !video.paused && !video.ended,
              );
              const video = (playing.length ? playing : videos).sort(
                (a, b) =>
                  b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight,
              )[0];
              if (!video)
                return { error: "No playable video found on this page" };
              await video.requestPictureInPicture();
              return { action: "entered" };
            } catch (error) {
              return {
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
        })
        .then((results) =>
          respond(results[0]?.result ?? { error: "No result" }),
        )
        .catch((error: unknown) =>
          respond({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return true;
    }
  });
}
