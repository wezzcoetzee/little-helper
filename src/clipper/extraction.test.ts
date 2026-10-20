import { beforeEach, describe, expect, it } from "vitest";
import { captureDocument } from "./extraction";
import { renderCapture } from "./lib/postprocess";
import { defaultOptions } from "./types";

describe("selection capture", () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<p>Outside selection</p><section><h2>Selected heading</h2><p><a href="/docs">Documentation</a> and <strong>formatting</strong></p></section><p>Also outside</p>';
    document.getSelection()?.removeAllRanges();
  });
  it("keeps only selected HTML, preserving formatting and absolute links", () => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("section")!);
    document.getSelection()?.addRange(range);
    const capture = captureDocument(document, "selection");
    const markdown = renderCapture(capture, {
      ...defaultOptions,
      includeFrontMatter: false,
    });
    expect(markdown).toContain("## Selected heading");
    expect(markdown).toContain("[Documentation](");
    expect(capture.html).toContain(new URL("/docs", document.baseURI).href);
    expect(markdown).toContain("**formatting**");
    expect(markdown).not.toContain("Outside");
    expect(markdown).not.toContain("Also outside");
  });
  it("reports a missing selection instead of falling back to the whole page", () =>
    expect(() => captureDocument(document, "selection")).toThrow(
      "Select part",
    ));
});
