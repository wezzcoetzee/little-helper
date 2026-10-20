// This function is serialized into the page by chrome.scripting.
export function copyInPage(text: string): boolean {
  const focused = document.activeElement;
  const input =
    focused instanceof HTMLInputElement ||
    focused instanceof HTMLTextAreaElement
      ? focused
      : undefined;
  const inputStart = input?.selectionStart;
  const inputEnd = input?.selectionEnd;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    return document.execCommand("copy");
  } finally {
    textarea.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    if (
      input &&
      inputStart !== null &&
      inputStart !== undefined &&
      inputEnd !== null &&
      inputEnd !== undefined
    )
      input.setSelectionRange(inputStart, inputEnd);
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}
