import { extractReadableContent } from "./lib/readability";
import type { Capture } from "./types";

export function captureDocument(
  doc: Document,
  mode: "smart" | "full" | "selection",
  element?: Element,
): Capture {
  const readable = mode === "smart" ? extractReadableContent(doc) : null;
  const container = doc.createElement("div");
  if (mode === "selection") {
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount)
      throw new Error("Select part of the page first.");
    for (let index = 0; index < selection.rangeCount; index++)
      container.append(selection.getRangeAt(index).cloneContents());
  } else container.append((element ?? doc.body).cloneNode(true));
  container
    .querySelectorAll("script,style,noscript,[data-little-helper-picker]")
    .forEach((node) => node.remove());
  container.querySelectorAll("a[href],img[src]").forEach((node) => {
    for (const key of ["href", "src"]) {
      const value = node.getAttribute(key);
      if (value) {
        try {
          node.setAttribute(key, new URL(value, doc.baseURI).href);
        } catch {
          /* Ignore invalid page URLs. */
        }
      }
    }
  });
  return {
    html: readable?.content ?? container.innerHTML,
    title: readable?.title || doc.title,
    url: doc.location.href,
  };
}
