import { describe, expect, it } from "vitest";
import { renderCapture } from "./postprocess";
import { defaultOptions } from "../types";
const capture = {
  html: '<h1>Article</h1><p><a href="https://example.com/a_(b)">Read more</a></p><img src="https://example.com/image.png" alt="Example"><pre><code>![literal](code)</code></pre>',
  title: "Article",
  url: "https://example.com",
};
describe("renderCapture", () => {
  it("can restore links and images after disabling them without damaging code", () => {
    const stripped = renderCapture(capture, {
      includeFrontMatter: false,
      includeLinks: false,
      includeImages: false,
    });
    expect(stripped).not.toContain("https://example.com/a_");
    expect(stripped).not.toContain("image.png");
    expect(stripped).toContain("![literal](code)");
    const restored = renderCapture(capture, {
      ...defaultOptions,
      includeImages: true,
    });
    expect(restored).toContain("image.png");
    expect(restored).toContain("Read more](");
    expect(
      renderCapture(capture, { ...defaultOptions, includeImages: true }),
    ).toBe(restored);
  });
  it("adds exactly one metadata block on repeated renders", () => {
    const first = renderCapture(capture, defaultOptions);
    expect(renderCapture(capture, defaultOptions)).toBe(first);
    expect(first.match(/^url: /gm)).toHaveLength(1);
  });
  it("preserves user content beginning with Markdown horizontal rules", () => {
    const out = renderCapture(
      { ...capture, html: "<hr><p>Content</p><hr>" },
      { ...defaultOptions, includeFrontMatter: false },
    );
    expect(out).toContain("Content");
    expect(out.match(/\* \* \*/g)).toHaveLength(2);
  });
});
