// @ts-check
import contentCss from "./content.css" with { type: "text" };
import { setupLightbox } from "./lightbox.js";
import { setupExpand } from "./expand.js";
import { setupReader } from "./reader.js";
import { setupBottlenecks } from "./bottlenecks.js";
import { setupMergePanel } from "./merge-panel.js";

async function start() {
  const on = await chrome.storage.local.get({
    github_lightbox: true,
    github_expand: true,
    github_reader: true,
    github_bottlenecks: true,
    github_merge_panel: true,
  });
  if (!Object.values(on).some(Boolean)) return;

  const style = document.createElement("style");
  style.textContent = contentCss;
  document.head.append(style);

  const lightbox = on.github_lightbox ? setupLightbox() : undefined;
  if (on.github_expand) setupExpand(lightbox);
  const reader = on.github_reader ? setupReader() : undefined;
  if (on.github_bottlenecks) setupBottlenecks();
  if (on.github_merge_panel) setupMergePanel();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    switch (message?.type) {
      case "github:status":
        sendResponse({
          images: lightbox?.collectMedia().length ?? 0,
          markdown: reader?.hasMarkdown() ?? false,
        });
        break;
      case "github:gallery": {
        const first = lightbox?.collectMedia()[0];
        if (first) lightbox?.openLightbox(first);
        sendResponse({ opened: Boolean(first) });
        break;
      }
      case "github:read":
        sendResponse({ opened: reader?.openVisible() ?? false });
        break;
    }
  });
}

void start();
