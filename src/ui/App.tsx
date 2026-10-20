import { useEffect, useRef, useState } from "react";
import { Action, errorText, Section, Toggle } from "./components";
import { useSettings } from "./useSettings";
import { Cookies } from "./Cookies";
import { CssEditor, Preferences, Redirects, Tabs } from "./BrowserTools";
import { activeTab } from "./shared";

type Page = "home" | "cookies" | "redirects" | "css" | "preferences";
type Group = "site" | "browser" | "all";
interface Tool {
  id: string;
  label: string;
  detail: string;
  group: Group;
  siteOnly?: boolean;
  action: () => Promise<void> | void;
}
export function App() {
  const { settings, update, ready, error } = useSettings();
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  const [group, setGroup] = useState<Group>("site");
  const [page, setPage] = useState<Page>("home");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [siteReady, setSiteReady] = useState(false);
  const [dark, setDark] = useState(false);
  const [js, setJs] = useState(true);
  const [github, setGithub] = useState({ images: 0, markdown: false });
  const search = useRef<HTMLInputElement>(null);
  const isSite = Boolean(tab?.url && /^https?:/.test(tab.url));
  const host = isSite ? new URL(tab!.url!).hostname : "";
  const isGithub = host === "github.com" || host === "gist.github.com";
  const currentTab = useRef(tab);
  currentTab.current = tab;
  useEffect(() => {
    let generation = 0;
    let mounted = true;
    async function load() {
      const request = ++generation;
      const current = () => mounted && generation === request;
      setSiteReady(false);
      const value = await activeTab();
      if (!current()) return;
      setTab(value);
      setGithub({ images: 0, markdown: false });
      if (value?.url && /^https?:/.test(value.url)) {
        const site = new URL(value.url).hostname;
        const [stored, setting] = await Promise.all([
          chrome.storage.local.get([`darkmode_${site}`, "darkmode_global"]),
          chrome.contentSettings.javascript.get({ primaryUrl: value.url }),
        ]);
        if (!current()) return;
        setDark(
          Boolean(
            stored[`darkmode_${site}`] ?? stored.darkmode_global ?? false,
          ),
        );
        setJs(setting.setting !== "block");
        if (["github.com", "gist.github.com"].includes(site) && value.id) {
          const gh = await chrome.tabs
            .sendMessage(value.id, { type: "github:status" })
            .catch(() => null);
          if (current() && gh) setGithub(gh);
        }
      }
      if (current()) setSiteReady(true);
    }
    const refresh = () => {
      void load().catch((e) => {
        if (mounted) setStatus(errorText(e));
      });
    };
    const updated = (id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (
        id === currentTab.current?.id &&
        (change.url || change.status === "complete")
      )
        refresh();
    };
    refresh();
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(updated);
    return () => {
      mounted = false;
      generation++;
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(updated);
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        !(
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        )
      ) {
        event.preventDefault();
        search.current?.focus();
      }
      if (event.key === "Escape" && (query || page !== "home")) {
        setQuery("");
        setPage("home");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [query, page]);
  function run(work: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    void work()
      .catch((e) => setStatus(errorText(e)))
      .finally(() => setBusy(false));
  }
  async function pageMessage(message: object) {
    const target = currentTab.current;
    if (
      !siteReady ||
      !target?.id ||
      !target.url ||
      !/^https?:/.test(target.url)
    )
      throw new Error("Open a website to use this tool.");
    return chrome.tabs.sendMessage(target.id, message);
  }
  async function openClipper() {
    if (!tab?.id || !isSite || !siteReady)
      throw new Error("Open a website to clip its content.");
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  }
  async function githubAction(action: "gallery" | "read") {
    const result = await pageMessage({ type: `github:${action}` });
    if (!result?.opened)
      throw new Error(
        action === "gallery"
          ? "No images or videos found on this page."
          : "Open a Markdown file on GitHub to use the reader.",
      );
    window.close();
  }
  const tools: Tool[] = [
    {
      id: "clip",
      label: "Clip as Markdown",
      detail: "Smart, full page or element",
      group: "site",
      siteOnly: true,
      action: openClipper,
    },
    {
      id: "gallery",
      label: "Open media gallery",
      detail: `${github.images} images / videos`,
      group: "site",
      siteOnly: true,
      action: () => githubAction("gallery"),
    },
    {
      id: "reader",
      label: "Read Markdown",
      detail: "GitHub reader",
      group: "site",
      siteOnly: true,
      action: () => githubAction("read"),
    },
    {
      id: "cookies",
      label: "Cookies",
      detail: "View, edit, export",
      group: "site",
      siteOnly: true,
      action: () => setPage("cookies"),
    },
    {
      id: "redirects",
      label: "Redirects",
      detail: "Trace navigation",
      group: "site",
      siteOnly: true,
      action: () => setPage("redirects"),
    },
    {
      id: "css",
      label: "Custom CSS",
      detail: "Open editor",
      group: "site",
      siteOnly: true,
      action: () => setPage("css"),
    },
    {
      id: "pip",
      label: "Picture in picture",
      detail: "Float the current video",
      group: "site",
      siteOnly: true,
      action: async () => {
        const result = await chrome.runtime.sendMessage({
          type: "pip",
          tabId: tab?.id,
        });
        if (result?.error) throw new Error(result.error);
        if (!result?.action) throw new Error("No video found.");
        setStatus(
          result.action === "entered"
            ? "Video opened in picture in picture."
            : "Picture in picture closed.",
        );
      },
    },
    {
      id: "music",
      label: "Identify music",
      detail: "Listen to this tab",
      group: "site",
      siteOnly: true,
      action: async () => {
        await chrome.tabs.create({
          url: chrome.runtime.getURL(`music.html?tabId=${tab?.id}`),
        });
        window.close();
      },
    },
    {
      id: "tabs",
      label: "Tab cleanup",
      detail: settings.enabled ? "Enabled" : "Paused",
      group: "browser",
      action: () => {
        setGroup("browser");
        setPage("home");
        setQuery("");
      },
    },
    {
      id: "preferences",
      label: "Tool preferences",
      detail: "Focus, JSON, Maps and more",
      group: "browser",
      action: () => setPage("preferences"),
    },
    {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      detail: "Configure Chrome shortcuts",
      group: "browser",
      action: async () => {
        await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
      },
    },
  ];
  const available = tools.filter(
    (tool) => isGithub || !["gallery", "reader"].includes(tool.id),
  );
  const matching = available.filter((tool) =>
    `${tool.label} ${tool.detail}`.toLowerCase().includes(query.toLowerCase()),
  );
  const action = (id: string) => {
    const tool = tools.find((item) => item.id === id)!;
    return (
      <Action
        key={id}
        label={tool.label}
        detail={tool.detail}
        disabled={
          !ready ||
          busy ||
          Boolean(tool.siteOnly && (!isSite || !siteReady)) ||
          Boolean(
            ["gallery", "reader"].includes(id) && !settings.github_enabled,
          )
        }
        onClick={() =>
          run(async () => {
            await tool.action();
          })
        }
      />
    );
  };
  return (
    <div className="app-shell" aria-busy={busy}>
      <header className="app-header">
        <a className="brand" href="popup.html">
          <img src="icons/icon32.png" alt="" width="28" height="28" />
          <span>little-helper</span>
        </a>
        <span className="site-label" title={host || "Open a website"}>
          {isSite && <i className="site-dot" />}
          {host || "No website open"}
        </span>
      </header>
      {page === "home" ? (
        <>
          <div className="search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={search}
              aria-label="Find a tool"
              placeholder="Find a tool"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>/</kbd>
          </div>
          <nav className="tabs" aria-label="Tool categories">
            {(
              [
                ["site", "This site"],
                ["browser", "Browser"],
                ["all", "All tools"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                aria-current={group === id ? "page" : undefined}
                onClick={() => {
                  setGroup(id);
                  setQuery("");
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <main>
            {!ready ? (
              <p className="help" role="status">
                Loading tools…
              </p>
            ) : query ? (
              <Section
                title="Search results"
                detail={`${matching.length} tools`}
              >
                {matching.map((tool) => action(tool.id))}
                {!matching.length && (
                  <p className="help">
                    No matching tools. Try “cookies”, “Markdown” or “tabs”.
                  </p>
                )}
              </Section>
            ) : group === "browser" ? (
              <Tabs settings={settings} update={update} run={run} />
            ) : group === "all" ? (
              <>
                <Section title="Site tools">
                  {available
                    .filter((tool) => tool.group === "site")
                    .map((tool) => action(tool.id))}
                </Section>
                <Section title="Browser tools">
                  {available
                    .filter((tool) => tool.group === "browser")
                    .map((tool) => action(tool.id))}
                </Section>
                <Preferences settings={settings} update={update} run={run} />
              </>
            ) : (
              <>
                {!isSite && (
                  <p className="help">
                    Open a website to use site tools. Browser controls are
                    available in the Browser tab.
                  </p>
                )}
                <Section title="Capture">{action("clip")}</Section>
                {isGithub && (
                  <Section
                    title="GitHub"
                    detail={
                      settings.github_enabled
                        ? "Enabled on this site"
                        : "Disabled"
                    }
                  >
                    {action("gallery")}
                    {action("reader")}
                    <p className="help">
                      Images open in a lightbox. Expand code, tables and
                      diagrams directly on the page.
                    </p>
                  </Section>
                )}
                <Section title="Site controls">
                  <Toggle
                    label="Dark mode"
                    checked={dark}
                    disabled={!isSite || !siteReady || !ready || busy}
                    onChange={(value) =>
                      run(async () => {
                        await chrome.storage.local.set({
                          [`darkmode_${host}`]: value,
                        });
                        setDark(value);
                        await pageMessage({
                          type: "darkmode_toggle",
                          enabled: value,
                          brightness: settings.darkmode_brightness,
                        });
                      })
                    }
                  />
                  <Toggle
                    label="Dismiss cookie banners"
                    checked={settings.nocookie_enabled}
                    hint="Across all sites"
                    disabled={!ready || busy}
                    onChange={(value) =>
                      run(async () => {
                        await update("nocookie_enabled", value);
                        if (isSite)
                          await pageMessage({
                            type: "nocookie_toggle",
                            enabled: value,
                          });
                      })
                    }
                  />
                  <Toggle
                    label="JavaScript"
                    checked={js}
                    disabled={!isSite || !siteReady || !ready || busy}
                    onChange={(value) =>
                      run(async () => {
                        await chrome.contentSettings.javascript.set({
                          primaryPattern: `${new URL(tab!.url!).origin}/*`,
                          setting: value ? "allow" : "block",
                          scope: tab?.incognito
                            ? "incognito_session_only"
                            : "regular",
                        });
                        setJs(value);
                        await chrome.tabs.reload(tab!.id!);
                        setStatus(
                          "JavaScript preference saved. Page reloaded.",
                        );
                      })
                    }
                  />
                  {action("cookies")}
                  {action("redirects")}
                  {action("css")}
                </Section>
                <Section title="Media">
                  {action("pip")}
                  {action("music")}
                </Section>
              </>
            )}
          </main>
        </>
      ) : (
        <>
          <button
            className="back plain"
            onClick={() => {
              setPage("home");
              setStatus("");
            }}
          >
            ← Back to tools
          </button>
          <main>
            {page === "cookies" && tab && isSite && (
              <Cookies key={`${tab.id}-${tab.url}`} tab={tab} />
            )}
            {page === "redirects" && tab && isSite && (
              <Redirects key={`${tab.id}-${tab.url}`} tab={tab} run={run} />
            )}
            {page === "css" && tab && isSite && (
              <CssEditor key={`${tab.id}-${tab.url}`} tab={tab} run={run} />
            )}
            {page === "preferences" && (
              <Preferences settings={settings} update={update} run={run} />
            )}
          </main>
        </>
      )}
      {(status || error) && (
        <p className="feedback" role="status">
          {status || error}
        </p>
      )}
      <footer className="app-footer">
        <span>{busy ? "Working…" : "Preferences saved locally"}</span>
        <button
          className="plain"
          onClick={() => {
            setPage("preferences");
            setStatus("");
          }}
        >
          Settings ↗
        </button>
      </footer>
    </div>
  );
}
