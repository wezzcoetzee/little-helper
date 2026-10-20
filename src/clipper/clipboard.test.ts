import { afterEach, describe, expect, it, vi } from "vitest";
import { copyInPage } from "./clipboard";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
describe("page clipboard fallback", () => {
  it("restores focused input and selection after copying", () => {
    document.body.innerHTML = '<input value="original text">';
    const input = document.querySelector("input")!;
    input.focus();
    input.setSelectionRange(1, 5);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => true),
    });
    expect(copyInPage("Markdown")).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(5);
    expect(document.querySelector("textarea")).toBeNull();
  });
  it("restores selected page content and cleans up even if copying throws", () => {
    document.body.innerHTML = "<p>Selected page content</p>";
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("p")!);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("Denied");
      }),
    });
    expect(() => copyInPage("Markdown")).toThrow("Denied");
    expect(document.getSelection()?.toString()).toBe("Selected page content");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
