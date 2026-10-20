import { describe, expect, it } from "vitest";
import { cleanupTimeout, excludedHost, webUrl } from "./cleanup";

describe("tab cleanup protections", () => {
  it("only permits web URLs for cleanup and history", () => {
    for (const url of [
      "chrome://settings",
      "file:///private/file",
      "about:blank",
      "javascript:alert(1)",
      undefined,
    ])
      expect(webUrl(url)).toBeNull();
    expect(webUrl("https://example.com/path")?.hostname).toBe("example.com");
  });
  it("matches domain exclusions without matching lookalike hosts", () => {
    expect(excludedHost("docs.example.com", ["Example.com"])).toBe(true);
    expect(excludedHost("example.com", [" https://example.com/path "])).toBe(
      true,
    );
    expect(excludedHost("example.com", ["*.example.com"])).toBe(true);
    expect(excludedHost("notexample.com", ["example.com"])).toBe(false);
    expect(excludedHost("example.com.evil.test", ["example.com"])).toBe(false);
    expect(excludedHost("example.com", [null, 5, ""])).toBe(false);
  });
  it("clamps timeout and rejects corrupt settings", () => {
    expect(cleanupTimeout(-1)).toBe(1);
    expect(cleanupTimeout(999999)).toBe(10080);
    for (const invalid of ["1", null, NaN, Infinity])
      expect(cleanupTimeout(invalid)).toBe(5);
  });
});
