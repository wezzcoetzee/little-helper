// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupMergePanel } from "./merge-panel.js";

/**
 * Mimics GitHub's header toggle: a visually hidden "Status" suffix in its text and
 * `aria-expanded` reflecting the panel. `hydrated: false` ignores clicks.
 */
function renderToggle({ telemetry = true, hydrated = true } = {}) {
  const button = document.createElement("button");
  if (telemetry)
    button.dataset.telemetryAction = "pull_requests.merge.view_status";
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = "<span>Merge status</span><span hidden>Status</span>";
  const click = vi.fn(() => {
    if (!hydrated) return;
    const open = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!open));
  });
  button.addEventListener("click", click);
  document.body.replaceChildren(button);
  return { button, click };
}

/** @param {HTMLButtonElement} button */
const isOpen = (button) => button.getAttribute("aria-expanded") === "true";

describe("setupMergePanel", () => {
  /** @type {() => void} */
  let stop = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (/** @type {() => void} */ cb) =>
      setTimeout(cb, 0),
    );
    history.replaceState(null, "", "/acme/app/pull/1");
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens once per PR and leaves a closed panel closed", () => {
    const { button, click } = renderToggle();
    stop = setupMergePanel();
    vi.advanceTimersByTime(1000);
    expect(isOpen(button)).toBe(true);

    button.click(); // the user closes it
    vi.advanceTimersByTime(5000);
    expect(isOpen(button)).toBe(false);
    expect(click).toHaveBeenCalledTimes(2);

    history.replaceState(null, "", "/acme/app/pull/2");
    vi.advanceTimersByTime(1000);
    expect(isOpen(button)).toBe(true);
  });

  it("falls back to the toggle's text when the telemetry hook is gone", () => {
    const { button } = renderToggle({ telemetry: false });
    stop = setupMergePanel();
    vi.advanceTimersByTime(1000);
    expect(isOpen(button)).toBe(true);
  });

  it("retries an unhydrated toggle without double-clicking, then gives up", () => {
    const { click } = renderToggle({ hydrated: false });
    stop = setupMergePanel();
    vi.advanceTimersByTime(500);
    expect(click).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(click).toHaveBeenCalledTimes(3);
  });

  it("skips other PR tabs", () => {
    history.replaceState(null, "", "/acme/app/pull/1/files");
    const { click } = renderToggle();
    stop = setupMergePanel();
    vi.advanceTimersByTime(3000);
    expect(click).not.toHaveBeenCalled();
  });
});
