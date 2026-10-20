// ═══════════════════════════════════
//  superlevels: X Unhook
//  Hides distractions on x.com / twitter.com
// ═══════════════════════════════════
(() => {
  const STYLE_ID = "sl-xunhook";

  const XUNHOOK_CSS = `
    /* Right sidebar — keep the search bar at top, hide all panels below
       (Live on X, Today's News, What's happening, Who to follow, Premium upsell, etc.).
       The first child of SidebarContents is the search; everything after is a panel. */
    div[data-testid="sidebarColumn"] > div > div > div > div > div > div:not(:first-of-type) {
      display: none !important;
    }
    /* Explore link in left nav */
    header[role="banner"] nav a[href="/explore"] {
      display: none !important;
    }
    /* Explore link inside the More overflow dialog */
    div[aria-labelledby="modal-header"] a[href="/explore"] {
      display: none !important;
    }
  `;

  function inject() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = XUNHOOK_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function remove() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  chrome.storage.local.get(["xunhook_enabled"], (data) => {
    if (data.xunhook_enabled !== false) inject();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "xunhook_toggle") {
      if (msg.enabled) inject();
      else remove();
    }
  });
})();
