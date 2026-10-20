import { htmlToMarkdown } from "./markdown";
import { generateFrontMatter } from "./metadata";
import type { Capture, ExtractionOptions } from "../types";

// Render from the original HTML so toggling options never destroys captured content.
export function renderCapture(
  capture: Capture,
  options: ExtractionOptions,
): string {
  const markdown = htmlToMarkdown(
    capture.html,
    options.includeLinks,
    options.includeImages,
  );
  return (
    (options.includeFrontMatter
      ? generateFrontMatter(capture.url, capture.title)
      : "") + markdown
  );
}
