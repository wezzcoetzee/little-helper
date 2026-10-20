import { useEffect, useState } from "react";

import { defaults, type Settings } from "../settings";
export { defaults, type Settings } from "../settings";
export function useSettings() {
  const [settings, setSettings] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    const changed = new Set<string>();
    chrome.storage.local
      .get<Settings>({ ...defaults })
      .then((value) => {
        if (mounted) {
          setSettings((previous) => {
            const next = { ...value };
            for (const key of changed)
              if (key in defaults)
                Object.assign(next, { [key]: previous[key as keyof Settings] });
            return next;
          });
          setReady(true);
        }
      })
      .catch((e) => {
        if (mounted) setError(String(e));
      });
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "local") return;
      Object.keys(changes).forEach((key) => changed.add(key));
      setSettings((previous) => {
        const next = { ...previous };
        for (const key of Object.keys(defaults) as (keyof Settings)[]) {
          if (key in changes)
            Object.assign(next, {
              [key]: changes[key].newValue ?? defaults[key],
            });
        }
        return next;
      });
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);
  async function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    await chrome.storage.local.set({ [key]: value });
    setSettings((previous) => ({ ...previous, [key]: value }));
  }
  return { settings, update, ready, error };
}
