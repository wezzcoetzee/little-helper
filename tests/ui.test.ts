import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { defaults, useSettings } from "../src/ui/useSettings";

it("keeps storage changes received while initial preferences are loading", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolveRead!: (value: typeof defaults) => void;
  const initialRead = new Promise<typeof defaults>((resolve) => {
    resolveRead = resolve;
  });
  let listener!: (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => void;
  vi.stubGlobal("chrome", {
    storage: {
      local: { get: vi.fn(() => initialRead) },
      onChanged: {
        addListener: vi.fn((callback) => {
          listener = callback;
        }),
        removeListener: vi.fn(),
      },
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Probe() {
    const { settings } = useSettings();
    return createElement(
      "span",
      null,
      settings.enabled ? "enabled" : "disabled",
    );
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    await act(async () =>
      listener({ enabled: { oldValue: false, newValue: true } }, "local"),
    );
    expect(container.textContent).toBe("enabled");
    await act(async () => resolveRead({ ...defaults, enabled: false }));
    expect(container.textContent).toBe("enabled");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
