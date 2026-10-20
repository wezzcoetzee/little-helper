import { encode } from "gpt-tokenizer";
export function countTokens(text: string): number {
  return text ? encode(text).length : 0;
}
