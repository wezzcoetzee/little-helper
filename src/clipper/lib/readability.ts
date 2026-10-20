import { Readability } from "@mozilla/readability";

export interface ReadabilityResult {
  title: string;
  content: string;
}

export function extractReadableContent(
  doc: Document,
): ReadabilityResult | null {
  const clone = doc.cloneNode(true) as Document;
  const reader = new Readability(clone);
  const article = reader.parse();

  if (!article) return null;

  return {
    title: article.title,
    content: article.content,
  };
}
