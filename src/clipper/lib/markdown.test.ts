import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./markdown";

describe("htmlToMarkdown", () => {
  it("converts headings and paragraphs", () => {
    const md = htmlToMarkdown("<h1>Title</h1><p>Body</p>", true, true);
    expect(md).toBe("# Title\n\nBody");
  });

  it("preserves links when includeLinks=true", () => {
    const md = htmlToMarkdown('<a href="https://x.com">x</a>', true, true);
    expect(md).toBe("[x](https://x.com)");
  });

  it("strips links to plain text when includeLinks=false", () => {
    const md = htmlToMarkdown('<a href="https://x.com">x</a>', false, true);
    expect(md).toBe("x");
  });

  it("removes images when includeImages=false", () => {
    const md = htmlToMarkdown(
      '<p>before<img src="a.png" alt="a">after</p>',
      true,
      false,
    );
    expect(md).toBe("beforeafter");
  });

  it("uses fenced code blocks for <pre><code>", () => {
    const md = htmlToMarkdown("<pre><code>x = 1</code></pre>", true, true);
    expect(md).toContain("```");
    expect(md).toContain("x = 1");
  });
});
