import { useEffect, useRef, useState } from "react";
import { errorText, Field, Section } from "./components";
import {
  acrHost,
  identifyMusic,
  musicHistory,
  recordTabAudio,
  type MusicConfig,
  type MusicMatch,
} from "./music-service";

export function Music() {
  const [config, setConfig] = useState<MusicConfig>({
    host: "identify-eu-west-1.acrcloud.com",
    key: "",
    secret: "",
  });
  const [history, setHistory] = useState<MusicMatch[]>([]);
  const [source, setSource] = useState("Source tab");
  const [phase, setPhase] = useState<"idle" | "recording" | "identifying">(
    "idle",
  );
  const [remaining, setRemaining] = useState(10);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const operation = useRef<AbortController>();
  const mounted = useRef(true);
  const tabIdValue = new URLSearchParams(location.search).get("tabId");
  const tabId =
    tabIdValue !== null && /^\d+$/.test(tabIdValue) ? Number(tabIdValue) : -1;
  useEffect(() => {
    mounted.current = true;
    void chrome.storage.local
      .get(["acr_host", "acr_key", "acr_secret", "music_history"])
      .then((data) => {
        if (!mounted.current) return;
        setConfig({
          host:
            typeof data.acr_host === "string"
              ? data.acr_host
              : "identify-eu-west-1.acrcloud.com",
          key: typeof data.acr_key === "string" ? data.acr_key : "",
          secret: typeof data.acr_secret === "string" ? data.acr_secret : "",
        });
        setHistory(musicHistory(data.music_history));
        setReady(true);
      })
      .catch((error: unknown) => {
        if (mounted.current) setMessage(errorText(error));
      });
    if (tabId >= 0)
      void chrome.tabs
        .get(tabId)
        .then((tab) => {
          if (mounted.current) setSource(tab.title || "Source tab");
        })
        .catch(() => {
          if (mounted.current)
            setMessage(
              "The source tab is no longer open. Open Music again from the tab playing audio.",
            );
        });
    const cancel = () => operation.current?.abort();
    window.addEventListener("pagehide", cancel);
    return () => {
      mounted.current = false;
      cancel();
      window.removeEventListener("pagehide", cancel);
    };
  }, [tabId]);
  async function saveConfig() {
    try {
      const host = acrHost(config.host);
      await chrome.storage.local.set({
        acr_host: host,
        acr_key: config.key.trim(),
        acr_secret: config.secret.trim(),
      });
      setConfig({ host, key: config.key.trim(), secret: config.secret.trim() });
      setMessage("Configuration saved locally.");
    } catch (error) {
      setMessage(errorText(error));
    }
  }
  async function listen() {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setMessage("");
    try {
      acrHost(config.host);
      if (!config.key.trim() || !config.secret.trim())
        throw new Error("Enter your ACRCloud access key and secret below.");
      if (tabId < 0 || !Number.isSafeInteger(tabId))
        throw new Error(
          "Open Music from the little-helper menu on the tab playing audio.",
        );
      setPhase("recording");
      const audio = await recordTabAudio(
        tabId,
        controller.signal,
        (seconds) => {
          if (mounted.current) setRemaining(seconds);
        },
      );
      controller.signal.throwIfAborted();
      if (mounted.current) setPhase("identifying");
      const result = await identifyMusic(
        audio,
        { ...config, key: config.key.trim(), secret: config.secret.trim() },
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      );
      controller.signal.throwIfAborted();
      const data = await chrome.storage.local.get("music_history");
      const next = [result, ...musicHistory(data.music_history)].slice(0, 20);
      await chrome.storage.local.set({ music_history: next });
      if (mounted.current) {
        setHistory(next);
        setMessage("Match found.");
      }
    } catch (error) {
      if (mounted.current)
        setMessage(controller.signal.aborted ? "Cancelled." : errorText(error));
    } finally {
      if (operation.current === controller) operation.current = undefined;
      if (mounted.current) {
        setPhase("idle");
        setRemaining(10);
      }
    }
  }
  return (
    <main className="detail music-page">
      <h1>Music recognition</h1>
      <p className="truncate">{source}</p>
      <p>
        Listen records 10 seconds of this tab’s audio and sends it to ACRCloud
        to identify the song.
      </p>
      <div className="button-bar">
        <button
          className="primary"
          disabled={!ready || phase !== "idle"}
          onClick={() => void listen()}
        >
          {phase === "recording"
            ? `Listening · ${remaining}s`
            : phase === "identifying"
              ? "Identifying…"
              : "Listen for 10 seconds"}
        </button>
        {phase !== "idle" && (
          <button onClick={() => operation.current?.abort()}>Cancel</button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      <Section title="Recent matches">
        {history.length ? (
          <>
            <button
              className="plain danger"
              disabled={phase !== "idle"}
              onClick={() => {
                void chrome.storage.local
                  .remove("music_history")
                  .then(() => setHistory([]))
                  .catch((error: unknown) => setMessage(errorText(error)));
              }}
            >
              Clear history
            </button>
            {history.map((song, index) => (
              <a
                className="tool-row action-row"
                key={`${song.time}-${index}`}
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${song.title} ${song.artist}`)}`}
                target="_blank"
                rel="noreferrer"
              >
                <span className="grow">
                  <strong>{song.title}</strong>
                  <small>
                    {song.artist}
                    {song.album ? ` · ${song.album}` : ""}
                  </small>
                </span>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </>
        ) : (
          <p className="empty">No matches yet.</p>
        )}
      </Section>
      <Section title="ACRCloud configuration">
        <p>
          Credentials stay in this Chrome profile. Audio goes to your ACRCloud
          host only when you listen.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveConfig();
          }}
        >
          <Field label="Host">
            <input
              required
              autoComplete="off"
              value={config.host}
              disabled={phase !== "idle"}
              onChange={(event) =>
                setConfig({ ...config, host: event.target.value })
              }
              placeholder="identify-eu-west-1.acrcloud.com"
            />
          </Field>
          <Field label="Access key">
            <input
              type="password"
              autoComplete="off"
              value={config.key}
              disabled={phase !== "idle"}
              onChange={(event) =>
                setConfig({ ...config, key: event.target.value })
              }
            />
          </Field>
          <Field label="Access secret">
            <input
              type="password"
              autoComplete="off"
              value={config.secret}
              disabled={phase !== "idle"}
              onChange={(event) =>
                setConfig({ ...config, secret: event.target.value })
              }
            />
          </Field>
          <button disabled={!ready || phase !== "idle"}>
            Save configuration
          </button>
        </form>
      </Section>
    </main>
  );
}
