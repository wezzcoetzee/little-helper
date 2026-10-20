import TurndownService from "turndown";

export function createTurndownService(
  includeLinks: boolean,
  includeImages: boolean,
): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  if (!includeLinks) {
    turndown.addRule("stripLinks", {
      filter: "a",
      replacement: (_content, node) => (node as HTMLElement).textContent ?? "",
    });
  }

  if (!includeImages) {
    turndown.addRule("stripImages", {
      filter: "img",
      replacement: () => "",
    });
  }

  return turndown;
}

export function htmlToMarkdown(
  html: string,
  includeLinks: boolean,
  includeImages: boolean,
): string {
  const turndown = createTurndownService(includeLinks, includeImages);
  return turndown.turndown(html);
}
