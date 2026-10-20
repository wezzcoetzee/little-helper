import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedGithubUrl, setupGithub } from "./background";

afterEach(() => vi.unstubAllGlobals());

describe("GitHub request boundary", () => {
  it("allows private GitHub assets and rejects lookalike or unsafe URLs", () => {
    expect(
      isAllowedGithubUrl(
        "https://private-user-images.githubusercontent.com/123/image.png?token=private",
      ),
    ).toBe(true);
    expect(
      isAllowedGithubUrl("https://github.com/owner/repo/raw/main/README.md"),
    ).toBe(true);
    for (const url of [
      "https://github.com.attacker.example/image.png",
      "https://attacker.example/github.com/image.png",
      "http://github.com/file.png",
      "https://attacker:password@github.com/file.png",
      "data:image/png;base64,anything",
    ])
      expect(isAllowedGithubUrl(url)).toBe(false);
  });

  it("requires an extension-owned GitHub content sender before fetching", () => {
    const addListener = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: { id: "little-helper", onMessage: { addListener } },
    });
    vi.stubGlobal("fetch", fetch);
    setupGithub();
    const listener = addListener.mock.calls[0][0] as Parameters<
      typeof chrome.runtime.onMessage.addListener
    >[0];
    const response = vi.fn();
    const message = {
      type: "github:text",
      url: "https://github.com/owner/repo/raw/main/private.md",
    };
    listener(
      message,
      {
        id: "other-extension",
        url: "https://github.com/owner/repo",
        tab: { id: 1 },
      } as chrome.runtime.MessageSender,
      response,
    );
    listener(
      message,
      {
        id: "little-helper",
        url: "https://attacker.example",
        tab: { id: 1 },
      } as chrome.runtime.MessageSender,
      response,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(response).toHaveBeenCalledWith({
      error: "Unsupported GitHub request",
    });
  });

  it("preserves authenticated private-file fetches with namespaced messages", async () => {
    const addListener = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => "# Private document" });
    vi.stubGlobal("chrome", {
      runtime: { id: "little-helper", onMessage: { addListener } },
    });
    vi.stubGlobal("fetch", fetch);
    setupGithub();
    const listener = addListener.mock.calls[0][0] as Parameters<
      typeof chrome.runtime.onMessage.addListener
    >[0];
    const response = vi.fn();
    const url = "https://github.com/owner/repo/raw/main/private.md";
    expect(
      listener(
        { type: "github:text", url },
        {
          id: "little-helper",
          url: "https://github.com/owner/repo",
          tab: { id: 1 },
        } as chrome.runtime.MessageSender,
        response,
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(response).toHaveBeenCalledWith({ text: "# Private document" }),
    );
    expect(fetch).toHaveBeenCalledWith(url, { credentials: "include" });
  });
});
