// @ts-check
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeOnBack } from "./history.js";

/** jsdom lacks showModal/close, so stub just enough of HTMLDialogElement. */
function makeDialog() {
  const dialog = /** @type {HTMLDialogElement} */ (document.createElement("dialog"));
  dialog.close = () => dialog.dispatchEvent(new Event("close"));
  return dialog;
}

const popTo = (/** @type {unknown} */ state) =>
  window.dispatchEvent(new PopStateEvent("popstate", { state }));

describe("closeOnBack", () => {
  /** @type {import("vitest").Mock<(event: Event) => void>} */
  let turbo;
  beforeEach(() => {
    history.replaceState({ turbo: 1 }, "");
    turbo = vi.fn();
    window.addEventListener("popstate", turbo);
  });

  it("closes the dialog on Back and hides the pop from the page", () => {
    const dialog = makeDialog();
    const onClose = vi.fn();
    dialog.addEventListener("close", onClose);
    closeOnBack(dialog);
    expect(history.state).toMatchObject({ turbo: 1, ghilDialog: 1 });

    popTo({ turbo: 1 });
    expect(onClose).toHaveBeenCalledOnce();
    expect(turbo).not.toHaveBeenCalled();
  });

  it("removes its history entry when closed another way", () => {
    const back = vi.spyOn(history, "back").mockImplementation(() => {});
    const dialog = makeDialog();
    closeOnBack(dialog);
    dialog.close();
    expect(back).toHaveBeenCalledOnce();

    popTo({ turbo: 1 });
    expect(turbo).not.toHaveBeenCalled();
    popTo({ turbo: 1 });
    expect(turbo).toHaveBeenCalledOnce();
    back.mockRestore();
  });
});
