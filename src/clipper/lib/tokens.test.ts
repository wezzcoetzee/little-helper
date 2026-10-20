import { describe, expect, it } from "vitest";
import { countTokens } from "./tokens";
describe("countTokens", () => {
  it("counts an empty document as zero", () => expect(countTokens("")).toBe(0));
  it("counts tokens rather than characters", () => {
    expect(countTokens("hello world")).toBe(2);
    expect(countTokens("hello world")).toBeLessThan("hello world".length);
  });
});
