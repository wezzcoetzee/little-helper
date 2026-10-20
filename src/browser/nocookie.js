// ═══════════════════════════════════
//  superlevels: Cookie Consent Auto-Dismisser
//  Based on I-Still-Dont-Care-About-Cookies
// ═══════════════════════════════════
(() => {
  const STYLE_ID = "sl-nocookie";

  const HIDE_CSS = `
    #cookie-banner, #cookie-notice, #cookie-consent, #cookie-popup,
    #cookiebanner, #cookienotice, #cookieconsent, #cookiepopup,
    #cookie_banner, #cookie_notice, #cookie_consent, #cookie_popup,
    .cookie-banner, .cookie-notice, .cookie-consent, .cookie-popup,
    .cookiebanner, .cookienotice, .cookieconsent, .cookiepopup,
    .cookie_banner, .cookie_notice, .cookie_consent, .cookie_popup,
    #gdpr-banner, #gdpr-consent, .gdpr-banner, .gdpr-consent,
    #cc-window, .cc-window, .cc-banner, .cc-overlay, .cc-revoke,
    #onetrust-banner-sdk, #onetrust-consent-sdk, .onetrust-pc-dark-filter,
    .ot-sdk-row, #ot-sdk-btn-floating,
    .cky-consent-container, #cky-consent,
    .didomi-popup, #didomi-host, #didomi-notice,
    .sp-message-open, #sp_message_container_0,
    [class*="cookie-banner"], [class*="cookie-consent"],
    [id*="cookie-banner"], [id*="cookie-consent"],
    [class*="CookieBanner"], [class*="CookieConsent"],
    .fc-consent-root, .fc-dialog-overlay, .fc-dialog,
    .qc-cmp-showing, #qcCmpUi, .qc-cmp2-container,
    .truste_box_overlay, #truste-consent-track,
    .osano-cm-dialog, .osano-cm-window,
    [aria-label="Cookie banner"], [aria-label="cookie consent"],
    .evidon-banner, #_evidon_banner,
    .iubenda-cs-container, #iubenda-cs-banner,
    .klaro, .cookie-modal-wrapper,
    #usercentrics-root, [id^="usercentrics"],
    .cmpboxBG, .cmpbox, #cmpbox, #cmpbox2,
    .js-cookie-consent, .cookie-law-info-bar,
    #cookie-law-info-bar, .cli-modal,
    .eupopup, #eu-cookie-bar, .eu-cookie-compliance-banner,
    #catapult-cookie-bar, .ct-ultimate-gdpr-cookie-popup,
    .cookiealert, #cookiealert, .cookie-alert,
    .consent-banner, #consent-banner, .consent-popup,
    .privacy-notice, #privacy-notice, .privacy-banner,
    .cc-floating, .cc-bottom, .cc-top,
    [data-testid="cookie-banner"], [data-testid="cookie-consent"],
    .snigel-cmp-framework, #snigel-cmp-framework,
    .adroll_consent_banner, #adroll_consent_container,
    .termly-consent-banner, #termly-code-snippet-support,
    .CybotCookiebotDialog, #CybotCookiebotDialog,
    #CybotCookiebotDialogBodyUnderlay,
    .cmplz-cookiebanner, #cmplz-cookiebanner-container {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      max-height: 0 !important;
      overflow: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
      z-index: -99999 !important;
    }
    body.cookie-consent-open,
    body.modal-open-cookie,
    body.no-scroll,
    body.sp-message-open,
    body.cmplz-blocked-content-container,
    html.sp-message-open,
    html.cookie-consent-open,
    body.ot-overflow-hidden,
    html.ot-overflow-hidden {
      overflow: auto !important;
      position: static !important;
    }
    .cc-grower { max-height: 0 !important; }
  `;

  const CLICK_SELECTORS = [
    "#onetrust-reject-all-handler",
    "#CybotCookiebotDialogBodyButtonDecline",
    ".cky-btn-reject",
    ".didomi-continue-without-agreeing",
    "[data-cookiefirst-action='reject']",
    ".iubenda-cs-reject-btn",
    ".osano-cm-denyAll",
    ".cmplz-btn.cmplz-deny",
    ".cc-deny",
    'button[title="Reject all" i]',
    'button[aria-label="Reject all cookies" i]',
  ];
  const rejected = new WeakSet();
  let enabled = false;
  let observer;
  let pending;

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = HIDE_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function tryClick() {
    for (const sel of CLICK_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (enabled && el && !el.disabled && !rejected.has(el)) {
          rejected.add(el);
          el.click();
          return true;
        }
      } catch {}
    }
    return false;
  }

  function removeCSS() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  function activate() {
    enabled = true;
    tryClick();
    injectCSS();
    if (observer) return;
    observer = new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        if (enabled) tryClick();
      }, 250);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function deactivate() {
    enabled = false;
    observer?.disconnect();
    observer = null;
    clearTimeout(pending);
    pending = null;
    removeCSS();
  }

  // Check storage and apply
  chrome.storage.local.get(["nocookie_enabled"], (data) => {
    if (data.nocookie_enabled !== false) activate();
  });

  // Listen for toggle from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "nocookie_toggle") {
      if (msg.enabled) activate();
      else deactivate();
    }
  });
})();
