import { useEffect, useState } from "react";
import { downloadText, errorText, Field } from "./components";

type Cookie = chrome.cookies.Cookie;
interface Draft {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: Cookie["sameSite"];
  expiration: string;
}
function cookieUrl(cookie: Pick<Cookie, "secure" | "domain" | "path">) {
  return `${cookie.secure ? "https" : "http"}://${cookie.domain.replace(/^\./, "")}${cookie.path}`;
}
function removal(cookie: Cookie): chrome.cookies.CookieDetails {
  return {
    url: cookieUrl(cookie),
    name: cookie.name,
    storeId: cookie.storeId,
    ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
  };
}
export function Cookies({ tab }: { tab: chrome.tabs.Tab }) {
  return <CookieManager key={`${tab.id}-${tab.url}`} tab={tab} />;
}
function CookieManager({ tab }: { tab: chrome.tabs.Tab }) {
  const [cookies, setCookies] = useState<Cookie[]>([]);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Cookie | "new" | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const host = new URL(tab.url!).hostname;
  const empty: Draft = {
    name: "",
    value: "",
    domain: host,
    path: "/",
    secure: tab.url!.startsWith("https:"),
    httpOnly: false,
    sameSite: "lax",
    expiration: "",
  };
  const [draft, setDraft] = useState<Draft>(empty);
  async function load() {
    const stores = await chrome.cookies.getAllCookieStores();
    const store = stores.find(
      (store) => tab.id !== undefined && store.tabIds.includes(tab.id),
    );
    if (!store) throw new Error("Cookie store is unavailable for this tab.");
    const result = await chrome.cookies.getAll({
      url: tab.url,
      storeId: store.id,
    });
    setCookies(result.sort((a, b) => a.name.localeCompare(b.name)));
    return store.id;
  }
  useEffect(() => {
    load().catch((error) => setMessage(errorText(error)));
  }, [tab.id, tab.url]);
  async function run(work: () => Promise<void>) {
    setPending(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setPending(false);
    }
  }
  function edit(cookie: Cookie | "new") {
    setEditing(cookie);
    setDraft(
      cookie === "new"
        ? empty
        : {
            ...cookie,
            expiration: cookie.expirationDate
              ? new Date(cookie.expirationDate * 1000)
                  .toISOString()
                  .slice(0, 16)
              : "",
          },
    );
  }
  async function save() {
    if (!draft.name || !draft.path.startsWith("/"))
      throw new Error("Enter a name and a path beginning with /.");
    const normalizedDomain = draft.domain.replace(/^\./, "").toLowerCase();
    if (host !== normalizedDomain && !host.endsWith(`.${normalizedDomain}`))
      throw new Error(
        "Cookie domain must match this site or its parent domain.",
      );
    const original = editing === "new" || !editing ? null : editing;
    const storeId = original?.storeId ?? (await load());
    const expirationDate = draft.expiration
      ? new Date(`${draft.expiration}Z`).getTime() / 1000
      : undefined;
    if (
      expirationDate !== undefined &&
      (!Number.isFinite(expirationDate) || expirationDate <= Date.now() / 1000)
    )
      throw new Error("Expiration must be a future UTC time.");
    const result = await chrome.cookies.set({
      url: cookieUrl(draft),
      name: draft.name,
      value: draft.value,
      path: draft.path,
      secure: draft.secure,
      httpOnly: draft.httpOnly,
      sameSite: draft.sameSite,
      storeId,
      ...((original?.hostOnly ?? !draft.domain.startsWith("."))
        ? {}
        : { domain: draft.domain }),
      ...(expirationDate ? { expirationDate } : {}),
      ...(original?.partitionKey
        ? { partitionKey: original.partitionKey }
        : {}),
    });
    if (!result) throw new Error("Chrome could not save the cookie.");
    const changedIdentity =
      original &&
      (original.name !== result.name ||
        original.path !== result.path ||
        original.domain.toLowerCase().replace(/^\./, "") !==
          result.domain.toLowerCase().replace(/^\./, ""));
    if (changedIdentity) await chrome.cookies.remove(removal(original));
    setEditing(null);
    await load();
    setMessage("Cookie saved.");
  }
  if (editing)
    return (
      <div className="detail">
        <h2>{editing === "new" ? "Add cookie" : "Edit cookie"}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(save);
          }}
        >
          <Field label="Name">
            <input
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Value">
            <textarea
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            />
          </Field>
          <Field label="Domain">
            <input
              required
              value={draft.domain}
              onChange={(e) => setDraft({ ...draft, domain: e.target.value })}
            />
          </Field>
          <Field label="Path">
            <input
              required
              value={draft.path}
              onChange={(e) => setDraft({ ...draft, path: e.target.value })}
            />
          </Field>
          <Field label="SameSite">
            <select
              value={draft.sameSite}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  sameSite: e.target.value as Draft["sameSite"],
                })
              }
            >
              {["unspecified", "no_restriction", "lax", "strict"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </Field>
          <Field label="Expiration (UTC, blank for session)">
            <input
              type="datetime-local"
              value={draft.expiration}
              onChange={(e) =>
                setDraft({ ...draft, expiration: e.target.value })
              }
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.secure}
              onChange={(e) => setDraft({ ...draft, secure: e.target.checked })}
            />
            Secure
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.httpOnly}
              onChange={(e) =>
                setDraft({ ...draft, httpOnly: e.target.checked })
              }
            />
            HTTP only
          </label>
          <div className="button-bar">
            <button className="primary" disabled={pending}>
              Save cookie
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
        {message && <p role="status">{message}</p>}
      </div>
    );
  return (
    <div className="detail">
      <div className="section-heading">
        <h2>Cookies</h2>
        <small>
          {cookies.length} for {host}
        </small>
      </div>
      <div className="button-bar">
        <button onClick={() => edit("new")}>Add cookie</button>
        <button
          onClick={() =>
            void run(async () => {
              await load();
            })
          }
        >
          Refresh
        </button>
        <button
          disabled={!cookies.length}
          onClick={() =>
            downloadText(
              JSON.stringify(cookies, null, 2),
              `cookies-${host}.json`,
              "application/json",
            )
          }
        >
          Export JSON
        </button>
      </div>
      <input
        className="full"
        aria-label="Filter cookies"
        placeholder="Filter cookies"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {cookies
        .filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()))
        .map((cookie) => (
          <div
            className="cookie-row"
            key={`${cookie.storeId}-${cookie.domain}-${cookie.path}-${cookie.name}-${JSON.stringify(cookie.partitionKey)}`}
          >
            <button
              className="plain grow truncate"
              onClick={() => edit(cookie)}
            >
              <strong>{cookie.name || "(unnamed)"}</strong>
              <small>
                {cookie.domain} · {cookie.path}
              </small>
            </button>
            <button
              disabled={pending}
              className="danger"
              aria-label={`Delete cookie ${cookie.name}`}
              onClick={() =>
                void run(async () => {
                  await chrome.cookies.remove(removal(cookie));
                  await load();
                })
              }
            >
              Delete
            </button>
          </div>
        ))}
      {!cookies.length && (
        <p className="empty">This site has no accessible cookies.</p>
      )}
      {cookies.length > 0 &&
        (confirm ? (
          <div className="confirm">
            <p>
              Delete all {cookies.length} cookies for this site? This may sign
              you out.
            </p>
            <div className="button-bar">
              <button
                className="danger"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    for (const cookie of cookies)
                      await chrome.cookies.remove(removal(cookie));
                    setConfirm(false);
                    await load();
                  })
                }
              >
                Delete all cookies
              </button>
              <button onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="plain danger" onClick={() => setConfirm(true)}>
            Delete all cookies…
          </button>
        ))}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
