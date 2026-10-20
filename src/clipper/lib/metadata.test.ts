import { describe, expect, it } from "vitest";
import { generateFrontMatter } from "./metadata";

describe("generateFrontMatter", () => {
  it("produces YAML with quoted url, title, and ISO date", () => {
    const out = generateFrontMatter("https://example.com", "Hello");
    expect(out).toMatch(
      /^---\nurl: "https:\/\/example\.com"\ntitle: "Hello"\ndate: \d{4}-\d{2}-\d{2}\n---\n\n$/,
    );
  });

  it("escapes embedded double quotes in title", () => {
    const out = generateFrontMatter("https://example.com", 'She said "hi"');
    expect(out).toContain('title: "She said \\"hi\\""');
  });

  it("escapes newlines in title so YAML stays single-line", () => {
    const out = generateFrontMatter("https://example.com", "Line1\nLine2");
    expect(out).toContain('title: "Line1\\nLine2"');
    expect(out.split("\n").filter((l) => l.startsWith("title:"))).toHaveLength(
      1,
    );
  });

  it("escapes leading colon in title (would otherwise be invalid YAML)", () => {
    const out = generateFrontMatter("https://example.com", ": suspicious");
    expect(out).toContain('title: ": suspicious"');
  });
});
