export interface Settings {
  enabled: boolean;
  timeoutMin: number;
  exclusions: string[];
  github_enabled: boolean;
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
  github_enabled: true,
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
