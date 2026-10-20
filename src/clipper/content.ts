import { captureDocument } from "./extraction";
import { errorMessage } from "./types";

let cancelPicker: (() => void) | undefined;
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (
    _sender.id !== chrome.runtime.id ||
    !message ||
    typeof message !== "object" ||
    !String(message.type).startsWith("CLIPPER_")
  )
    return;
  try {
    if (message.type === "CLIPPER_EXTRACT") {
      cancelPicker?.();
      respond({
        capture: captureDocument(
          document,
          message.mode === "selection"
            ? "selection"
            : message.mode === "smart"
              ? "smart"
              : "full",
        ),
      });
    } else if (message.type === "CLIPPER_CANCEL") {
      cancelPicker?.();
      respond({ ok: true });
    } else if (message.type === "CLIPPER_PICK") {
      cancelPicker?.();
      if (
        typeof message.requestId !== "string" ||
        !message.requestId ||
        message.requestId.length > 100
      )
        throw new Error("Invalid capture request.");
      const requestId = message.requestId;
      const overlay = document.createElement("div");
      overlay.dataset.littleHelperPicker = "";
      overlay.style.cssText =
        "position:fixed;pointer-events:none;border:2px solid #fff;box-shadow:0 0 0 1px #000;z-index:2147483647;display:none";
      document.documentElement.append(overlay);
      const move = (event: MouseEvent) => {
        if (!(event.target instanceof Element)) return;
        const rect = event.target.getBoundingClientRect();
        Object.assign(overlay.style, {
          display: "block",
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
      };
      const finish = (selected?: Element) => {
        document.removeEventListener("mouseover", move, true);
        document.removeEventListener("click", click, true);
        document.removeEventListener("keydown", key, true);
        overlay.remove();
        cancelPicker = undefined;
        void chrome.runtime
          .sendMessage({
            type: selected ? "CLIPPER_SELECTED" : "CLIPPER_PICK_CANCELLED",
            requestId,
            capture: selected
              ? captureDocument(document, "full", selected)
              : undefined,
          })
          .catch(() => {});
      };
      const click = (event: MouseEvent) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(event.target instanceof Element ? event.target : undefined);
      };
      const key = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          finish();
        }
      };
      cancelPicker = () => finish();
      document.addEventListener("mouseover", move, true);
      document.addEventListener("click", click, true);
      document.addEventListener("keydown", key, true);
      respond({ ok: true });
    }
  } catch (error) {
    respond({ error: errorMessage(error) });
  }
});
