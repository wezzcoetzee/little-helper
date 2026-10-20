export const DEFAULT_TIMEOUT_MIN = 5;

export function cleanupTimeout(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(10_080, Math.max(1, value))
    : DEFAULT_TIMEOUT_MIN;
}

export function webUrl(value: string | undefined): URL | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function excludedHost(host: string, exclusions: unknown): boolean {
  if (!Array.isArray(exclusions)) return false;
  return exclusions.some((entry: unknown) => {
    if (typeof entry !== "string") return false;
    const normalized = entry
      .trim()
      .toLowerCase()
      .replace(/^\*\./, "")
      .replace(/\.$/, "");
    const excluded = webUrl(
      normalized.includes("://") ? normalized : `https://${normalized}`,
    )?.hostname;
    const hostname = host.toLowerCase().replace(/\.$/, "");
    return (
      !!excluded && (hostname === excluded || hostname.endsWith(`.${excluded}`))
    );
  });
}
