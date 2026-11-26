// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupMergePanel } from "./merge-panel.js";

/** Mimics GitHub: the header toggle flips `?panel=mergeStatus`. */
function renderToggle() {
  const button = document.createElement("button");
  button.textContent = " Merge status ";
  const click = vi.fn(() => {
    const url = new URL(location.href);
    if (url.searchParams.has("panel")) url.searchParams.delete("panel");
    else url.searchParams.set("panel", "mergeStatus");
    history.replaceState(null, "", url);
  });
  button.addEventListener("click", click);
  document.body.replaceChildren(button);
  return click;
}

describe("setupMergePanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (/** @type {() => void} */ cb) =>
      setTimeout(cb, 0),
    );
    history.replaceState(null, "", "/acme/app/pull/1");
  });
  afterEach(() => vi.useRealTimers());

  it("opens once per PR and leaves a closed panel closed", () => {
    const click = renderToggle();
    setupMergePanel();
    vi.advanceTimersByTime(1000);
    expect(location.search).toBe("?panel=mergeStatus");

    click(); // the user closes it
    vi.advanceTimersByTime(5000);
    expect(location.search).toBe("");
    expect(click).toHaveBeenCalledTimes(2);

    history.replaceState(null, "", "/acme/app/pull/2");
    vi.advanceTimersByTime(1000);
    expect(location.search).toBe("?panel=mergeStatus");
  });

  it("retries an unhydrated toggle without double-clicking, then gives up", () => {
    const button = document.createElement("button");
    button.textContent = "Merge status";
    const click = vi.fn();
    button.addEventListener("click", click);
    document.body.replaceChildren(button);

    setupMergePanel();
    vi.advanceTimersByTime(500);
    expect(click).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(click).toHaveBeenCalledTimes(3);
  });

  it("skips other PR tabs", () => {
    history.replaceState(null, "", "/acme/app/pull/1/files");
    const click = renderToggle();
    setupMergePanel();
    vi.advanceTimersByTime(3000);
    expect(click).not.toHaveBeenCalled();
  });
});
