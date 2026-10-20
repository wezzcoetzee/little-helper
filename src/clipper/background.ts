import { copyInPage } from "./clipboard";
import { renderCapture } from "./lib/postprocess";
import { loadOptions, errorMessage, type Capture } from "./types";

async function publish(
  type: string,
  tabId: number,
  requestId: string,
  capture?: Capture,
  error?: string,
  sourceUrl?: string,
) {
  if (error)
    await chrome.storage.session.set({
      [`clipperError:${tabId}`]: { error, url: sourceUrl },
    });
  if (capture) await chrome.storage.session.remove(`clipperError:${tabId}`);
  if (capture)
    await chrome.storage.session.set({ [`clipperCapture:${tabId}`]: capture });
  await chrome.runtime
    .sendMessage({ type, tabId, requestId, capture, error })
    .catch(() => {});
}
async function quickCapture(tab: chrome.tabs.Tab, mode: string) {
  if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) return;
  const tabId = tab.id;
  const requestId = `quick:${crypto.randomUUID()}`;
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "CLIPPER_EXTRACT",
      mode,
    })) as { capture?: Capture; error?: string };
    if (!response.capture)
      throw new Error(
        response.error ||
          "Could not capture this page. Reload it and try again.",
      );
    if ((await chrome.tabs.get(tabId)).url !== response.capture.url) return;
    await publish("CLIPPER_RESULT", tabId, requestId, response.capture);
    const markdown = renderCapture(response.capture, await loadOptions());
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: copyInPage,
      args: [markdown],
    });
    if (!results[0]?.result)
      throw new Error(
        "Captured. Open little-helper’s Page clipper to copy the Markdown.",
      );
  } catch (error) {
    await publish(
      "CLIPPER_ERROR",
      tabId,
      requestId,
      undefined,
      errorMessage(error),
      tab.url,
    );
    await chrome.sidePanel.open({ tabId }).catch(() => {});
  }
}
export function setupClipper(): void {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "little-helper-clip",
      title: "Copy page as Markdown",
      contexts: ["page"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
    chrome.contextMenus.create({
      id: "little-helper-clip-selection",
      title: "Copy selection as Markdown",
      contexts: ["selection"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab) return;
    if (info.menuItemId === "little-helper-clip")
      void quickCapture(tab, "smart");
    if (info.menuItemId === "little-helper-clip-selection")
      void quickCapture(tab, "selection");
  });
  chrome.commands.onCommand.addListener((command) => {
    if (command === "smart-extract")
      void chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => tab && quickCapture(tab, "smart"));
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.frameId !== 0 ||
      typeof message?.requestId !== "string" ||
      !message.requestId ||
      message.requestId.length > 100
    )
      return;
    if (
      !sender.tab?.id ||
      !message ||
      !["CLIPPER_SELECTED", "CLIPPER_PICK_CANCELLED"].includes(message.type)
    )
      return;
    if (
      message.type === "CLIPPER_SELECTED" &&
      (!message.capture ||
        typeof message.capture.html !== "string" ||
        typeof message.capture.title !== "string" ||
        message.capture.url !== sender.tab.url)
    )
      return;
    void publish(
      message.type === "CLIPPER_SELECTED"
        ? "CLIPPER_RESULT"
        : "CLIPPER_CANCELLED",
      sender.tab.id,
      message.requestId,
      message.capture,
    );
  });
}
