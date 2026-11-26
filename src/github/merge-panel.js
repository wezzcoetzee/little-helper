// @ts-check

/** Only the PR overview: the panel would squeeze the diff on other tabs. */
const OVERVIEW = /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/;
const TELEMETRY = "pull_requests.merge.view_status";
const RETRY_MS = 1000;
const MAX_ATTEMPTS = 3;

/**
 * GitHub's header toggle. Its text includes a visually hidden suffix
 * ("Merge statusStatus"), so the text fallback matches a prefix.
 */
function findToggle() {
  const buttons = [...document.querySelectorAll("button")];
  return (
    buttons.find((button) => button.dataset.telemetryAction === TELEMETRY) ??
    buttons.find((button) =>
      button.textContent?.trim().startsWith("Merge status"),
    )
  );
}

/**
 * Opens GitHub's merge status side panel once per PR by clicking its header toggle.
 * Writing `?panel=mergeStatus` ourselves doesn't reach GitHub's React state.
 * Closing the panel keeps it closed until another PR is opened.
 * @returns {() => void} Stops watching the page.
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
    const toggle = findToggle();
    if (!toggle) return;
    if (
      toggle.getAttribute("aria-expanded") === "true" ||
      new URLSearchParams(location.search).has("panel")
    ) {
      handled = pull;
      return;
    }
    // A click before React hydrates does nothing; only retry while the toggle still
    // reports closed, so a retry can never close a panel that opened.
    if (Date.now() - lastClick < RETRY_MS) return;
    if (attempts >= MAX_ATTEMPTS) {
      handled = pull;
      return;
    }
    attempts += 1;
    lastClick = Date.now();
    toggle.click();
  }

  // GitHub navigates between PRs without reloading.
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sync();
    });
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  // Retries also need to fire when the page has gone quiet.
  const interval = setInterval(sync, RETRY_MS);
  sync();

  return () => {
    observer.disconnect();
    clearInterval(interval);
  };
}
