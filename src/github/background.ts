const CONTENT_HOSTS = new Set(["github.com", "gist.github.com"]);
const RESOURCE_HOSTS = new Set([
  ...CONTENT_HOSTS,
  "raw.githubusercontent.com",
  "camo.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "user-images.githubusercontent.com",
  "objects.githubusercontent.com",
]);

export function isAllowedGithubUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      RESOURCE_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

function trustedSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || !sender.tab || !sender.url)
    return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === "https:" && CONTENT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function fetchGithub(url: string): Promise<Response> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function toPngBase64(url: string): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetchGithub(url)).blob());
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion unavailable");
    context.drawImage(bitmap, 0, 0);
    const png = new Uint8Array(
      await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
    );
    let binary = "";
    for (let i = 0; i < png.length; i += 0x8000) {
      binary += String.fromCharCode(...png.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  } finally {
    bitmap.close();
  }
}

export function setupGithub(): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      if (!message || typeof message !== "object" || !("type" in message))
        return;
      if (
        !["github:png", "github:text", "github:download"].includes(
          String(message.type),
        )
      )
        return;
      if (
        !trustedSender(sender) ||
        !("url" in message) ||
        !isAllowedGithubUrl(message.url)
      ) {
        sendResponse({ error: "Unsupported GitHub request" });
        return false;
      }
      const url = message.url;
      switch (message.type) {
        case "github:png":
          toPngBase64(url).then(
            (base64) => sendResponse({ base64 }),
            () => sendResponse({ error: "Image conversion failed" }),
          );
          return true;
        case "github:text":
          fetchGithub(url)
            .then((response) => response.text())
            .then(
              (text) => sendResponse({ text }),
              (error: unknown) =>
                sendResponse({
                  error:
                    error instanceof Error ? error.message : "Fetch failed",
                }),
            );
          return true;
        case "github:download":
          chrome.downloads.download({ url }).then(
            (downloadId) => sendResponse({ downloadId }),
            () => sendResponse({ error: "Download failed" }),
          );
          return true;
      }
    },
  );
}
