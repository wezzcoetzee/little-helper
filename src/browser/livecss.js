// ═══════════════════════════════════
//  superlevels: Live CSS Editor
//  Based on live-css-editor
// ═══════════════════════════════════
(() => {
  const STYLE_ID = "sl-livecss";

  function applyCSS(css) {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css || "";
  }

  // Load saved CSS for this host on page load
  const host = location.hostname;
  if (host) {
    chrome.storage.local.get(["livecss_" + host], (data) => {
      const css = data["livecss_" + host];
      if (css) applyCSS(css);
    });
  }

  // Listen for live updates from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "livecss_update") {
      applyCSS(msg.css);
    }
  });
})();
