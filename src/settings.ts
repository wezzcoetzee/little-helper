export interface Settings {
  enabled: boolean;
  timeoutMin: number;
  exclusions: string[];
  github_lightbox: boolean;
  github_expand: boolean;
  github_reader: boolean;
  github_bottlenecks: boolean;
  github_merge_panel: boolean;
  darkmode_global: boolean;
  darkmode_brightness: number;
  nocookie_enabled: boolean;
  unhook_enabled: boolean;
  xunhook_enabled: boolean;
  xdim_enabled: boolean;
  xdim_theme: string;
  xdim_customHue: number;
  jsonformat_enabled: boolean;
  gmaps_enabled: boolean;
  viewimage_enabled: boolean;
}
export const defaults: Settings = {
  enabled: false,
  timeoutMin: 30,
  exclusions: [],
  github_lightbox: true,
  github_expand: true,
  github_reader: true,
  github_bottlenecks: true,
  github_merge_panel: true,
  darkmode_global: false,
  darkmode_brightness: 100,
  nocookie_enabled: true,
  unhook_enabled: true,
  xunhook_enabled: true,
  xdim_enabled: false,
  xdim_theme: "dim",
  xdim_customHue: 210,
  jsonformat_enabled: true,
  gmaps_enabled: true,
  viewimage_enabled: true,
};

/** Each GitHub feature's switch, in Settings order. The content script reads the same keys. */
export const githubFeatures = [
  ["Media lightbox", "github_lightbox"],
  ["Expand code and tables", "github_expand"],
  ["Markdown reader", "github_reader"],
  ["CI bottlenecks", "github_bottlenecks"],
  ["Open PR merge status", "github_merge_panel"],
] as const satisfies readonly (readonly [string, keyof Settings])[];
