// @ts-check

// Lets the browser back button close our modal dialogs instead of leaving the page.
// Each open dialog owns one same-URL history entry. Popstate events for those
// entries are swallowed in the capture phase so GitHub's Turbo router never sees them.

const MARKER = "ghilDialog";

/** @type {HTMLDialogElement[]} */
const open = [];
let ignoreNextPop = false;

window.addEventListener(
  "popstate",
  (event) => {
    if (ignoreNextPop) {
      ignoreNextPop = false;
      event.stopImmediatePropagation();
      return;
    }
    const dialog = open.pop();
    if (!dialog) return;
    event.stopImmediatePropagation();
    dialog.close();
  },
  true,
);

/**
 * Call right after `showModal()`. Back closes the dialog; closing it any other way
 * removes its history entry again.
 * @param {HTMLDialogElement} dialog
 */
export function closeOnBack(dialog) {
  if (open.includes(dialog)) return;
  open.push(dialog);
  history.pushState({ ...history.state, [MARKER]: open.length }, "", location.href);
  dialog.addEventListener(
    "close",
    () => {
      // Already popped when Back closed it.
      if (open.at(-1) !== dialog) return;
      open.pop();
      if (history.state?.[MARKER] !== open.length + 1) return;
      ignoreNextPop = true;
      history.back();
    },
    { once: true },
  );
}
