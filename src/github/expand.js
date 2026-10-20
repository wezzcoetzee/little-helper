// @ts-check

/** @param {{ openLightbox: (source: HTMLImageElement | HTMLVideoElement) => void }} lightbox */
export function setupExpand({ openLightbox }) {
  // Diagrams aren't here: GitHub has its own dialog for them, which content.css makes fullscreen.
  const EXPANDABLE =
    ".markdown-body pre, .markdown-body table, .markdown-body video";

  const ICONS = {
    expand: "M4 10V4h6M20 10V4h-6M4 14v6h6M20 14v6h-6",
    close: "M6 6l12 12M18 6 6 18",
  };

  const BUTTON_SIZE = 28;

  /** @type {HTMLElement | undefined} */
  let hovered;
  /** @type {HTMLElement | undefined} */
  let expanded;
  /** @type {HTMLButtonElement | undefined} */
  let button;

  /**
   * One shared button, shown over whichever element is hovered. It's a popover so it
   * sits in the top layer, above GitHub's stacking contexts and above an expanded element.
   */
  function getButton() {
    if (button?.isConnected) return button;
    button = document.createElement("button");
    button.type = "button";
    button.className = "ghil-expand";
    button.popover = "manual";
    button.addEventListener("click", () => {
      if (expanded) return collapse();
      const target = hovered;
      hideButton();
      if (target instanceof HTMLVideoElement) openLightbox(target);
      else if (target) expand(target);
    });
    document.body.append(button);
    return button;
  }

  /** @param {keyof typeof ICONS} name */
  function setIcon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICONS[name]);
    svg.append(path);
    const btn = getButton();
    btn.replaceChildren(svg);
    btn.ariaLabel = name === "expand" ? "Expand" : "Close";
  }

  /** Code and tables only need expanding when they overflow; videos always benefit. */
  function isWorthExpanding(/** @type {HTMLElement} */ el) {
    if (!el.matches("pre, table")) return true;
    return el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
  }

  /** @param {HTMLElement} target */
  function showButton(target) {
    hovered = target;
    setIcon("expand");
    positionButton();
  }

  function positionButton() {
    if (!hovered) return;
    const btn = getButton();
    const rect = hovered.getBoundingClientRect();
    const top = rect.top + 8;
    // Leave room for GitHub's own copy button on code blocks.
    const left = rect.right - (hovered.matches("pre") ? 48 : 8) - BUTTON_SIZE;

    // Hide when that corner is scrolled off or under one of GitHub's sticky headers.
    const below = document
      .elementsFromPoint(left + BUTTON_SIZE / 2, top + 1)
      .find((el) => el !== btn && !btn.contains(el));
    if (!below || !hovered.contains(below)) return hideButton();

    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;
    if (!btn.matches(":popover-open")) btn.showPopover();
  }

  function hideButton() {
    hovered = undefined;
    if (button?.matches(":popover-open")) button.hidePopover();
  }

  /**
   * Expands in place via the popover top layer rather than cloning into a dialog, so
   * GitHub's scoped styles (syntax highlighting, table borders) keep matching.
   * @param {HTMLElement} el
   */
  function expand(el) {
    expanded = el;
    el.classList.add("ghil-expanded");
    el.popover = "manual";
    el.showPopover();

    const btn = getButton();
    setIcon("close");
    btn.style.top = "16px";
    btn.style.left = `${document.documentElement.clientWidth - 16 - BUTTON_SIZE}px`;
    // Re-show so the button stacks above the element that just entered the top layer.
    if (btn.matches(":popover-open")) btn.hidePopover();
    btn.showPopover();
  }

  function collapse() {
    if (!expanded) return;
    if (expanded.matches(":popover-open")) expanded.hidePopover();
    expanded.removeAttribute("popover");
    expanded.classList.remove("ghil-expanded");
    expanded = undefined;
    hideButton();
  }

  document.addEventListener("mouseover", (event) => {
    if (expanded?.isConnected) return;
    expanded = undefined;
    if (
      !(event.target instanceof Element) ||
      event.target.closest(".ghil-expand")
    )
      return;

    const target = event.target.closest(EXPANDABLE);
    if (target instanceof HTMLElement && isWorthExpanding(target)) {
      if (target !== hovered) showButton(target);
    } else {
      hideButton();
    }
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !expanded) return;
      event.preventDefault();
      collapse();
    },
    true,
  );

  addEventListener(
    "scroll",
    () => {
      if (!expanded) positionButton();
    },
    { capture: true, passive: true },
  );
}
