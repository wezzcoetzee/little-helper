export interface ExtractionOptions {
  includeFrontMatter: boolean;
  includeLinks: boolean;
  includeImages: boolean;
}
export interface Capture {
  html: string;
  title: string;
  url: string;
}
export const defaultOptions: ExtractionOptions = {
  includeFrontMatter: true,
  includeLinks: true,
  includeImages: false,
};
export async function loadOptions(): Promise<ExtractionOptions> {
  const saved = (await chrome.storage.local.get("clipperOptions"))
    .clipperOptions as Partial<ExtractionOptions> | undefined;
  return { ...defaultOptions, ...saved };
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export interface ClipperEvent {
  type: "CLIPPER_RESULT" | "CLIPPER_CANCELLED" | "CLIPPER_ERROR";
  tabId: number;
  requestId: string;
  capture?: Capture;
  error?: string;
}
