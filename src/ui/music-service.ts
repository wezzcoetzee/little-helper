export interface MusicConfig {
  host: string;
  key: string;
  secret: string;
}
export interface MusicMatch {
  title: string;
  artist: string;
  album: string;
  time: number;
}

export function acrHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+acrcloud\.com$/.test(host))
    throw new Error(
      "Use your ACRCloud hostname, such as identify-eu-west-1.acrcloud.com.",
    );
  return host;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function musicHistory(value: unknown): MusicMatch[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item: unknown): item is MusicMatch =>
        record(item) &&
        typeof item.title === "string" &&
        typeof item.artist === "string" &&
        typeof item.album === "string" &&
        typeof item.time === "number",
    )
    .slice(0, 20);
}

export async function identifyMusic(
  sample: Blob,
  config: MusicConfig,
  signal: AbortSignal,
): Promise<MusicMatch> {
  const host = acrHost(config.host);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`POST\n/v1/identify\n${config.key}\naudio\n1\n${timestamp}`),
  );
  const form = new FormData();
  form.append("access_key", config.key);
  form.append("data_type", "audio");
  form.append("signature_version", "1");
  form.append(
    "signature",
    btoa(String.fromCharCode(...new Uint8Array(signature))),
  );
  form.append("timestamp", timestamp);
  form.append("sample_bytes", String(sample.size));
  form.append("sample", sample, "sample.webm");
  const response = await fetch(`https://${host}/v1/identify`, {
    method: "POST",
    body: form,
    signal,
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`ACRCloud returned HTTP ${response.status}.`);
  const data: unknown = await response.json();
  if (!record(data) || !record(data.status))
    throw new Error("ACRCloud returned an invalid response.");
  if (data.status.code !== 0)
    throw new Error(
      typeof data.status.msg === "string"
        ? data.status.msg
        : "No music detected. Try a clearer part of the song.",
    );
  const metadata = record(data.metadata) ? data.metadata : {};
  const matches = Array.isArray(metadata.music)
    ? metadata.music
    : Array.isArray(metadata.humming)
      ? metadata.humming
      : [];
  const match: unknown = matches[0];
  if (!record(match) || typeof match.title !== "string")
    throw new Error("No music match found. Try a clearer part of the song.");
  const artists = Array.isArray(match.artists) ? match.artists : [];
  return {
    title: match.title,
    artist:
      artists
        .filter(record)
        .map((artist) => (typeof artist.name === "string" ? artist.name : ""))
        .filter(Boolean)
        .join(", ") || "Unknown artist",
    album:
      record(match.album) && typeof match.album.name === "string"
        ? match.album.name
        : "",
    time: Date.now(),
  };
}

export async function recordTabAudio(
  tabId: number,
  signal: AbortSignal,
  onSecond: (remaining: number) => void,
): Promise<Blob> {
  signal.throwIfAborted();
  const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  if (!mimeType)
    throw new Error("This Chrome version cannot record WebM audio.");
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let recorder: MediaRecorder | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let cancel: (() => void) | undefined;
  try {
    const consumer = await chrome.tabs.getCurrent();
    if (consumer?.id === undefined || consumer.id === tabId)
      throw new Error(
        "Open Music from the little-helper menu on the tab playing audio.",
      );
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
      consumerTabId: consumer.id,
    });
    signal.throwIfAborted();
    const audio: MediaTrackConstraints & {
      mandatory: { chromeMediaSource: string; chromeMediaSourceId: string };
    } = {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    };
    stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    signal.throwIfAborted();
    context = new AudioContext();
    source = context.createMediaStreamSource(stream);
    source.connect(context.destination);
    await context.resume();
    signal.throwIfAborted();
    recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 128_000,
    });
    const capture = recorder;
    const chunks: BlobPart[] = [];
    return await new Promise<Blob>((resolve, reject) => {
      capture.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      capture.onerror = () => reject(new Error("Audio recording failed."));
      capture.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      cancel = () =>
        reject(new DOMException("Recording cancelled.", "AbortError"));
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      capture.start();
      const end = Date.now() + 10_000;
      onSecond(10);
      ticker = setInterval(
        () => onSecond(Math.max(0, Math.ceil((end - Date.now()) / 1000))),
        250,
      );
      timer = setTimeout(() => {
        if (capture.state !== "inactive") capture.stop();
      }, 10_000);
      for (const track of stream?.getAudioTracks() ?? [])
        track.addEventListener(
          "ended",
          () => reject(new Error("The source tab stopped sharing audio.")),
          { once: true },
        );
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (ticker) clearInterval(ticker);
    if (cancel) signal.removeEventListener("abort", cancel);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    source?.disconnect();
    if (context && context.state !== "closed")
      await context.close().catch(() => {});
  }
}
