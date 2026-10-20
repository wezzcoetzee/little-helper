import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cookies } from "../src/ui/Cookies";

const original = {
  name: "session",
  value: "value",
  domain: ".example.com",
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "lax",
  session: true,
  hostOnly: false,
  storeId: "incognito",
  partitionKey: { topLevelSite: "https://example.com" },
};
let root: Root;
let host: HTMLDivElement;
let api: ReturnType<typeof setupChrome>;
function setupChrome() {
  return {
    cookies: {
      getAllCookieStores: vi.fn(async () => [
        { id: "incognito", tabIds: [1, 2] },
      ]),
      getAll: vi.fn(async () => [original]),
      set: vi.fn(async () => original),
      remove: vi.fn(async () => ({})),
    },
  };
}
async function render(tabId = 1, url = "https://example.com/") {
  await act(async () =>
    root.render(
      createElement(Cookies, {
        tab: {
          id: tabId,
          url,
          index: 0,
          pinned: false,
          highlighted: false,
          windowId: 1,
          active: true,
          incognito: true,
          selected: true,
          discarded: false,
          autoDiscardable: true,
          groupId: -1,
          frozen: false,
          lastAccessed: 0,
        },
      }),
    ),
  );
}
async function click(button: Element) {
  await act(async () => Simulate.click(button));
}
async function editDomain(domain: string) {
  await click(host.querySelector(".cookie-row .grow")!);
  const label = Array.from(host.querySelectorAll("label")).find(
    (element) => element.textContent === "Domain",
  )!;
  const input = label.querySelector("input")!;
  await act(async () => {
    input.value = domain;
    Simulate.change(input);
  });
  await act(async () => Simulate.submit(host.querySelector("form")!));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api = setupChrome();
  vi.stubGlobal("chrome", api);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe("cookie editing identity", () => {
  it("preserves original store and partition when editing a cookie", async () => {
    await render();
    await editDomain(".example.com");
    expect(api.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: "incognito",
        partitionKey: original.partitionKey,
      }),
    );
    expect(api.cookies.remove).not.toHaveBeenCalled();
  });
  it("does not delete the saved cookie when Chrome canonicalizes the domain back to its original identity", async () => {
    await render();
    await editDomain(".EXAMPLE.COM");
    expect(api.cookies.set).toHaveBeenCalled();
    expect(api.cookies.remove).not.toHaveBeenCalled();
  });
  it("closes the old cookie editor when its target tab changes", async () => {
    await render();
    await click(host.querySelector(".cookie-row .grow")!);
    expect(host.querySelector("form")).not.toBeNull();
    await render(2, "https://other.example.com/");
    expect(host.querySelector("form")).toBeNull();
  });
});
