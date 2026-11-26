// @ts-check

/** Only the PR overview: the panel would squeeze the diff on other tabs. */
const OVERVIEW = /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/;
const RETRY_MS = 1000;
const MAX_ATTEMPTS = 3;

/**
 * Opens GitHub's merge status side panel once per PR by clicking its header toggle,
 * which is what sets `?panel=mergeStatus`. Writing the query ourselves doesn't reach
 * GitHub's React state. Closing the panel keeps it closed until another PR is opened.
 */
export function setupMergePanel() {
  /** The PR we already opened, or gave up on. */
  let handled = "";
  let target = "";
  let attempts = 0;
  let lastClick = 0;

  function sync() {
    const pull = location.pathname.replace(/\/$/, "");
    if (!OVERVIEW.test(location.pathname) || pull === handled) return;
    if (pull !== target) {
      target = pull;
      attempts = 0;
      lastClick = 0;
    }
    if (new URLSearchParams(location.search).has("panel")) {
      handled = pull;
      return;
    }
    // The click may land before React hydrates; retry a little, but never so fast that
    // a second click closes a panel that was still opening.
    if (Date.now() - lastClick < RETRY_MS) return;
    if (attempts >= MAX_ATTEMPTS) {
      handled = pull;
      return;
    }
    const toggle = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Merge status",
    );
    if (!toggle) return;
    attempts += 1;
    lastClick = Date.now();
    toggle.click();
  }

  // GitHub navigates between PRs without reloading.
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (location.pathname.replace(/\/$/, "") !== handled) sync();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  // Retries also need to fire when the page has gone quiet.
  setInterval(sync, RETRY_MS);
  sync();
}
