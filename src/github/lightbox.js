// @ts-check

export function setupLightbox() {
  /** @typedef {HTMLImageElement | HTMLVideoElement} Media */

  const IMAGE_HOSTS = new Set([
    "camo.githubusercontent.com",
    "private-user-images.githubusercontent.com",
    "user-images.githubusercontent.com",
    "raw.githubusercontent.com",
  ]);

  const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

  /**
   * GitHub wraps markdown images in a link to the image itself. Only those links
   * are intercepted, so badges and images that link elsewhere keep working.
   * @param {HTMLAnchorElement} link
   * @param {HTMLImageElement} img
   */
  function linksToImage(link, img) {
    if (link.href === img.src) return true;
    const { hostname, pathname } = new URL(link.href);
    return (
      IMAGE_HOSTS.has(hostname) ||
      pathname.startsWith("/user-attachments/assets/") ||
      IMAGE_EXTENSION.test(pathname)
    );
  }

  /**
   * @param {Element} el
   * @returns {el is HTMLImageElement}
   */
  function isLightboxImage(el) {
    if (!(el instanceof HTMLImageElement)) return false;
    const link = el.closest(".markdown-body a[href]");
    return link instanceof HTMLAnchorElement && linksToImage(link, el);
  }

  /** @param {Media} el */
  function mediaSrc(el) {
    return el.currentSrc || el.src;
  }

  /** Visible images and videos on the page in document order, deduped by source. */
  function collectMedia() {
    /** @type {Map<string, Media>} */
    const bySrc = new Map();
    for (const el of document.querySelectorAll(
      ".markdown-body img, .markdown-body video",
    )) {
      if (!(el instanceof HTMLVideoElement || isLightboxImage(el))) continue;
      if (!el.getClientRects().length) continue;
      const src = mediaSrc(el);
      if (!bySrc.has(src)) bySrc.set(src, el);
    }
    return [...bySrc.values()];
  }

  const state = {
    /** @type {Media[]} */
    items: [],
    index: 0,
    fitScale: 1,
    view: { scale: 1, x: 0, y: 0 },
    dragging: false,
    dragMoved: false,
    comparing: false,
    /** @type {number | undefined} */
    flashTimer: undefined,
  };

  /** @type {ReturnType<typeof createLightbox> | undefined} */
  let lightbox;

  function getLightbox() {
    // Turbo navigation can swap out <body>, taking the dialog with it.
    if (!lightbox?.dialog.isConnected) lightbox = createLightbox();
    return lightbox;
  }

  function createLightbox() {
    const dialog = document.createElement("dialog");
    dialog.className = "ghil-lightbox";
    // Focusable so key presses land on it; with no focusable children it otherwise stays on <body>.
    dialog.tabIndex = -1;
    const img = document.createElement("img");
    img.draggable = false;
    const video = document.createElement("video");
    video.controls = true;
    const status = document.createElement("div");
    status.className = "ghil-status";

    // Split view: "after" is stacked on "before" and clipped from the left at the divider.
    const compare = document.createElement("div");
    compare.className = "ghil-compare";
    compare.hidden = true;
    const before = document.createElement("img");
    const after = document.createElement("img");
    const divider = document.createElement("div");
    divider.className = "ghil-divider";
    compare.append(before, after, divider);

    dialog.append(img, video, compare, status);

    before.addEventListener("load", layoutCompare);
    compare.addEventListener("pointerdown", (event) => {
      compare.setPointerCapture(event.pointerId);
      splitAt(event.clientX);
    });
    compare.addEventListener("pointermove", (event) => {
      if (compare.hasPointerCapture(event.pointerId)) splitAt(event.clientX);
    });

    img.addEventListener("load", () => {
      fit();
      img.style.visibility = "visible";
    });
    img.addEventListener("dblclick", fit);
    img.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      state.dragging = true;
      state.dragMoved = false;
      img.setPointerCapture(event.pointerId);
      img.classList.add("ghil-dragging");
    });
    img.addEventListener("pointermove", (event) => {
      if (!state.dragging) return;
      if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0)
        state.dragMoved = true;
      const { scale, x, y } = state.view;
      setView(scale, x + event.movementX, y + event.movementY);
    });
    const endDrag = () => {
      state.dragging = false;
      img.classList.remove("ghil-dragging");
    };
    img.addEventListener("pointerup", endDrag);
    img.addEventListener("pointercancel", endDrag);

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog && !state.dragMoved) dialog.close();
      state.dragMoved = false;
    });
    dialog.addEventListener(
      "wheel",
      (event) => {
        if (img.hidden) return;
        event.preventDefault();
        // Pinch arrives as ctrl+wheel (as does ctrl+mouse wheel); plain scroll pans.
        if (event.ctrlKey) {
          zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.01));
        } else {
          const { scale, x, y } = state.view;
          setView(scale, x - event.deltaX, y - event.deltaY);
        }
      },
      { passive: false },
    );
    dialog.addEventListener("keydown", (event) => {
      if (event.altKey) return;
      const action = KEY_ACTIONS[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    });
    dialog.addEventListener("close", () => {
      video.pause();
      for (const media of [img, video, before, after])
        media.removeAttribute("src");
      state.items = [];
    });

    document.body.append(dialog);
    return { dialog, img, video, status, compare, before, after, divider };
  }

  /** @type {Record<string, () => void>} */
  const KEY_ACTIONS = {
    ArrowLeft: () => show(state.index - 1),
    ArrowRight: () => show(state.index + 1),
    c: copyCurrent,
    d: () =>
      chrome.runtime.sendMessage({
        type: "github:download",
        url: currentSrc(),
      }),
    o: () => window.open(currentSrc(), "_blank", "noopener"),
    s: toggleCompare,
  };

  function currentSrc() {
    return mediaSrc(state.items[state.index]);
  }

  /** @param {number} index */
  function show(index) {
    const { img, video, compare } = getLightbox();
    state.index = (index + state.items.length) % state.items.length;
    const source = state.items[state.index];

    state.comparing = false;
    compare.hidden = true;
    video.pause();
    img.hidden = source instanceof HTMLVideoElement;
    video.hidden = !img.hidden;

    if (source instanceof HTMLVideoElement) {
      img.removeAttribute("src");
      video.src = mediaSrc(source);
      video.currentTime = source.currentTime;
      source.pause();
      video.play().catch(() => {});
    } else {
      video.removeAttribute("src");
      // Hidden until load so it never flashes at the previous image's zoom.
      img.style.visibility = "hidden";
      img.alt = source.alt;
      img.src = mediaSrc(source);
    }
    renderStatus();
  }

  function renderStatus() {
    const counter =
      state.items.length > 1
        ? `${state.index + 1} / ${state.items.length}`
        : "";
    const hint = comparePair()
      ? state.comparing
        ? "s single"
        : "s compare"
      : "";
    getLightbox().status.textContent = [counter, hint]
      .filter(Boolean)
      .join("  ·  ");
  }

  /** @param {string} message */
  function flash(message) {
    getLightbox().status.textContent = message;
    clearTimeout(state.flashTimer);
    state.flashTimer = setTimeout(renderStatus, 1500);
  }

  /**
   * Scale that fits a size within 95% of the viewport, never enlarging it.
   * @param {number} width
   * @param {number} height
   */
  function fitScale(width, height) {
    return Math.min(
      1,
      (innerWidth * 0.95) / width,
      (innerHeight * 0.95) / height,
    );
  }

  function fit() {
    const { img } = getLightbox();
    // SVGs without intrinsic dimensions report 0, so fall back to the viewport.
    const width = img.naturalWidth || innerWidth;
    const height = img.naturalHeight || innerHeight;
    img.style.width = `${width}px`;
    state.fitScale = fitScale(width, height);
    setView(
      state.fitScale,
      (innerWidth - width * state.fitScale) / 2,
      (innerHeight - height * state.fitScale) / 2,
    );
  }

  /**
   * @param {number} scale
   * @param {number} x
   * @param {number} y
   */
  function setView(scale, x, y) {
    state.view = { scale, x, y };
    getLightbox().img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  /**
   * Zooms while keeping the point under the cursor fixed.
   * @param {number} cx
   * @param {number} cy
   * @param {number} factor
   */
  function zoomAt(cx, cy, factor) {
    const { scale, x, y } = state.view;
    const min = state.fitScale / 4;
    const max = Math.max(state.fitScale, 1) * 8;
    const next = Math.min(max, Math.max(min, scale * factor));
    const ratio = next / scale;
    setView(next, cx - (cx - x) * ratio, cy - (cy - y) * ratio);
  }

  /**
   * Before/after screenshots in PR descriptions are usually two images in one table row.
   * @returns {[HTMLImageElement, HTMLImageElement] | undefined}
   */
  function comparePair() {
    const source = state.items[state.index];
    const row = source?.closest("tr");
    if (!row) return;
    const images = [...row.querySelectorAll("img")].filter(isLightboxImage);
    return images.length === 2 ? [images[0], images[1]] : undefined;
  }

  function toggleCompare() {
    const pair = comparePair();
    if (!pair) return;
    const { img, compare, before, after } = getLightbox();
    state.comparing = !state.comparing;
    img.hidden = state.comparing;
    compare.hidden = !state.comparing;
    if (state.comparing) {
      before.src = mediaSrc(pair[0]);
      after.src = mediaSrc(pair[1]);
      layoutCompare();
      setSplit(0.5);
    }
    renderStatus();
  }

  /** Sizes the split view to the "before" image, which "after" is letterboxed into. */
  function layoutCompare() {
    const { compare, before } = getLightbox();
    const width = before.naturalWidth || innerWidth;
    const height = before.naturalHeight || innerHeight;
    const scale = fitScale(width, height);
    compare.style.width = `${width * scale}px`;
    compare.style.height = `${height * scale}px`;
  }

  /** @param {number} clientX */
  function splitAt(clientX) {
    const rect = getLightbox().compare.getBoundingClientRect();
    setSplit(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  }

  /** @param {number} fraction */
  function setSplit(fraction) {
    const { after, divider } = getLightbox();
    const percent = `${fraction * 100}%`;
    after.style.clipPath = `inset(0 0 0 ${percent})`;
    divider.style.left = percent;
  }

  function copyCurrent() {
    if (state.items[state.index] instanceof HTMLVideoElement)
      return flash("Can't copy video");

    // The background worker fetches and converts to PNG, avoiding CORS and canvas tainting.
    const png = chrome.runtime
      .sendMessage({ type: "github:png", url: currentSrc() })
      .then((/** @type {{ base64?: string }} */ response) => {
        if (!response?.base64) throw new Error("Conversion failed");
        const bytes = Uint8Array.from(atob(response.base64), (char) =>
          char.charCodeAt(0),
        );
        return new Blob([bytes], { type: "image/png" });
      });
    navigator.clipboard.write([new ClipboardItem({ "image/png": png })]).then(
      () => flash("Copied"),
      () => flash("Copy failed"),
    );
  }

  /** @param {Media} source */
  function openLightbox(source) {
    const items = collectMedia();
    const index = items.findIndex(
      (item) => mediaSrc(item) === mediaSrc(source),
    );
    state.items = index === -1 ? [source] : items;
    const { dialog } = getLightbox();
    dialog.showModal();
    dialog.focus();
    show(Math.max(index, 0));
  }

  addEventListener("resize", () => {
    if (!lightbox?.dialog.open) return;
    if (state.comparing) layoutCompare();
    else if (!lightbox.img.hidden) fit();
  });

  document.addEventListener(
    "click",
    (event) => {
      // Modified clicks still open a tab, as an escape hatch.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      if (!(event.target instanceof Element) || !isLightboxImage(event.target))
        return;

      event.preventDefault();
      event.stopPropagation();
      openLightbox(event.target);
    },
    true,
  );

  return { collectMedia, openLightbox };
}
