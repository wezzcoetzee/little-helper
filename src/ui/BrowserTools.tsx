import { useEffect, useState } from "react";
import { downloadText, errorText, Field, Section, Toggle } from "./components";
import type { Settings } from "./useSettings";

type Update = <K extends keyof Settings>(
  key: K,
  value: Settings[K],
) => Promise<void>;
type Run = (work: () => Promise<void>) => void;
interface ClosedTab {
  url: string;
  title: string;
  time: number;
}
export function Tabs({
  settings,
  update,
  run,
}: {
  settings: Settings;
  update: Update;
  run: Run;
}) {
  const [host, setHost] = useState("");
  const [closed, setClosed] = useState<ClosedTab[]>([]);
  useEffect(() => {
    const load = () =>
      chrome.storage.local
        .get<{ closed_tabs?: ClosedTab[] }>("closed_tabs")
        .then((value) => setClosed(value.closed_tabs ?? []));
    void load();
    const listener = () => {
      void load();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  return (
    <>
      <Section
        title="Tab cleanup"
        detail={settings.enabled ? "Enabled" : "Paused"}
      >
        <Toggle
          label="Close inactive tabs"
          checked={settings.enabled}
          onChange={(value) => run(() => update("enabled", value))}
        />
        <Field label="Close after (minutes)">
          <input
            type="number"
            min="1"
            max="1440"
            value={settings.timeoutMin}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (value >= 1 && value <= 1440)
                run(() => update("timeoutMin", value));
            }}
          />
        </Field>
        <p className="help">
          Active, pinned and playing tabs stay open. The last tab in each window
          stays open.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const url = new URL(
                host.includes("://") ? host : `https://${host}`,
              );
              if (
                !/^https?:$/.test(url.protocol) ||
                !url.hostname.includes(".")
              )
                throw new Error("Enter a website hostname.");
              await update("exclusions", [
                ...new Set([...settings.exclusions, url.hostname]),
              ]);
              setHost("");
            });
          }}
        >
          <Field label="Keep these sites open">
            <div className="inline">
              <input
                aria-label="Excluded hostname"
                placeholder="example.com"
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
              <button>Add site</button>
            </div>
          </Field>
        </form>
        {settings.exclusions.map((item) => (
          <div className="tool-row" key={item}>
            <span className="grow">{item}</span>
            <button
              className="plain"
              aria-label={`Remove exclusion ${item}`}
              onClick={() =>
                run(() =>
                  update(
                    "exclusions",
                    settings.exclusions.filter((value) => value !== item),
                  ),
                )
              }
            >
              Remove
            </button>
          </div>
        ))}
      </Section>
      <Section title="Recently closed" detail={`${closed.length} tabs`}>
        {!closed.length && (
          <p className="help">
            Tabs closed by little-helper appear here for reopening.
          </p>
        )}
        {closed.map((item, index) => (
          <button
            className="tool-row action-row"
            key={`${item.url}-${index}`}
            onClick={() =>
              run(async () => {
                const url = new URL(item.url);
                if (!/^https?:$/.test(url.protocol))
                  throw new Error("This saved URL cannot be reopened.");
                await chrome.tabs.create({ url: url.href });
              })
            }
          >
            <span className="grow truncate">
              {item.title}
              <small>{new URL(item.url).hostname}</small>
            </span>
            <span>↗</span>
          </button>
        ))}
        {closed.length > 0 && (
          <button
            className="plain"
            onClick={() =>
              run(async () => {
                await chrome.storage.local.remove("closed_tabs");
                setClosed([]);
              })
            }
          >
            Clear history
          </button>
        )}
      </Section>
    </>
  );
}
interface Trace {
  chain: { url: string; statusCode: number; redirectUrl: string }[];
  finalUrl: string | null;
  finalStatus: number | null;
}
export function Redirects({ tab, run }: { tab: chrome.tabs.Tab; run: Run }) {
  const [data, setData] = useState<Trace>({
    chain: [],
    finalUrl: null,
    finalStatus: null,
  });
  const [loaded, setLoaded] = useState(false);
  async function load() {
    setData(
      await chrome.runtime.sendMessage({ type: "getRedirects", tabId: tab.id }),
    );
    setLoaded(true);
  }
  useEffect(() => {
    run(load);
  }, [tab.id, tab.url]);
  const text = [
    ...data.chain.map(
      (hop) => `${hop.statusCode} ${hop.url}\n→ ${hop.redirectUrl}`,
    ),
    data.finalUrl
      ? `${data.finalStatus ?? "Unknown"} ${data.finalUrl}`
      : "No navigation recorded. Reload this site to trace redirects.",
  ].join("\n\n");
  return (
    <Section title="Redirect trace">
      <div className="button-bar">
        <button onClick={() => run(load)}>Refresh trace</button>
        <button
          disabled={!loaded}
          onClick={() => run(() => navigator.clipboard.writeText(text))}
        >
          Copy trace
        </button>
        <button
          onClick={() =>
            run(async () => {
              await chrome.tabs.reload(tab.id!);
            })
          }
        >
          Reload site
        </button>
      </div>
      {!data.finalUrl && !data.chain.length && (
        <p className="help">
          No navigation recorded yet. Reload the site to capture its redirect
          chain.
        </p>
      )}
      {data.chain.map((hop, i) => (
        <div className="trace-step" key={`${i}-${hop.url}`}>
          <strong>{hop.statusCode}</strong>
          <span>
            {hop.url}
            <small>→ {hop.redirectUrl}</small>
          </span>
        </div>
      ))}
      {data.finalUrl && (
        <div className="trace-step">
          <strong>{data.finalStatus ?? "?"}</strong>
          <span>
            {data.finalUrl}
            <small>Final destination</small>
          </span>
        </div>
      )}
    </Section>
  );
}
export function CssEditor({ tab, run }: { tab: chrome.tabs.Tab; run: Run }) {
  const host = new URL(tab.url!).hostname;
  const [css, setCss] = useState("");
  const [saved, setSaved] = useState("");
  const [state, setState] = useState("");
  const key = `livecss_${host}`;
  useEffect(() => {
    chrome.storage.local
      .get(key)
      .then((value) => {
        setCss(typeof value[key] === "string" ? value[key] : "");
        setSaved(typeof value[key] === "string" ? value[key] : "");
      })
      .catch((e) => setState(errorText(e)));
  }, [key]);
  async function preview(value: string) {
    await chrome.tabs.sendMessage(tab.id!, {
      type: "livecss_update",
      css: value,
    });
  }
  return (
    <Section title="Custom CSS" detail={host}>
      <Field label="Stylesheet">
        <textarea
          className="code-editor"
          spellCheck={false}
          value={css}
          placeholder="body {\n  max-width: 80rem;\n}"
          onChange={(e) => {
            setCss(e.target.value);
            setState("Unsaved changes");
          }}
        />
      </Field>
      <div className="button-bar">
        <button
          onClick={() =>
            run(async () => {
              await preview(css);
              setState("Preview applied until reload.");
            })
          }
        >
          Preview CSS
        </button>
        <button
          className="primary"
          onClick={() =>
            run(async () => {
              await chrome.storage.local.set({ [key]: css });
              setSaved(css);
              await preview(css);
              setState("Saved for this site.");
            })
          }
        >
          Save CSS
        </button>
        <button
          onClick={() =>
            run(async () => {
              setCss(saved);
              await preview(saved);
              setState("Preview reverted.");
            })
          }
        >
          Revert
        </button>
      </div>
      <p className="help" role="status">
        {state || "Preview changes, then save to apply on future visits."}
      </p>
    </Section>
  );
}
export function Preferences({
  settings,
  update,
  run,
}: {
  settings: Settings;
  update: Update;
  run: Run;
}) {
  const [status, setStatus] = useState("");
  const items = [
    ["GitHub tools", "github_enabled", ""],
    ["Dismiss cookie banners", "nocookie_enabled", "nocookie_toggle"],
    ["YouTube focus", "unhook_enabled", "unhook_toggle"],
    ["X focus", "xunhook_enabled", "xunhook_toggle"],
    ["X dim theme", "xdim_enabled", "xdim_toggle"],
    ["Format JSON pages", "jsonformat_enabled", "jsonformat_toggle"],
    ["Google Maps links", "gmaps_enabled", ""],
    ["Google View Image", "viewimage_enabled", ""],
  ] as const;
  return (
    <>
      <Section title="Tools">
        <p className="help">
          These preferences apply across websites. Reload open pages after
          changing a tool.
        </p>
        {items.map(([label, key]) => (
          <Toggle
            key={key}
            label={label}
            checked={settings[key]}
            onChange={(value) =>
              run(async () => {
                await update(key, value);
                setStatus("Saved. Reload open pages to apply.");
              })
            }
          />
        ))}
      </Section>
      <Section title="Appearance">
        <Toggle
          label="Dark mode by default"
          checked={settings.darkmode_global}
          onChange={(value) => run(() => update("darkmode_global", value))}
        />
        <Field label={`Brightness · ${settings.darkmode_brightness}%`}>
          <input
            type="range"
            min="50"
            max="100"
            value={settings.darkmode_brightness}
            onChange={(e) =>
              run(() => update("darkmode_brightness", Number(e.target.value)))
            }
          />
        </Field>
        <Field label="X dim palette">
          <select
            value={settings.xdim_theme}
            onChange={(e) => run(() => update("xdim_theme", e.target.value))}
          >
            {["dim", "slate", "jade", "plum", "dusk", "ember", "custom"].map(
              (theme) => (
                <option key={theme} value={theme}>
                  {theme}
                </option>
              ),
            )}
          </select>
        </Field>
        {settings.xdim_theme === "custom" && (
          <Field label={`Custom hue · ${settings.xdim_customHue}°`}>
            <input
              type="range"
              min="0"
              max="360"
              value={settings.xdim_customHue}
              onChange={(e) =>
                run(() => update("xdim_customHue", Number(e.target.value)))
              }
            />
          </Field>
        )}
      </Section>
      <Section title="About">
        <p className="help">
          little-helper 1.0.0. Built from GitHub Lightbox, SuperLevels and
          SnipSnapp. Website content stays in your browser. Music recognition
          sends audio only when you choose to listen.
        </p>
        <button
          onClick={() =>
            run(async () => {
              const values = await chrome.storage.local.get(null);
              const safe = Object.fromEntries(
                Object.entries(values).filter(
                  ([key]) =>
                    !key.startsWith("acr_") &&
                    key !== "closed_tabs" &&
                    key !== "music_history" &&
                    !/clip/i.test(key),
                ),
              );
              downloadText(
                JSON.stringify(safe, null, 2),
                "little-helper-settings.json",
                "application/json",
              );
            })
          }
        >
          Export preferences
        </button>
      </Section>
      {status && (
        <p className="help" role="status">
          {status}
        </p>
      )}
    </>
  );
}
