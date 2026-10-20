import { setupBrowser } from "../browser/background";
import { setupClipper } from "../clipper/background";
import { setupGithub } from "../github/background";
import { defaults } from "../settings";
setupBrowser();
setupClipper();
setupGithub();
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local
    .get(null)
    .then((values) =>
      chrome.storage.local.set(
        Object.fromEntries(
          Object.entries(defaults).filter(([key]) => !(key in values)),
        ),
      ),
    );
});
