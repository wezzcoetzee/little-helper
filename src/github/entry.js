// @ts-check
import contentCss from "./content.css" with { type: "text" };
import { setupLightbox } from "./lightbox.js";
import { setupExpand } from "./expand.js";
import { setupReader } from "./reader.js";

async function start() {
  const { github_enabled } = await chrome.storage.local.get({
    github_enabled: true,
  });
  if (!github_enabled) return;

  const style = document.createElement("style");
  style.textContent = contentCss;
  document.head.append(style);

  const lightbox = setupLightbox();
  setupExpand(lightbox);
  const reader = setupReader();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    switch (message?.type) {
      case "github:status":
        sendResponse({
          images: lightbox.collectMedia().length,
          markdown: reader.hasMarkdown(),
        });
        break;
      case "github:gallery": {
        const first = lightbox.collectMedia()[0];
        if (first) lightbox.openLightbox(first);
        sendResponse({ opened: Boolean(first) });
        break;
      }
      case "github:read":
        sendResponse({ opened: reader.openVisible() });
        break;
    }
  });
}

void start();
