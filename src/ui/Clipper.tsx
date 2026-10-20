import { useEffect, useRef, useState } from "react";
import { activeTab } from "./shared";
import {
  defaultOptions,
  loadOptions,
  errorMessage,
  type Capture,
  type ClipperEvent,
  type ExtractionOptions,
} from "../clipper/types";
import { renderCapture } from "../clipper/lib/postprocess";
import { countTokens } from "../clipper/lib/tokens";
import "./clipper.css";

export function Clipper() {
  const [options, setOptions] = useState(defaultOptions);
  const [capture, setCapture] = useState<Capture>();
  const [markdown, setMarkdown] = useState("");
  const [status, setStatus] = useState("Choose a capture mode to get started.");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tokens, setTokens] = useState(0);
  const revisionRef = useRef(0);
  const syncRef = useRef(0);
  const tabRef = useRef<number>();
  const requestRef = useRef<string>();
  const optionsRef = useRef(options);
  const pickerTabRef = useRef<number>();
  function accept(result: Capture) {
    requestRef.current = undefined;
    pickerTabRef.current = undefined;
    setCapture(result);
    setMarkdown(renderCapture(result, optionsRef.current));
    setStatus("Captured. Edit or copy your Markdown.");
    setPicking(false);
    if (tabRef.current)
      void chrome.storage.session
        .set({ [`clipperCapture:${tabRef.current}`]: result })
        .catch(() => {});
  }
  useEffect(() => {
    const syncTab = async () => {
      const sync = ++syncRef.current;
      const revision = ++revisionRef.current;
      requestRef.current = undefined;
      setBusy(false);
      setPicking(false);
      if (pickerTabRef.current)
        void chrome.tabs
          .sendMessage(pickerTabRef.current, { type: "CLIPPER_CANCEL" })
          .catch(() => {});
      pickerTabRef.current = undefined;
      const current = () =>
        sync === syncRef.current && revision === revisionRef.current;
      try {
        const loaded = await loadOptions();
        if (!current()) return;
        optionsRef.current = loaded;
        setOptions(loaded);
        const tab = await activeTab();
        if (!current()) return;
        if (tabRef.current !== tab?.id) {
          requestRef.current = undefined;
          setCapture(undefined);
          setMarkdown("");
          setPicking(false);
          setBusy(false);
          setStatus("Choose a capture mode to get started.");
        }
        tabRef.current = tab?.id;
        if (tab?.id) {
          const stored = await chrome.storage.session.get([
            `clipperCapture:${tab.id}`,
            `clipperError:${tab.id}`,
          ]);
          if (!current() || requestRef.current || tabRef.current !== tab.id)
            return;
          const saved = stored[`clipperCapture:${tab.id}`] as
            Capture | undefined;
          const failure = stored[`clipperError:${tab.id}`] as
            { url: string; error: string } | undefined;
          if (saved && saved.url === tab.url) accept(saved);
          if (failure && failure.url === tab.url) setStatus(failure.error);
        }
      } catch (error) {
        if (current()) setStatus(errorMessage(error));
      }
    };
    void syncTab();
    const activated = () => {
      void syncTab();
    };
    const updated = (id: number, change: { url?: string; status?: string }) => {
      if (
        id === tabRef.current &&
        (change.url || change.status === "loading")
      ) {
        revisionRef.current++;
        syncRef.current++;
        requestRef.current = undefined;
        setBusy(false);
        setPicking(false);
        setCapture(undefined);
        setMarkdown("");
        setStatus("Page changed. Capture it again.");
      }
    };
    const listener = (
      event: ClipperEvent,
      sender: chrome.runtime.MessageSender,
    ) => {
      if (sender.id !== chrome.runtime.id || sender.tab) return;
      if (
        !event ||
        event.tabId !== tabRef.current ||
        !event.type?.startsWith("CLIPPER_")
      )
        return;
      if (
        event.requestId !== requestRef.current &&
        (!event.requestId?.startsWith("quick:") || requestRef.current)
      )
        return;
      const revision = revisionRef.current;
      const requestId = requestRef.current;
      void activeTab()
        .then((tab) => {
          if (
            revision !== revisionRef.current ||
            requestId !== requestRef.current ||
            tabRef.current !== event.tabId ||
            tab?.id !== event.tabId
          )
            return;
          syncRef.current++;
          if (
            event.type === "CLIPPER_RESULT" &&
            event.capture &&
            tab.url === event.capture.url
          )
            accept(event.capture);
          if (event.type === "CLIPPER_CANCELLED") {
            requestRef.current = undefined;
            pickerTabRef.current = undefined;
            setPicking(false);
            setStatus("Picker cancelled.");
          }
          if (event.type === "CLIPPER_ERROR")
            setStatus(event.error || "Capture failed.");
        })
        .catch((error) => {
          if (revision === revisionRef.current) setStatus(errorMessage(error));
        });
    };
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      revisionRef.current++;
      syncRef.current++;
      chrome.tabs.onActivated.removeListener(activated);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.runtime.onMessage.removeListener(listener);
      if (pickerTabRef.current)
        void chrome.tabs
          .sendMessage(pickerTabRef.current, { type: "CLIPPER_CANCEL" })
          .catch(() => {});
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setTokens(countTokens(markdown)),
      200,
    );
    return () => window.clearTimeout(timer);
  }, [markdown]);
  async function extract(mode: "smart" | "full" | "pick") {
    const revision = ++revisionRef.current;
    syncRef.current++;
    setBusy(true);
    const requestId = crypto.randomUUID();
    requestRef.current = requestId;
    try {
      const loaded = await loadOptions();
      if (revision !== revisionRef.current) return;
      optionsRef.current = loaded;
      setOptions(loaded);
      const tab = await activeTab();
      if (revision !== revisionRef.current) return;
      if (!tab?.id || !tab.url || !/^https?:/.test(tab.url))
        throw new Error("Open a website to capture its content.");
      tabRef.current = tab.id;
      const result = (await chrome.tabs.sendMessage(tab.id, {
        type: mode === "pick" ? "CLIPPER_PICK" : "CLIPPER_EXTRACT",
        mode,
        requestId,
      })) as { capture?: Capture; error?: string };
      if (revision !== revisionRef.current || requestRef.current !== requestId)
        return;
      if (result.error) throw new Error(result.error);
      if (mode === "pick") {
        pickerTabRef.current = tab.id;
        setPicking(true);
        setStatus("Click an element on the page. Escape cancels.");
      } else if (result.capture) {
        const currentTab = await chrome.tabs.get(tab.id);
        if (
          revision !== revisionRef.current ||
          requestRef.current !== requestId ||
          tabRef.current !== tab.id ||
          currentTab.url !== result.capture.url
        )
          return;
        accept(result.capture);
        void chrome.storage.session.remove(`clipperError:${tab.id}`);
      }
    } catch (error) {
      if (revision === revisionRef.current) {
        setStatus(
          `${errorMessage(error)} Reload the page if the extension was just installed.`,
        );
        requestRef.current = undefined;
      }
    } finally {
      if (revision === revisionRef.current) setBusy(false);
    }
  }
  async function cancel() {
    const revision = ++revisionRef.current;
    syncRef.current++;
    const id = pickerTabRef.current;
    requestRef.current = undefined;
    pickerTabRef.current = undefined;
    if (id)
      await chrome.tabs
        .sendMessage(id, { type: "CLIPPER_CANCEL" })
        .catch(() => {});
    if (revision === revisionRef.current) {
      setBusy(false);
      setPicking(false);
      setStatus("Picker cancelled.");
    }
  }
  function toggle(key: keyof ExtractionOptions) {
    syncRef.current++;
    const next = { ...options, [key]: !options[key] };
    optionsRef.current = next;
    setOptions(next);
    void chrome.storage.local
      .set({ clipperOptions: next })
      .catch((error) => setStatus(errorMessage(error)));
    if (capture) setMarkdown(renderCapture(capture, next));
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setStatus("Copied to clipboard.");
    } catch {
      setStatus("Copy failed. Select the Markdown and copy it manually.");
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(capture?.title || "page").replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80) || "page"}.md`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="clipper">
      <div className="clipper-modes">
        <button disabled={busy} onClick={() => void extract("smart")}>
          Smart extract
        </button>
        <button disabled={busy} onClick={() => void extract("full")}>
          Full page
        </button>
        <button disabled={busy} onClick={() => void extract("pick")}>
          Pick element
        </button>
        {picking && (
          <button onClick={() => void cancel()}>Cancel picker</button>
        )}
      </div>
      <div className="clipper-options">
        {(
          [
            ["includeFrontMatter", "Metadata"],
            ["includeLinks", "Links"],
            ["includeImages", "Images"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={options[key]}
              onChange={() => toggle(key)}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="clipper-status" role="status">
        {status}
      </p>
      <textarea
        aria-label="Captured Markdown"
        placeholder="Your Markdown will appear here…"
        spellCheck={false}
        value={markdown}
        onChange={(event) => {
          syncRef.current++;
          setMarkdown(event.target.value);
        }}
      />
      <div className="clipper-footer">
        <span>{tokens.toLocaleString()} tokens · GPT estimate</span>
        <span>{markdown.length.toLocaleString()} characters</span>
      </div>
      <div className="clipper-actions">
        <button disabled={!markdown} onClick={() => void copy()}>
          Copy Markdown
        </button>
        <button disabled={!markdown} onClick={download}>
          Download .md
        </button>
        <button
          disabled={!markdown}
          onClick={() => {
            revisionRef.current++;
            syncRef.current++;
            requestRef.current = undefined;
            if (pickerTabRef.current)
              void chrome.tabs
                .sendMessage(pickerTabRef.current, { type: "CLIPPER_CANCEL" })
                .catch(() => {});
            pickerTabRef.current = undefined;
            setBusy(false);
            setPicking(false);
            setCapture(undefined);
            setMarkdown("");
            setStatus("Cleared.");
            if (tabRef.current)
              void chrome.storage.session.remove([
                `clipperCapture:${tabRef.current}`,
                `clipperError:${tabRef.current}`,
              ]);
          }}
        >
          Clear
        </button>
      </div>
    </section>
  );
}
